import type { MouseEvent } from "@opentui/core";
import type { MutableRefObject, RefObject } from "react";

import { useEffect, useRef, useState } from "react";

import type { CodingAgentPaneOutputSample } from "../agents/pane-activity.ts";
import type { AgentProviderRegistry } from "../agents/provider.ts";
import type { AgentSession, HookSnifferEntry } from "../agents/types.ts";
import type { PaneTabGroup } from "../app/pane-tabs/types.ts";
import type { TmuxControlClient } from "../tmux/control-client.ts";

import { AGENT_COLORS } from "../agents/types.ts";
import { theme } from "../themes/theme.ts";
import { AgentTree } from "./agent-tree.tsx";
import { ServerTree } from "./server-tree.tsx";

export const SIDEBAR_DEFAULT_WIDTH = 32;
export const SIDEBAR_MIN_WIDTH = 20;
export type SideBarView = "agents" | "hook-sniffer" | "server";

interface SideBarProps {
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimCycleCount?: number;
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  agentSessions?: AgentSession[];
  /** Bottom offset (3 for marquee-bottom, 0 otherwise). */
  bottomOffset?: number;
  // Server tree props
  clientRef?: MutableRefObject<TmuxControlClient | null>;
  /** Per-pane activity ref used by the agent tree spinner. */
  codingAgentLastOutputByPaneRef?: RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  configAgentsPreview?: null | string;
  currentSessionName?: string;
  focused?: boolean;
  focusedIndex?: number;
  height: number;
  // Hook sniffer props
  hookSnifferEvents?: HookSnifferEntry[];
  itemCountRef?: MutableRefObject<number>;
  /** Enter handler on an agent row — performs a "goto pane" jump. */
  onSessionSelect?: (session: AgentSession) => void;
  /** Space handler on an agent row — enters the muxotron-focus workflow. */
  onSessionZoom?: (session: AgentSession) => void;
  onTreeNavigate?: (sessionName: string, windowId: string, paneId: string) => void;
  onTreeSwitchPaneTab?: (slotKey: string, tabIndex: number) => void;
  onViewChange: (view: SideBarView) => void;
  paneTabGroups?: Map<string, PaneTabGroup>;
  registryRef?: MutableRefObject<AgentProviderRegistry | null>;
  /** Top offset (3 for full/marquee-top, 0 for raw/marquee-bottom). */
  topOffset?: number;
  view: SideBarView;
  viewActivateRef?: MutableRefObject<((index: number) => void) | null>;
  /** Parallel to `viewActivateRef` — triggers the agents view's zoom path. */
  viewZoomRef?: MutableRefObject<((index: number) => void) | null>;
  width: number;
}

export function SideBar({
  agentAlertAnimConfusables,
  agentAlertAnimCycleCount,
  agentAlertAnimDelay,
  agentAlertAnimEqualizer,
  agentAlertAnimGlow,
  agentAlertAnimScribble,
  agentSessions,
  bottomOffset = 0,
  clientRef,
  codingAgentLastOutputByPaneRef,
  configAgentsPreview,
  currentSessionName,
  focused,
  focusedIndex = -1,
  height,
  hookSnifferEvents,
  itemCountRef,
  onSessionSelect,
  onSessionZoom,
  onTreeNavigate,
  onTreeSwitchPaneTab,
  onViewChange,
  paneTabGroups,
  registryRef,
  topOffset = 3,
  view,
  viewActivateRef,
  viewZoomRef,
  width,
}: SideBarProps) {
  const innerWidth = width; // separator & control row handle their own margins
  const contentWidth = width - 1; // content has built-in 1-space left margin; leave 1 col on right
  const sidebarHeight = height - topOffset - bottomOffset;
  // When the sidebar is focused, reserve two extra rows (separator + hint) at
  // the bottom so the user always sees the key bindings while driving it with
  // the keyboard. The "review" hint is agents-only.
  const showHintRow = !!focused;
  const contentHeight = sidebarHeight - 2 - (showHintRow ? 2 : 0);

  const activeSessions = (agentSessions ?? []).filter((s) => s.status !== "ended");

  // Dot controls: centered, no labels
  const dot1 = view === "agents" ? "\u25CF" : "\u25CB";
  const dot2 = view === "server" ? "\u25CF" : "\u25CB";
  const dot3 = view === "hook-sniffer" ? "\u25CF" : "\u25CB";
  const dots = `${dot1}  ${dot2}  ${dot3}`; // 2 spaces between dots
  const dotsLeft = Math.max(0, Math.floor((innerWidth - dots.length) / 2));
  const controlRow = " ".repeat(dotsLeft) + dots + " ".repeat(Math.max(0, innerWidth - dotsLeft - dots.length));

  // Separator with label inset: " ── agents ── ". Terminates one col left of
  // the sidebar's right edge so it doesn't draw under the resize drag handle.
  const viewLabel = view === "agents" ? "agents" : view === "server" ? "server" : "hook sniffer";
  const labelWithPad = ` ${viewLabel} `;
  const separatorWidth = innerWidth - 1;
  const dashSpace = separatorWidth - 2 - labelWithPad.length; // 2 for 1-space padding on each side
  const rightDashes = Math.max(0, Math.floor(dashSpace / 2));
  const leftDashes = Math.max(0, dashSpace - rightDashes);
  const separator = " " + "\u2500".repeat(leftDashes) + labelWithPad + "\u2500".repeat(rightDashes) + " ";

  const handleSelect = (session: AgentSession) => {
    onSessionSelect?.(session);
  };
  const handleZoom = (session: AgentSession) => {
    onSessionZoom?.(session);
  };

  const activeFocusIndex = focused ? focusedIndex : -1;

  // Sync item count and activation handler for the active view
  const agentTreeRowCountRef = useRef(0);
  const agentTreeActivateRef = useRef<((index: number) => void) | null>(null);
  const agentTreeZoomRef = useRef<((index: number) => void) | null>(null);
  const treeRowCountRef = useRef(0);
  const treeActivateRef = useRef<((index: number) => void) | null>(null);
  const treeRefreshRef = useRef<(() => void) | null>(null);

  // Sync item count synchronously during render so handlers always see
  // the current view's count (useEffect would defer until after paint,
  // causing stale counts when switching views via left/right arrows).
  if (itemCountRef) {
    if (view === "agents") {
      itemCountRef.current = agentTreeRowCountRef.current;
    } else if (view === "server") {
      itemCountRef.current = treeRowCountRef.current;
    } else {
      itemCountRef.current = (hookSnifferEvents ?? []).length;
    }
  }

  useEffect(() => {
    if (!viewActivateRef) return;
    if (view === "agents") {
      viewActivateRef.current = (idx: number) => {
        agentTreeActivateRef.current?.(idx);
      };
    } else if (view === "server") {
      viewActivateRef.current = (idx: number) => {
        treeActivateRef.current?.(idx);
        // Refresh tree immediately after navigation so the active pane highlight updates
        setTimeout(() => treeRefreshRef.current?.(), 100);
      };
    } else {
      viewActivateRef.current = null;
    }
    return () => {
      if (viewActivateRef) viewActivateRef.current = null;
    };
  }, [view]);

  useEffect(() => {
    if (!viewZoomRef) return;
    if (view === "agents") {
      viewZoomRef.current = (idx: number) => {
        agentTreeZoomRef.current?.(idx);
      };
    } else {
      viewZoomRef.current = null;
    }
    return () => {
      if (viewZoomRef) viewZoomRef.current = null;
    };
  }, [view]);

  const handleTop = Math.max(0, Math.floor(sidebarHeight / 2) - 1);

  return (
    <>
      <box
        backgroundColor={theme.bgChrome}
        flexDirection="column"
        height={sidebarHeight}
        id="honeyshots:sidebar"
        left={0}
        position="absolute"
        top={topOffset}
        width={width}
        zIndex={10}
      >
        {/* Resize drag handle indicator */}
        <text content={"\u22EE"} fg={theme.textSecondary} left={width - 1} position="absolute" top={handleTop} />
        {/* Control row */}
        <box flexDirection="row" height={1} width={innerWidth}>
          <text
            content={controlRow}
            fg={theme.text}
            onMouseDown={(event: MouseEvent) => {
              if (event.button !== 0) return;
              // 3 dots: positions are dotsLeft, dotsLeft+3, dotsLeft+6
              // Each dot owns its cell plus the immediate left/right neighbor
              const boundary1 = dotsLeft + 1; // dot1 zone: dotsLeft-1..dotsLeft+1
              const boundary2 = dotsLeft + 4; // dot2 zone: dotsLeft+2..dotsLeft+4
              if (event.x <= boundary1) {
                onViewChange("agents");
              } else if (event.x <= boundary2) {
                onViewChange("server");
              } else {
                onViewChange("hook-sniffer");
              }
            }}
          />
        </box>
        {/* Separator with label */}
        <text content={separator} fg={theme.textSecondary} />
        {/* Content */}
        {view === "agents" && activeSessions.length > 0 && (
          <AgentTree
            activateRef={agentTreeActivateRef}
            agentAlertAnimConfusables={agentAlertAnimConfusables}
            agentAlertAnimCycleCount={agentAlertAnimCycleCount}
            agentAlertAnimDelay={agentAlertAnimDelay}
            agentAlertAnimEqualizer={agentAlertAnimEqualizer}
            agentAlertAnimGlow={agentAlertAnimGlow}
            agentAlertAnimScribble={agentAlertAnimScribble}
            configAgentsPreview={configAgentsPreview}
            focusedRow={activeFocusIndex}
            height={contentHeight}
            lastOutputByPaneRef={codingAgentLastOutputByPaneRef}
            onSelect={handleSelect}
            onZoom={handleZoom}
            registryRef={registryRef}
            rowCountRef={agentTreeRowCountRef}
            sessions={activeSessions}
            width={contentWidth}
            zoomRef={agentTreeZoomRef}
          />
        )}
        {view === "agents" && activeSessions.length === 0 && (
          <text content={" No active agents".padEnd(contentWidth)} fg={theme.textDim} />
        )}
        {view === "server" && clientRef && currentSessionName != null && onTreeNavigate && (
          <ServerTree
            activateRef={treeActivateRef}
            clientRef={clientRef}
            currentSessionName={currentSessionName}
            focusedRow={activeFocusIndex}
            height={contentHeight}
            onNavigate={onTreeNavigate}
            onSwitchPaneTab={onTreeSwitchPaneTab}
            paneTabGroups={paneTabGroups ?? new Map()}
            refreshRef={treeRefreshRef}
            rowCountRef={itemCountRef ?? treeRowCountRef}
            width={contentWidth}
          />
        )}
        {view === "hook-sniffer" && (
          <HookSnifferView
            events={hookSnifferEvents ?? []}
            focusedIndex={activeFocusIndex}
            height={contentHeight}
            width={contentWidth}
          />
        )}
        {showHintRow && (
          <>
            <text
              content={" " + "\u2500".repeat(Math.max(0, innerWidth - 2)) + " "}
              fg={theme.border}
              selectable={false}
            />
            <box flexDirection="row" gap={1} height={1} justifyContent="center" overflow="hidden" width={innerWidth}>
              <text content="↑↓←→" fg={theme.accent} selectable={false} />
              <text content="nav" fg={theme.textDim} selectable={false} />
              <text content=" " selectable={false} />
              <text content="↵" fg={theme.accent} selectable={false} />
              <text content="goto" fg={theme.textDim} selectable={false} />
              {view === "agents" && (
                <>
                  <text content=" " selectable={false} />
                  <text content="sp" fg={theme.accent} selectable={false} />
                  <text content="review" fg={theme.textDim} selectable={false} />
                </>
              )}
              <text content=" " selectable={false} />
              <text content="esc" fg={theme.accent} selectable={false} />
              <text content="unfocus" fg={theme.textDim} selectable={false} />
            </box>
          </>
        )}
      </box>
    </>
  );
}

/** Compute max sidebar width: leave at least 10 cols for the tmux pane + 1 col divider. */
export function sidebarMaxWidth(terminalCols: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, terminalCols - 11);
}

function HookSnifferView({
  events,
  focusedIndex = -1,
  height,
  width,
}: {
  events: HookSnifferEntry[];
  focusedIndex?: number;
  height: number;
  width: number;
}) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const prevCountRef = useRef(events.length);

  // 1 row for header
  const dataHeight = height - 1;

  // Auto-scroll to bottom when new events arrive and user is already at the bottom
  useEffect(() => {
    if (events.length !== prevCountRef.current) {
      const maxScroll = Math.max(0, events.length - dataHeight);
      const wasAtBottom =
        prevCountRef.current <= dataHeight || scrollOffset >= Math.max(0, prevCountRef.current - dataHeight);
      prevCountRef.current = events.length;
      if (wasAtBottom) {
        setScrollOffset(maxScroll);
      }
    }
  }, [events.length, dataHeight, scrollOffset]);

  // Auto-scroll to keep focused index visible
  useEffect(() => {
    if (focusedIndex < 0) return;
    setScrollOffset((o) => {
      if (focusedIndex < o) return focusedIndex;
      if (focusedIndex >= o + dataHeight) return focusedIndex - dataHeight + 1;
      return o;
    });
  }, [focusedIndex, dataHeight]);

  // Column definitions: time, agent, session, pid, event
  const timeW = 8; // HH:MM:SS
  const agentW = 8; // longest is "opencode"
  const sidW = 8; // first segment of UUID
  const pidW = Math.max(0, ...events.map((e) => (e.pid ? String(e.pid).length : 0)));
  const gap = 1;
  const fixedW = 1 + timeW + gap + agentW + gap + sidW + gap;
  const minW = fixedW + 3; // 3 = min event col
  const showPid = pidW > 0 && minW + gap + pidW <= width;
  const eventW = width - fixedW - (showPid ? pidW + gap : 0);

  function buildLine(time: string, agent: string, sid: string, pid: string, event: string): string {
    const t = time.length > timeW ? time.slice(0, timeW) : time.padEnd(timeW);
    const a = agent.length > agentW ? agent.slice(0, agentW) : agent.padEnd(agentW);
    const s = sid.length > sidW ? sid.slice(0, sidW) : sid.padEnd(sidW);
    let line = " " + t + " " + a + " " + s;
    if (showPid) {
      line += " " + pid.padStart(pidW);
    }
    const ev = event.length > eventW ? event.slice(0, eventW - 1) + "\u2026" : event.padEnd(eventW);
    line += " " + ev;
    if (line.length < width) line = line + " ".repeat(width - line.length);
    else if (line.length > width) line = line.slice(0, width);
    return line;
  }

  const headerLine = buildLine("time", "agent", "session", showPid ? "pid".padEnd(pidW) : "", "event");

  if (events.length === 0) {
    return <text content={" No events yet".padEnd(width)} fg={theme.textDim} />;
  }

  const maxScroll = Math.max(0, events.length - dataHeight);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const visible = events.slice(clampedOffset, clampedOffset + dataHeight);

  const handleMouse = (event: MouseEvent) => {
    if (!event.scroll) return;
    if (event.scroll.direction === "up") {
      setScrollOffset((o) => Math.max(0, o - 3));
    } else if (event.scroll.direction === "down") {
      setScrollOffset((o) => Math.min(Math.max(0, events.length - dataHeight), o + 3));
    }
  };

  // Column start positions within the line built by buildLine().
  const agentStart = 1 + timeW + gap;
  const agentEnd = agentStart + agentW;

  const rows = visible.map((event, i) => {
    const time = formatTime(event.timestamp);
    const agent = event.agentType;
    const sid = event.sessionId.split("-")[0] ?? event.sessionId.slice(0, 8);
    const pid = event.pid ? String(event.pid) : "";
    const hook = event.hookEvent + (event.toolName ? ` ${event.toolName}` : "");
    const line = buildLine(time, agent, sid, pid, hook);
    const isFocused = focusedIndex >= 0 && clampedOffset + i === focusedIndex;
    const bg = isFocused ? theme.bgFocused : undefined;
    const baseFg = isFocused ? theme.textBright : theme.text;
    const agentFg = AGENT_COLORS[event.agentType] ?? baseFg;
    const displayLine = isFocused ? "\u25B8" + line.slice(1) : line;
    const pre = displayLine.slice(0, agentStart);
    const agentSeg = displayLine.slice(agentStart, agentEnd);
    const post = displayLine.slice(agentEnd);
    return (
      <box
        backgroundColor={bg}
        flexDirection="row"
        height={1}
        key={`${event.timestamp}-${clampedOffset + i}`}
        width={width}
      >
        <text bg={bg} content={pre} fg={baseFg} />
        <text bg={bg} content={agentSeg} fg={agentFg} />
        <text bg={bg} content={post} fg={baseFg} />
      </box>
    );
  });

  return (
    <box flexDirection="column" height={height} onMouse={handleMouse} overflow="hidden" width={width}>
      <text content={headerLine} fg={theme.textDim} />
      {rows}
    </box>
  );
}

/** Format a timestamp as HH:MM:SS. Handles both seconds and milliseconds. */
function formatTime(ts: number): string {
  // Timestamps from hook providers are in seconds (Date.now() / 1000);
  // convert to milliseconds if needed.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
