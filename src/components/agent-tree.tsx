import type { MouseEvent, OptimizedBuffer } from "@opentui/core";
import type { MutableRefObject, RefObject } from "react";

import { type RGBA, parseColor } from "@opentui/core";
import { useEffect, useRef, useState } from "react";

import type { CodingAgentPaneOutputSample } from "../agents/pane-activity.ts";
import type { AgentProviderRegistry } from "../agents/provider.ts";
import type { AgentSession } from "../agents/types.ts";

import { AGENT_COLORS, CLAUDE_ANIMATIONS } from "../agents/types.ts";
import { useImperativeAnimation } from "../app/hooks/use-imperative-animation.ts";
import { hexToRgb, lerpRgb, rgbToHex, theme } from "../themes/theme.ts";
import { computeScannerColors } from "../util/anamorphic-equalizer.ts";
import { homoglyphCycle } from "../util/homoglyphs.ts";
import { scribbleCycle } from "../util/scribble.ts";
import {
  fitToWidth,
  overlayAtColumn,
  padEndToWidth,
  padStartToWidth,
  shortenPath,
  splitAtColumn,
  stringWidth,
  stripNonPrintingControlChars,
  truncateToWidth,
} from "../util/text.ts";
import { groupSessionsForDisplay } from "./agent-tree-groups.ts";
import { getStatusChar } from "./agent-tree-helpers.ts";
import {
  MUXOTRON_SINE_WAVE_DRAIN_STEP_MS,
  MUXOTRON_SINE_WAVE_IDLE_MS,
  MUXOTRON_SINE_WAVE_PHASE_STEP_PER_MS,
  MUXOTRON_SINE_WAVE_WIDTH,
} from "./tab-bar/muxotron-sine-wave.ts";

interface AgentTreeProps {
  activateRef?: MutableRefObject<((index: number) => void) | null>;
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimCycleCount?: number;
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  configAgentsPreview?: null | string;
  focusedRow?: number;
  height: number;
  /** Ref to per-pane activity samples used by the imperative spinner. */
  lastOutputByPaneRef?: RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  onSelect: (session: AgentSession) => void;
  /** Optional secondary activation (e.g. spacebar from the sidebar view). */
  onZoom?: (session: AgentSession) => void;
  registryRef?: MutableRefObject<AgentProviderRegistry | null>;
  rowCountRef?: MutableRefObject<number>;
  sessions: AgentSession[];
  width: number;
  /** External handle that, when called with a row index, invokes `onZoom`. */
  zoomRef?: MutableRefObject<((index: number) => void) | null>;
}

interface AgentTreeRow {
  active: boolean; // unanswered status (for coloring)
  /** Brand color for the agent-name segment of `label`, if any. */
  agentColor?: string;
  /** Length in display cells of the agent-name segment within `label`. */
  agentLabelCells?: number;
  /** Column offset (in display cells) of the agent-name within `label`. */
  agentLabelStart?: number;
  /**
   * Color to use when repainting the alive status glyph as an activity
   * spinner. Set only for rows whose session is "alive"; presence signals
   * spinner eligibility when paired with a paneId.
   */
  aliveColor?: string;
  cwd?: string;
  /** Host label: "localhost" for local sessions, config server name for remote. */
  host?: string;
  label: string;
  /** Pane id this row's session occupies, used for activity lookup. */
  paneId?: string;
  pid?: number;
  prefix: string;
  /** Conversation prompt for this agent (column-rendered, not part of label). */
  prompt?: string;
  session?: AgentSession;
  sid?: string; // first UUID segment of sessionId
  type: "root" | "session" | "teammate";
}

export function AgentTree({
  activateRef,
  agentAlertAnimConfusables,
  agentAlertAnimCycleCount,
  agentAlertAnimDelay,
  agentAlertAnimEqualizer,
  agentAlertAnimGlow,
  agentAlertAnimScribble,
  configAgentsPreview,
  focusedRow = -1,
  height,
  lastOutputByPaneRef,
  onSelect,
  onZoom,
  registryRef,
  rowCountRef,
  sessions,
  width,
  zoomRef,
}: AgentTreeProps) {
  const [scrollOffset, setScrollOffset] = useState(0);

  const rows = buildAgentTreeRows(sessions, registryRef);

  // Expose row count to parent
  if (rowCountRef) rowCountRef.current = rows.length;

  // Auto-scroll to keep focused row visible (height - 1 accounts for header row)
  useEffect(() => {
    if (focusedRow < 0) return;
    const dataH = height - 1;
    setScrollOffset((o) => {
      if (focusedRow < o) return focusedRow;
      if (focusedRow >= o + dataH) return focusedRow - dataH + 1;
      return o;
    });
  }, [focusedRow, height]);

  // Expose activation to parent
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    if (!activateRef) return;
    activateRef.current = (idx: number) => {
      const row = rowsRef.current[idx];
      if (row?.session) onSelectRef.current(row.session);
    };
    return () => {
      if (activateRef) activateRef.current = null;
    };
  });

  useEffect(() => {
    if (!zoomRef) return;
    zoomRef.current = (idx: number) => {
      const row = rowsRef.current[idx];
      if (row?.session) onZoomRef.current?.(row.session);
    };
    return () => {
      if (zoomRef) zoomRef.current = null;
    };
  });

  // --- Animation gating ---
  //
  // The actual animation timing (scannerPhase, glowT, intermittentActive) is
  // computed imperatively inside AgentTreeRowLeft's renderAfter callback, so
  // this component never re-renders on animation ticks.  AgentTree only
  // re-renders when agent session data or layout props change.
  const previewActive = !!configAgentsPreview;
  const hasUnanswered = rows.some((r) => r.active) || previewActive;
  const anyAnimEnabled =
    hasUnanswered &&
    (!!agentAlertAnimEqualizer || !!agentAlertAnimGlow || !!agentAlertAnimConfusables || !!agentAlertAnimScribble);

  // --- Fixed-width column layout (computed from ALL rows for stable positions) ---
  // Column widths are floored at their header string length so every column
  // is always shown (even when no row has a value for it), and the header
  // always renders in full.
  const maxSidW = Math.max(stringWidth("session"), ...rows.map((r) => stringWidth(r.sid ?? "")));
  const maxPidW = Math.max(stringWidth("pid"), ...rows.map((r) => (r.pid ? stringWidth(String(r.pid)) : 0)));
  const maxHostW = Math.max(stringWidth("host"), ...rows.map((r) => stringWidth(r.host ?? "")));
  const maxCwdW = Math.max(stringWidth("cwd"), ...rows.map((r) => stringWidth(r.cwd ?? "")));
  const maxPromptW = Math.max(stringWidth("prompt"), ...rows.map((r) => stringWidth(r.prompt ?? "")));
  // Minimum tree-node zone width: enough cells for the widest (prefix +
  // label) actually present in the tree, so right-side columns only appear
  // once they fit alongside fully-visible labels — not by truncating them.
  // The leading +1 / trailing +1 mirror the margins consumed by
  // fitAgentTreeLabel below.
  const maxRowContentW = Math.max(0, ...rows.map((r) => stringWidth(r.prefix) + stringWidth(r.label)));
  const minLabelW = 1 + maxRowContentW + 1;

  // Cap narrow data columns
  const cappedSidW = Math.min(maxSidW, 8); // first UUID segment
  const cappedPidW = Math.min(maxPidW, 10);
  const cappedHostW = Math.min(maxHostW, 16);

  // Determine which columns fit (cascading: sid → pid → host → prompt/cwd).
  // Prompt is prioritized over cwd via PROMPT_MIN reserve (mirrors the
  // server view's title column behavior).
  const COL_GAP = 2;
  const RIGHT_MARGIN = 1;
  const PROMPT_MIN = 10;
  const showSid = minLabelW + COL_GAP + cappedSidW + RIGHT_MARGIN <= width;
  const showPid = showSid && minLabelW + COL_GAP + cappedPidW + COL_GAP + cappedSidW + RIGHT_MARGIN <= width;
  const showHost =
    showPid && minLabelW + COL_GAP + cappedHostW + COL_GAP + cappedPidW + COL_GAP + cappedSidW + RIGHT_MARGIN <= width;
  const showCwd = showHost;
  const showPrompt = showHost;

  // Place columns right-to-left from the right edge.
  // Visually (left→right) the data columns are: prompt · cwd · host · pid · sid.
  const colPositions: Array<{ align: "left" | "right"; key: string; w: number; x: number }> = [];
  let cursor = width - RIGHT_MARGIN;

  if (showSid) {
    cursor -= cappedSidW;
    colPositions.push({ align: "right", key: "session", w: cappedSidW, x: cursor });
    cursor -= COL_GAP;
  }
  if (showPid) {
    cursor -= cappedPidW;
    colPositions.push({ align: "right", key: "pid", w: cappedPidW, x: cursor });
    cursor -= COL_GAP;
  }
  if (showHost) {
    cursor -= cappedHostW;
    colPositions.push({ align: "left", key: "host", w: cappedHostW, x: cursor });
    cursor -= COL_GAP;
  }
  if (showCwd) {
    // Reserve minimum space for prompt (if any) so it keeps priority over cwd.
    const promptReserve = showPrompt ? Math.min(PROMPT_MIN, maxPromptW) + COL_GAP : 0;
    const availForCwd = cursor - minLabelW - COL_GAP - promptReserve;
    if (availForCwd >= stringWidth("cwd")) {
      const effectiveCwdW = Math.min(maxCwdW, availForCwd);
      cursor -= effectiveCwdW;
      colPositions.push({ align: "right", key: "cwd", w: effectiveCwdW, x: cursor });
      cursor -= COL_GAP;
    }
  }
  if (showPrompt) {
    const availForPrompt = cursor - minLabelW - COL_GAP;
    if (availForPrompt >= stringWidth("prompt")) {
      const effectivePromptW = Math.min(maxPromptW, availForPrompt);
      cursor -= effectivePromptW;
      colPositions.push({ align: "left", key: "prompt", w: effectivePromptW, x: cursor });
      cursor -= COL_GAP;
    }
  }

  const nodeZoneW = cursor;

  function placeColumns(base: string, cols: Array<{ pos: (typeof colPositions)[0]; val: string }>): string {
    let line = base;
    for (const { pos, val } of cols) {
      const truncated = truncateToWidth(val, pos.w);
      const v = pos.align === "left" ? padEndToWidth(truncated, pos.w) : padStartToWidth(truncated, pos.w);
      line = overlayAtColumn(line, pos.x, v);
    }
    return line;
  }

  // Header
  const headerLine = placeColumns(
    padEndToWidth(" tree", width),
    colPositions.map((p) => ({ pos: p, val: p.key })),
  );

  // Scroll
  const dataHeight = height - 1;
  const maxScroll = Math.max(0, rows.length - dataHeight);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const visibleRows = rows.slice(clampedOffset, clampedOffset + dataHeight);

  const handleMouse = (event: MouseEvent) => {
    if (!event.scroll) return;
    if (event.scroll.direction === "up") {
      setScrollOffset((o) => Math.max(0, o - 3));
    } else if (event.scroll.direction === "down") {
      setScrollOffset((o) => Math.min(Math.max(0, rows.length - dataHeight), o + 3));
    }
  };

  // Build data lines
  const lines: Array<{ fg: string; left: string; right: string; row: AgentTreeRow }> = [];
  const [headerLeft, headerRight] = splitAtColumn(headerLine, nodeZoneW);

  for (const row of visibleRows) {
    const display = fitAgentTreeLabel(row.prefix, row.label, nodeZoneW);

    const isDataRow = row.type === "session" || row.type === "teammate";
    const line = placeColumns(
      fitToWidth(" " + row.prefix + display, width),
      colPositions.map((p) => ({
        pos: p,
        val:
          p.key === "cwd"
            ? (row.cwd ?? (isDataRow ? "" : "-"))
            : p.key === "host"
              ? (row.host ?? (isDataRow ? "" : "-"))
              : p.key === "pid"
                ? row.pid
                  ? String(row.pid)
                  : isDataRow
                    ? ""
                    : "-"
                : p.key === "prompt"
                  ? (row.prompt ?? (isDataRow ? "" : "-"))
                  : (row.sid ?? (isDataRow ? "" : "-")),
      })),
    );

    const [left, right] = splitAtColumn(line, nodeZoneW);

    const fg = row.active ? theme.statusWarning : row.type === "root" ? theme.textSecondary : theme.text;
    lines.push({ fg, left, right, row });
  }

  return (
    <box flexDirection="column" height={height} onMouse={handleMouse} overflow="hidden" width={width}>
      {/* Column header */}
      <box flexDirection="row" height={1} width={width}>
        <text content={headerLeft} fg={theme.textDim} />
        <text content={headerRight} fg={theme.textDim} />
      </box>
      {/* Data rows */}
      {lines.map((l, i) => {
        const isFocused = focusedRow >= 0 && clampedOffset + i === focusedRow;
        const rowAnimatable = l.row.active || (previewActive && l.row.type !== "root");
        const leftContent = isFocused ? "\u25B8" + l.left.slice(1) : l.left;
        const leftFg = isFocused ? theme.textBright : l.fg;
        const rowBg = isFocused ? theme.bgFocused : undefined;
        // A row is spinner-eligible when it's alive and connected to a
        // pane — that's when pane output can signal activity.  The paint
        // callback decides tick-by-tick whether the sample is recent.
        const spinnerEligible = !!l.row.aliveColor && !!l.row.paneId;

        // Focused and non-animatable rows render statically via React.
        // Animatable rows delegate to AgentTreeRowLeft which repaints itself
        // imperatively at 20 Hz without re-rendering the agent tree.
        const useImperativeLeft = !isFocused && ((rowAnimatable && anyAnimEnabled) || spinnerEligible);

        // Three-way split for agent-name coloring on the static path.  The
        // animated path leaves coloring to the equalizer/glow/scribble
        // overlays, so we only split when rendering statically.
        const segments = useImperativeLeft ? null : splitLeftAgentSegments(leftContent, l.row, nodeZoneW, leftFg);

        // Column offset of the status char within `leftContent`: leading
        // space + tree prefix.  Used by the paint callback when replacing
        // the checkmark with the activity spinner.
        const statusCharCol = spinnerEligible ? 1 + stringWidth(l.row.prefix) : -1;

        // Column range of the agent-name segment within `leftContent`, so
        // the imperative paint path can color it with the brand color when
        // no alert animation is overriding the row.
        const labelColStart = 1 + stringWidth(l.row.prefix);
        const agentColStart =
          l.row.agentLabelStart != null ? Math.min(nodeZoneW, labelColStart + l.row.agentLabelStart) : -1;
        const agentColEnd =
          agentColStart >= 0 && l.row.agentLabelCells ? Math.min(nodeZoneW, agentColStart + l.row.agentLabelCells) : -1;

        return (
          <box
            backgroundColor={rowBg}
            flexDirection="row"
            height={1}
            key={clampedOffset + i}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0 && l.row.session) onSelect(l.row.session);
            }}
            width={width}
          >
            {useImperativeLeft ? (
              <AgentTreeRowLeft
                agentAlertAnimConfusables={!!agentAlertAnimConfusables}
                agentAlertAnimCycleCount={agentAlertAnimCycleCount ?? 1}
                agentAlertAnimDelay={agentAlertAnimDelay ?? 0}
                agentAlertAnimEqualizer={!!agentAlertAnimEqualizer}
                agentAlertAnimGlow={!!agentAlertAnimGlow}
                agentAlertAnimScribble={!!agentAlertAnimScribble}
                agentColEnd={agentColEnd}
                agentColStart={agentColStart}
                agentColor={l.row.agentColor}
                aliveColor={l.row.aliveColor}
                content={leftContent}
                fg={leftFg}
                isRemote={l.row.session?.isRemote}
                lastOutputByPaneRef={lastOutputByPaneRef}
                paneId={l.row.paneId}
                previewActive={previewActive}
                rowAnimatable={rowAnimatable}
                spinnerCol={statusCharCol}
                width={nodeZoneW}
              />
            ) : segments ? (
              segments.map((seg, si) => <text bg={rowBg} content={seg.text} fg={seg.fg} key={si} />)
            ) : (
              <text bg={rowBg} content={leftContent} fg={leftFg} />
            )}
            <text bg={rowBg} content={l.right} fg={isFocused ? theme.textBright : theme.textDim} />
          </box>
        );
      })}
    </box>
  );
}

export function buildAgentTreeRows(
  sessions: AgentSession[],
  registryRef?: MutableRefObject<AgentProviderRegistry | null>,
): AgentTreeRow[] {
  const rows: AgentTreeRow[] = [];

  // Root node
  rows.push({
    active: false,
    label: "\u2299",
    prefix: "",
    type: "root",
  });

  const activeSessions = sessions.filter((s) => s.status !== "ended");
  const groups = groupSessionsForDisplay(activeSessions);

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const isLastGroup = gi === groups.length - 1;
    const groupBranch = isLastGroup ? "\u2514\u2500 " : "\u251C\u2500 ";
    const groupContinue = isLastGroup ? "   " : "\u2502  ";

    if (group.type === "standalone") {
      const session = group.members[0]!;
      const anim = registryRef?.current?.getAnimations(session.agentType) ?? CLAUDE_ANIMATIONS;
      const status = getStatusChar(session, anim);
      const agentLabel = stripNonPrintingControlChars(session.teammateName ?? session.agentType);

      rows.push({
        active: session.status === "unanswered",
        agentColor: AGENT_COLORS[session.agentType],
        agentLabelCells: stringWidth(agentLabel),
        agentLabelStart: 2, // status char + space
        aliveColor: session.status === "alive" ? anim.alive.color : undefined,
        cwd: session.cwd ? shortenPath(session.cwd) : undefined,
        host: sessionHostLabel(session),
        label: `${status.char} ${agentLabel}`,
        paneId: session.paneId,
        pid: session.lastEvent?.pid ?? undefined,
        prefix: groupBranch,
        prompt: session.conversationLabel ? stripNonPrintingControlChars(session.conversationLabel) : undefined,
        session,
        sid: session.sessionId.split("-")[0],
        type: "session",
      });
    } else {
      // Team group — lead is direct child of root, teammates are children of lead
      const lead = group.lead;
      const teammates = [...group.members].sort((a, b) => {
        const pa = a.status === "unanswered" ? 0 : 1;
        const pb = b.status === "unanswered" ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.startedAt - b.startedAt;
      });

      if (lead) {
        const anim = registryRef?.current?.getAnimations(lead.agentType) ?? CLAUDE_ANIMATIONS;
        const status = getStatusChar(lead, anim);
        const teamName = stripNonPrintingControlChars(group.teamName ?? lead.agentType);
        const total = teammates.length + 1;

        rows.push({
          active: lead.status === "unanswered",
          agentColor: AGENT_COLORS[lead.agentType],
          agentLabelCells: stringWidth(teamName),
          agentLabelStart: 2,
          aliveColor: lead.status === "alive" ? anim.alive.color : undefined,
          cwd: lead.cwd ? shortenPath(lead.cwd) : undefined,
          host: sessionHostLabel(lead),
          label: `${status.char} ${teamName} (${total} agent${total !== 1 ? "s" : ""})`,
          paneId: lead.paneId,
          pid: lead.lastEvent?.pid ?? undefined,
          prefix: groupBranch,
          session: lead,
          sid: lead.sessionId.split("-")[0],
          type: "session",
        });

        for (let ti = 0; ti < teammates.length; ti++) {
          const mate = teammates[ti]!;
          const isLastMate = ti === teammates.length - 1;
          const mateBranch = isLastMate ? "\u2514\u2500 " : "\u251C\u2500 ";
          const mateAnim = registryRef?.current?.getAnimations(mate.agentType) ?? CLAUDE_ANIMATIONS;
          const mateStatus = getStatusChar(mate, mateAnim);
          const mateAgentLabel = stripNonPrintingControlChars(mate.teammateName ?? mate.agentType);

          rows.push({
            active: mate.status === "unanswered",
            agentColor: AGENT_COLORS[mate.agentType],
            agentLabelCells: stringWidth(mateAgentLabel),
            agentLabelStart: 2,
            aliveColor: mate.status === "alive" ? mateAnim.alive.color : undefined,
            cwd: mate.cwd ? shortenPath(mate.cwd) : undefined,
            host: sessionHostLabel(mate),
            label: `${mateStatus.char} ${mateAgentLabel}`,
            paneId: mate.paneId,
            pid: mate.lastEvent?.pid ?? undefined,
            prefix: groupContinue + mateBranch,
            prompt: mate.conversationLabel ? stripNonPrintingControlChars(mate.conversationLabel) : undefined,
            session: mate,
            sid: mate.sessionId.split("-")[0],
            type: "teammate",
          });
        }
      } else {
        // Orphaned teammates (no lead found) — show as standalone
        for (let ti = 0; ti < teammates.length; ti++) {
          const mate = teammates[ti]!;
          const isLast = isLastGroup && ti === teammates.length - 1;
          const branch = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
          const mateAnim = registryRef?.current?.getAnimations(mate.agentType) ?? CLAUDE_ANIMATIONS;
          const mateStatus = getStatusChar(mate, mateAnim);
          const mateAgentLabel = stripNonPrintingControlChars(mate.teammateName ?? mate.agentType);

          rows.push({
            active: mate.status === "unanswered",
            agentColor: AGENT_COLORS[mate.agentType],
            agentLabelCells: stringWidth(mateAgentLabel),
            agentLabelStart: 2,
            aliveColor: mate.status === "alive" ? mateAnim.alive.color : undefined,
            cwd: mate.cwd ? shortenPath(mate.cwd) : undefined,
            host: sessionHostLabel(mate),
            label: `${mateStatus.char} ${mateAgentLabel}`,
            paneId: mate.paneId,
            pid: mate.lastEvent?.pid ?? undefined,
            prefix: branch,
            prompt: mate.conversationLabel ? stripNonPrintingControlChars(mate.conversationLabel) : undefined,
            session: mate,
            sid: mate.sessionId.split("-")[0],
            type: "session",
          });
        }
      }
    }
  }

  return rows;
}

function fitAgentTreeLabel(prefix: string, label: string, nodeZoneW: number): string {
  const availForLabel = Math.max(0, nodeZoneW - 1 - stringWidth(prefix) - 1);
  return truncateToWidth(label, availForLabel);
}

function sessionHostLabel(session: AgentSession): string {
  if (!session.isRemote) return "localhost";
  return stripNonPrintingControlChars(session.remoteServerName ?? session.remoteHost ?? "remote");
}

/**
 * Split the assembled left content into [pre, agent, post] segments so the
 * agent-name span can render in the agent's brand color.  Returns null if
 * the row has no agent color or the agent name has been fully truncated
 * out of the visible node-zone, in which case the caller should fall back
 * to a single-text render.
 */
function splitLeftAgentSegments(
  leftContent: string,
  row: AgentTreeRow,
  nodeZoneW: number,
  baseFg: string,
): Array<{ fg: string; text: string }> | null {
  if (!row.agentColor || row.agentLabelStart == null || !row.agentLabelCells) return null;
  // Leading 1-cell space (or focus arrow) + tree prefix, then the label.
  const labelStart = 1 + stringWidth(row.prefix);
  const segStart = Math.min(nodeZoneW, labelStart + row.agentLabelStart);
  const segEnd = Math.min(nodeZoneW, segStart + row.agentLabelCells);
  if (segEnd <= segStart) return null;
  const [pre, rest] = splitAtColumn(leftContent, segStart);
  const [agentText, post] = splitAtColumn(rest, segEnd - segStart);
  return [
    { fg: baseFg, text: pre },
    { fg: row.agentColor, text: agentText },
    { fg: baseFg, text: post },
  ];
}

/** Characters that separate the prefix (tree-branch art) from the label. */
const BRANCH_CHARS = new Set(["\u2514", "\u251C"]); // └ ├

/**
 * Imperatively-painted left column for an animatable agent-tree row.
 *
 * Replaces the pre-refactor pattern where AgentTree had a 50 ms `setInterval`
 * calling `setTick` to force React re-reconciliation of the whole tree so
 * that scannerPhase/glowT/intermittentActive could flow into the row JSX.
 *
 * Here, the row box subscribes to the imperative-animation hook: the hook's
 * self-paced setTimeout loop calls `requestRender()` only on *this* row's
 * box, and the renderAfter callback below computes the timing values and
 * draws the animated left content directly via buffer.drawText.  The agent
 * tree component no longer re-renders for animation frames — only when
 * structural props change.
 *
 * Uses a small parsed-color cache to avoid repeated parseColor() calls on
 * the animation hot path.
 */
interface AgentTreeRowLeftProps {
  agentAlertAnimConfusables: boolean;
  agentAlertAnimCycleCount: number;
  agentAlertAnimDelay: number;
  agentAlertAnimEqualizer: boolean;
  agentAlertAnimGlow: boolean;
  agentAlertAnimScribble: boolean;
  /** Column (within `content`) where the agent-name segment ends, or -1. */
  agentColEnd: number;
  /** Column (within `content`) where the agent-name segment starts, or -1. */
  agentColStart: number;
  /** Brand color for the agent-name segment of `content`, if any. */
  agentColor?: string;
  /** Spinner color when drawing the activity spinner; null when not eligible. */
  aliveColor?: string;
  /** Base (untransformed) left content for this row. */
  content: string;
  /** Base fg color (before glow lerp). */
  fg: string;
  /** True when this row's session is remote-backed — switches the activity
   *  spinner to the arrow-peak variant. */
  isRemote?: boolean;
  /** Ref to per-pane activity samples; undefined disables the spinner. */
  lastOutputByPaneRef?: RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  /** Pane id for activity lookup; undefined disables the spinner. */
  paneId?: string;
  /** Whether this is the options-dialog preview mode. */
  previewActive: boolean;
  /** True when this row is eligible for alert animations (glow/scribble/etc). */
  rowAnimatable: boolean;
  /** Column offset of the status char within `content`, or -1 if none. */
  spinnerCol: number;
  /** Fixed column width this row occupies in the parent flex layout. */
  width: number;
}

const colorCache = new Map<string, RGBA>();
function cachedParseColor(hex: string): RGBA {
  let rgba = colorCache.get(hex);
  if (rgba == null) {
    rgba = parseColor(hex);
    colorCache.set(hex, rgba);
  }
  return rgba;
}

const SWEEP_MS = 1800;

/**
 * Spinner frames that trace the silhouette of a sine wave going through
 * one full period (low → mid → high → mid → low → mid).  The spinner
 * replaces the alive checkmark while an agent's pane is producing output
 * and is driven from the same phase clock as the muxotron sine wave so
 * both animations visibly pulse in lockstep.
 */
const SPINNER_FRAMES = [".", "·", "˙", "¯", "¯", "˙", "·"];
/** Climbing-trail variant for remote-backed rows: a dot rises along a
 *  diagonal path (`.` → `·` → `˙` → `'`) and lands as the `↗` remote
 *  marker at the apex, then falls back down along the same trail.
 *  Shares the sine clock so the bounce cadence matches local rows. */
const REMOTE_SPINNER_FRAMES = [".", "·", "˙", "'", "\u2197", "\u2197", "'", "˙", "·"];
/**
 * The spinner keeps ticking until the muxotron sine wave has fully drained
 * to its idle state — same silence budget, so both animations stop at the
 * same instant.  No dedicated drain animation for the spinner; it just
 * disappears when the wave hits idle.
 */
const SPINNER_ACTIVE_WINDOW_MS =
  MUXOTRON_SINE_WAVE_IDLE_MS + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS;

/**
 * Overdraws the activity spinner onto the status-char column when the row's
 * pane has produced output recently.  No-op when the row isn't spinner
 * eligible (no aliveColor/paneId/spinnerCol) or the last sample is older
 * than the active window.
 */
interface SpinnerPaintState {
  aliveColor?: string;
  isRemote?: boolean;
  lastOutputByPaneRef?: RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  paneId?: string;
  spinnerCol: number;
}

function AgentTreeRowLeft({
  agentAlertAnimConfusables,
  agentAlertAnimCycleCount,
  agentAlertAnimDelay,
  agentAlertAnimEqualizer,
  agentAlertAnimGlow,
  agentAlertAnimScribble,
  agentColEnd,
  agentColStart,
  agentColor,
  aliveColor,
  content,
  fg,
  isRemote,
  lastOutputByPaneRef,
  paneId,
  previewActive,
  rowAnimatable,
  spinnerCol,
  width,
}: AgentTreeRowLeftProps) {
  const { ref, renderAfter } = useImperativeAnimation({
    // Constant-rate tick while mounted.  getRefreshDelay could return null
    // when intermittentActive is false to idle-poll during burst gaps, but
    // the burst timing varies with user-configured delayMs/cycleCount and
    // encoding that here would duplicate the computation already in paint.
    // 20 Hz of single-box requestRender is well within budget.
    getRefreshDelay: () => 50,
    paint(buffer, state, now) {
      const cycleCount = Math.max(1, state.agentAlertAnimCycleCount);
      const burstMs = SWEEP_MS * cycleCount;
      const delayMs = state.agentAlertAnimDelay * 1000;
      const totalCycleMs = burstMs + delayMs;
      const burstPos = delayMs <= 0 ? 0 : now % totalCycleMs;
      // Alert animations (glow/scribble/equalizer/confusables) only apply
      // to rowAnimatable rows — i.e. unanswered agents or preview rows.
      // Spinner-only rows (alive + recent pane output) reach this paint
      // but must not inherit alert styling.
      const intermittentActive = state.rowAnimatable && (delayMs <= 0 || burstPos < burstMs || state.previewActive);

      // Apply text-content transforms (no-op when intermittentActive is
      // false — those animations are gated on the burst window).
      let paintContent = state.content;
      if (intermittentActive) {
        if (state.agentAlertAnimScribble) paintContent = scribbleCycle(paintContent, now);
        if (state.agentAlertAnimConfusables) paintContent = homoglyphCycle(paintContent, now);
      }

      // Resolve base fg (possibly glowing).
      let leftFgHex = state.fg;
      if (intermittentActive && state.agentAlertAnimGlow) {
        const glowT = (Math.sin((now / 1000) * Math.PI) + 1) / 2;
        const from = hexToRgb(theme.text);
        const to = hexToRgb(theme.statusWarning);
        leftFgHex = rgbToHex(lerpRgb(from, to, glowT));
      }
      const leftFg = cachedParseColor(leftFgHex);

      // Equalizer path: per-character color sweep starting at the branch
      // character.  When the burst is inactive OR the equalizer is off,
      // fall through to a single drawText call below.
      if (intermittentActive && state.agentAlertAnimEqualizer) {
        const chars = [...paintContent];
        let branchIdx = 0;
        for (let ci = chars.length - 1; ci >= 0; ci--) {
          if (BRANCH_CHARS.has(chars[ci]!)) {
            branchIdx = ci;
            break;
          }
        }
        const sweepLen = chars.length - branchIdx;
        const scanColorsHex = computeScannerColors(sweepLen, scannerPhaseFromNow(now, burstPos, burstMs, delayMs));

        let x = this.x;
        // Pre-branch characters use the static (possibly-glowing) fg.
        if (branchIdx > 0) {
          const preBranch = chars.slice(0, branchIdx).join("");
          buffer.drawText(preBranch, x, this.y, leftFg);
          // Advance x by the visual width of the pre-branch portion.
          // Characters in the tree prefix are single-width ASCII box-drawing
          // or spaces, so stringWidth-per-char and count agree here, but
          // use the helper to stay correct if that assumption changes.
          for (let ci = 0; ci < branchIdx; ci++) {
            x += columnAdvance(chars[ci]!);
          }
        }
        // Branch and label characters sweep through scanner colors.
        for (let ci = 0; ci < sweepLen; ci++) {
          const ch = chars[branchIdx + ci]!;
          const color = cachedParseColor(scanColorsHex[ci] ?? leftFgHex);
          buffer.drawText(ch, x, this.y, color);
          x += columnAdvance(ch);
        }
        drawActivitySpinner(buffer, this.x, this.y, state, now);
        return;
      }

      // Default: draw the (possibly transformed) left content.  Apply the
      // agent brand color to the agent-name segment when no alert animation
      // is overriding the row's coloring.
      const useBrand =
        !intermittentActive &&
        state.agentColor != null &&
        state.agentColStart >= 0 &&
        state.agentColEnd > state.agentColStart;
      if (useBrand) {
        const [pre, rest] = splitAtColumn(paintContent, state.agentColStart);
        const [agentText, post] = splitAtColumn(rest, state.agentColEnd - state.agentColStart);
        buffer.drawText(pre, this.x, this.y, leftFg);
        buffer.drawText(agentText, this.x + state.agentColStart, this.y, cachedParseColor(state.agentColor!));
        buffer.drawText(post, this.x + state.agentColEnd, this.y, leftFg);
      } else {
        buffer.drawText(paintContent, this.x, this.y, leftFg);
      }
      drawActivitySpinner(buffer, this.x, this.y, state, now);
    },
    state: {
      agentAlertAnimConfusables,
      agentAlertAnimCycleCount,
      agentAlertAnimDelay,
      agentAlertAnimEqualizer,
      agentAlertAnimGlow,
      agentAlertAnimScribble,
      agentColEnd,
      agentColStart,
      agentColor,
      aliveColor,
      content,
      fg,
      isRemote,
      lastOutputByPaneRef,
      paneId,
      previewActive,
      rowAnimatable,
      spinnerCol,
    },
  });

  return <box height={1} ref={ref} renderAfter={renderAfter} selectable={false} width={width} />;
}

/**
 * Single-char advance width for the tree-left draw path.  Box-drawing and
 * ASCII chars are 1 column; anything else uses stringWidth on a single-char
 * string.  Inlining the common case keeps the inner loop hot-code-free.
 */
function columnAdvance(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x7f || (code >= 0x2500 && code <= 0x259f)) return 1;
  return stringWidth(ch);
}

function drawActivitySpinner(
  buffer: OptimizedBuffer,
  originX: number,
  originY: number,
  state: SpinnerPaintState,
  now: number,
): void {
  if (state.spinnerCol < 0 || !state.aliveColor || !state.paneId) return;
  const sample = state.lastOutputByPaneRef?.current?.get(state.paneId);
  if (sample == null) return;
  if (now - sample.tickAt > SPINNER_ACTIVE_WINDOW_MS) return;

  // Share the sine wave's phase clock so the spinner pulses in lockstep
  // with the muxotron wave: (sin(phase) + 1) / 2 ∈ [0, 1] picks a frame.
  const frames = state.isRemote ? REMOTE_SPINNER_FRAMES : SPINNER_FRAMES;
  const y = (Math.sin(now * MUXOTRON_SINE_WAVE_PHASE_STEP_PER_MS) + 1) / 2;
  const frameIndex = Math.min(frames.length - 1, Math.floor(y * frames.length));
  const frame = frames[frameIndex]!;
  buffer.drawText(frame, originX + state.spinnerCol, originY, cachedParseColor(state.aliveColor));
}

/** Derive scannerPhase [0, 1) from the same inputs the old render used. */
function scannerPhaseFromNow(now: number, burstPos: number, burstMs: number, delayMs: number): number {
  if (delayMs <= 0) return ((now % SWEEP_MS) / SWEEP_MS) % 1;
  // cycleCount is burstMs / SWEEP_MS; burstPos / burstMs is the fraction
  // of the burst completed, scaled by cycleCount to get a 0..cycleCount
  // progression.  The fractional part is the current phase within one sweep.
  const cycleCount = burstMs / SWEEP_MS;
  return ((burstPos / burstMs) * cycleCount) % 1;
}
