import type { MouseEvent } from "@opentui/core";
import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PaneTabGroup } from "../app/pane-tabs/types.ts";
import type { TmuxControlClient } from "../tmux/control-client.ts";

import { theme } from "../themes/theme.ts";
import {
  type PaneOutputTitleParserState,
  initialPaneOutputTitleParserState,
  parsePaneOutputTitleUpdate,
} from "../tmux/pane-output-title-parser.ts";
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

interface CurrentPath {
  hostPaneId: string | undefined;
  /** Row index of the current pane row in the rows array (-1 when not present). */
  paneRowIndex: number;
  sessionName: string;
  /** Row index of the current session row in the rows array (-1 when not present). */
  sessionRowIndex: number;
  /** Row index of the current pane-tab row in the rows array (-1 when not present). */
  tabRowIndex: number;
  windowId: string | undefined;
  /** Row index of the current window row in the rows array (-1 when not present). */
  windowRowIndex: number;
}

interface ServerTreeProps {
  /** Ref set by ServerTree so external code can activate a row by index. */
  activateRef?: MutableRefObject<((index: number) => void) | null>;
  clientRef: MutableRefObject<TmuxControlClient | null>;
  currentSessionName: string;
  /** Keyboard-driven focused row index (-1 = none). */
  focusedRow?: number;
  height: number;
  /** Callback fired when tree counts change (sessions, windows, panes, paneTabsEnabled). */
  onCountsChange?: (counts: { paneTabsEnabled: number; panes: number; sessions: number; windows: number }) => void;
  onNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  onSwitchPaneTab?: (slotKey: string, tabIndex: number) => void;
  paneTabGroups: Map<string, PaneTabGroup>;
  /** Ref set by ServerTree so external code can trigger an immediate refresh. */
  refreshRef?: MutableRefObject<(() => void) | null>;
  /** Ref set by ServerTree to expose its total row count. */
  rowCountRef?: MutableRefObject<number>;
  width: number;
}

interface TreeData {
  panes: Array<{
    active: boolean;
    command: string;
    cwd?: string;
    id: string;
    index: number;
    pid: number;
    remoteHost?: string;
    sessionName: string;
    title?: string;
    windowId: string;
  }>;
  sessions: Array<{ attached: boolean; id: string; name: string }>;
  windows: Array<{ active: boolean; id: string; index: number; name: string; sessionName: string }>;
}

type TreePaneField = "command" | "cwd" | "title";

interface TreeRow {
  active: boolean;
  current: boolean; // is this the current session/window/pane
  cwd?: string; // pane working directory (~ shortened)
  id?: string; // right-aligned dim ID (e.g. "$1", "@3", "%5")
  label: string;
  navigatePaneId?: string;
  paneId?: string;
  pid?: number; // pane PID
  prefix: string;
  // Navigation targets
  sessionName?: string;
  slotKey?: string;
  tabIndex?: number;
  title?: string; // pane OSC window title
  type: "pane-tab" | "pane" | "root" | "session" | "window";
  windowId?: string;
}

export function ServerTree({
  activateRef,
  clientRef,
  currentSessionName,
  focusedRow = -1,
  height,
  onCountsChange,
  onNavigate,
  onSwitchPaneTab,
  paneTabGroups,
  refreshRef,
  rowCountRef,
  width,
}: ServerTreeProps) {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const liveTreePaneIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const paneTitleParserStatesRef = useRef<Map<string, PaneOutputTitleParserState>>(new Map());
  const treeDataRef = useRef<TreeData | null>(null);
  treeDataRef.current = treeData;

  useEffect(() => {
    const livePaneIds = new Set(treeData?.panes.map((pane) => pane.id) ?? []);
    liveTreePaneIdsRef.current = livePaneIds;

    const stateByPane = paneTitleParserStatesRef.current;
    for (const paneId of stateByPane.keys()) {
      if (!livePaneIds.has(paneId)) stateByPane.delete(paneId);
    }
  }, [treeData]);

  // Coalescing fetch: at most one getFullTree() in flight at a time.
  // If events arrive while a fetch is running, a single follow-up fetch
  // is performed once the current one completes — so rapid event bursts
  // (e.g. tab switch firing window-renamed + session-window-changed +
  // layout-change) collapse into at most two fetches instead of N.
  const fetchInFlightRef = useRef(false);
  const fetchRequestedRef = useRef(false);

  const fetchTree = useCallback(async () => {
    if (fetchInFlightRef.current) {
      fetchRequestedRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    fetchRequestedRef.current = false;
    try {
      do {
        fetchRequestedRef.current = false;
        const client = clientRef.current;
        if (!client) break;
        const data = await client.getFullTree();
        if (mountedRef.current) setTreeData((previous) => coalesceTreeData(previous, data));
      } while (fetchRequestedRef.current && mountedRef.current);
    } catch {
      // client may be closed
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [clientRef]);

  // Fetch on mount + fallback poll.  We start with a short 500 ms poll so
  // the tree populates quickly even if the control client isn't ready on
  // the very first useEffect cycle.  Once we have data, we lengthen the
  // interval to 10 s — just enough to catch cross-session changes (new
  // sessions, attachment status) that have no control-mode notification.
  // Everything else is driven by events + subscription below.
  const populatedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    populatedRef.current = false;
    fetchTree();
    intervalRef.current = setInterval(fetchTree, 500);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current != null) clearInterval(intervalRef.current);
    };
  }, [fetchTree]);

  // Lengthen the poll once the first data arrives.
  useEffect(() => {
    if (!treeData || populatedRef.current) return;
    populatedRef.current = true;
    if (intervalRef.current != null) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchTree, 10_000);
  }, [treeData, fetchTree]);

  // Expose refresh to parent
  useEffect(() => {
    if (refreshRef) {
      refreshRef.current = fetchTree;
      return () => {
        refreshRef.current = null;
      };
    }
  }, [refreshRef, fetchTree]);

  // Refresh on structural control client events. Pane command, cwd, and
  // title changes arrive via separate tmux format subscriptions so we can
  // patch the affected pane in local state instead of issuing a full tree
  // query for every title spinner tick.
  const TREE_COMMAND_SUBSCRIPTION = "hmx-tree-command";
  const TREE_CWD_SUBSCRIPTION = "hmx-tree-cwd";
  const TREE_TITLE_SUBSCRIPTION = "hmx-tree-title";
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let retryId: ReturnType<typeof setInterval> | null = null;

    const install = () => {
      const client = clientRef.current;
      if (!client || cleanup) return false;

      const refresh = () => fetchTree();
      const handleSubscription = (
        name: string,
        _sessionId: string,
        _windowId: string,
        _windowIndex: string,
        paneId: string,
        value: string,
      ) => {
        const field =
          name === TREE_COMMAND_SUBSCRIPTION
            ? "command"
            : name === TREE_CWD_SUBSCRIPTION
              ? "cwd"
              : name === TREE_TITLE_SUBSCRIPTION
                ? "title"
                : null;
        if (!field) return;
        if (!liveTreePaneIdsRef.current.has(paneId)) {
          refresh();
          return;
        }
        setTreeData((prev) => applyTreePaneFieldUpdate(prev, paneId, field, value));
      };
      const handlePaneOutput = (paneId: string, data: string) => {
        if (!liveTreePaneIdsRef.current.has(paneId)) return;

        const priorState = paneTitleParserStatesRef.current.get(paneId) ?? initialPaneOutputTitleParserState();
        const update = parsePaneOutputTitleUpdate(data, priorState);
        if (update.state.carry.length > 0 || update.state.discardingOsc) {
          paneTitleParserStatesRef.current.set(paneId, update.state);
        } else {
          paneTitleParserStatesRef.current.delete(paneId);
        }

        const title = update.title;
        if (title === undefined) return;
        setTreeData((prev) => applyTreePaneFieldUpdate(prev, paneId, "title", title));
      };

      client.on("pane-output", handlePaneOutput);
      client.on("session-renamed", refresh);
      client.on("session-window-changed", refresh);
      client.on("session-changed", refresh);
      client.on("layout-change", refresh);
      client.on("subscription-changed", handleSubscription);
      client.on("window-add", refresh);
      client.on("window-close", refresh);
      client.on("window-pane-changed", refresh);
      client.on("window-renamed", refresh);

      void client.setFormatSubscription(TREE_COMMAND_SUBSCRIPTION, "%*", "#{pane_current_command}").catch(() => {});
      void client.setFormatSubscription(TREE_CWD_SUBSCRIPTION, "%*", "#{pane_current_path}").catch(() => {});
      void client.setFormatSubscription(TREE_TITLE_SUBSCRIPTION, "%*", "#{pane_title}").catch(() => {});

      // Immediate fetch now that the client is confirmed available — the mount
      // useEffect's fetchTree() may have fired before the client was ready.
      refresh();

      cleanup = () => {
        client.off("pane-output", handlePaneOutput);
        client.off("session-renamed", refresh);
        client.off("session-window-changed", refresh);
        client.off("session-changed", refresh);
        client.off("layout-change", refresh);
        client.off("subscription-changed", handleSubscription);
        client.off("window-add", refresh);
        client.off("window-close", refresh);
        client.off("window-pane-changed", refresh);
        client.off("window-renamed", refresh);

        void client.clearFormatSubscription(TREE_COMMAND_SUBSCRIPTION).catch(() => {});
        void client.clearFormatSubscription(TREE_CWD_SUBSCRIPTION).catch(() => {});
        void client.clearFormatSubscription(TREE_TITLE_SUBSCRIPTION).catch(() => {});
      };

      return true;
    };

    if (!install()) {
      retryId = setInterval(() => {
        if (!install() || retryId == null) return;
        clearInterval(retryId);
        retryId = null;
      }, 100);
    }

    return () => {
      if (retryId != null) clearInterval(retryId);
      cleanup?.();
    };
  }, [clientRef, currentSessionName, fetchTree]);

  const rows = treeData ? buildTreeRows(treeData, currentSessionName, paneTabGroups) : [];

  // Expose row count to parent
  if (rowCountRef) rowCountRef.current = rows.length;

  // Report tree counts to parent
  if (onCountsChange && treeData) {
    let paneTabsEnabled = 0;
    for (const group of paneTabGroups.values()) {
      if (group.tabs.length >= 1) paneTabsEnabled += group.tabs.length;
    }
    onCountsChange({
      paneTabsEnabled,
      panes: rows.filter((r) => r.type === "pane").length,
      sessions: rows.filter((r) => r.type === "session").length,
      windows: rows.filter((r) => r.type === "window").length,
    });
  }

  const handleClick = useCallback(
    (row: TreeRow) => {
      const navigatePaneId = row.navigatePaneId ?? row.paneId;
      if (row.type === "pane-tab" && row.slotKey != null && row.tabIndex != null) {
        // Pane-tab child rows represent tabs that may currently live in a
        // hidden staging window. Navigate via the visible host pane, then
        // switch tabs inside the slot.
        if (row.sessionName && row.windowId && navigatePaneId) {
          onNavigate(row.sessionName, row.windowId, navigatePaneId);
        }
        onSwitchPaneTab?.(row.slotKey, row.tabIndex);
      } else if (row.type === "pane" && row.sessionName && row.windowId && navigatePaneId) {
        onNavigate(row.sessionName, row.windowId, navigatePaneId);
      } else if (row.type === "window" && row.sessionName && row.windowId) {
        // Navigate to the first pane in this window
        const windowPanes =
          treeData?.panes
            .filter((p) => p.sessionName === row.sessionName && p.windowId === row.windowId)
            .sort((a, b) => a.index - b.index) ?? [];
        const firstPane = windowPanes[0];
        if (firstPane) {
          onNavigate(row.sessionName!, row.windowId!, firstPane.id);
        }
      } else if (row.type === "session" && row.sessionName) {
        // Navigate to the first window/pane in this session
        const sessionWindows =
          treeData?.windows.filter((w) => w.sessionName === row.sessionName).sort((a, b) => a.index - b.index) ?? [];
        const firstWin = sessionWindows[0];
        if (firstWin) {
          const winPanes =
            treeData?.panes
              .filter((p) => p.sessionName === row.sessionName && p.windowId === firstWin.id)
              .sort((a, b) => a.index - b.index) ?? [];
          const firstPane = winPanes[0];
          if (firstPane) {
            onNavigate(row.sessionName!, firstWin.id, firstPane.id);
          }
        }
      }
    },
    [treeData, onNavigate, onSwitchPaneTab],
  );

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
  useEffect(() => {
    if (!activateRef) return;
    activateRef.current = (idx: number) => {
      const row = rows[idx];
      if (row) handleClick(row);
    };
    return () => {
      if (activateRef) activateRef.current = null;
    };
  });

  if (!treeData) {
    return <text content={padEndToWidth(" Loading...", width)} fg={theme.textDim} />;
  }

  // --- Fixed-width column layout (computed from ALL rows for stable positions) ---
  // Right columns (id, pid, cwd, title) are placed right-to-left with capped widths.
  // The label/node column gets all remaining space so wide terminals show more
  // of the tree labels before truncating.
  // Column widths are floored at their header string length so every column
  // is always shown (even when no row has a value for it), and the header
  // always renders in full.
  const maxIdW = Math.max(stringWidth("id"), ...rows.map((r) => stringWidth(r.id ?? "")));
  const maxPidW = Math.max(stringWidth("pid"), ...rows.map((r) => (r.pid ? stringWidth(String(r.pid)) : 0)));
  const maxCwdW = Math.max(stringWidth("cwd"), ...rows.map((r) => stringWidth(r.cwd ?? "")));
  // Title width is measured across ALL tmux panes (including hidden tab-group
  // staging panes) so swapping pane tabs doesn't resize the column.
  const maxTitleW = Math.max(
    stringWidth("title"),
    ...treeData.panes.map((p) => (p.title ? stringWidth(stripNonPrintingControlChars(p.title)) : 0)),
  );
  const maxPrefixW = Math.max(0, ...rows.map((r) => stringWidth(r.prefix)));
  const minLabelW = 1 + maxPrefixW + 5;

  // Cap narrow data columns so they don't consume excess space
  const cappedIdW = Math.min(maxIdW, 4); // tmux IDs: %4, $1, @3
  const cappedPidW = Math.min(maxPidW, 10); // PIDs rarely exceed 7 digits

  // Determine which columns fit (cascading: id → pid → title → cwd).
  // When space is tight, title is prioritized over cwd — cwd is only shown
  // when there's room for it AND a usable title column beside it.
  const COL_GAP = 2; // spaces between every adjacent column
  const RIGHT_MARGIN = 1; // blank cells past the rightmost column
  const TITLE_MIN = 10; // minimum cells reserved for title before cwd is allowed in
  const showId = minLabelW + COL_GAP + cappedIdW + RIGHT_MARGIN <= width;
  const showPid = showId && minLabelW + COL_GAP + cappedPidW + COL_GAP + cappedIdW + RIGHT_MARGIN <= width;
  const showCwd = showPid;
  const showTitle = showPid;

  // Place columns right-to-left from the right edge.
  // Visually (left→right) the data columns are: title · cwd · pid · id.
  const colPositions: Array<{ align: "left" | "right"; key: string; w: number; x: number }> = [];
  let cursor = width - RIGHT_MARGIN;

  if (showId) {
    cursor -= cappedIdW;
    colPositions.push({ align: "right", key: "id", w: cappedIdW, x: cursor });
    cursor -= COL_GAP;
  }
  if (showPid) {
    cursor -= cappedPidW;
    colPositions.push({ align: "right", key: "pid", w: cappedPidW, x: cursor });
    cursor -= COL_GAP;
  }
  if (showCwd) {
    // Reserve minimum space for title (if any) so it keeps priority over cwd.
    const titleReserve = showTitle ? Math.min(TITLE_MIN, maxTitleW) + COL_GAP : 0;
    const availForCwd = cursor - minLabelW - COL_GAP - titleReserve;
    if (availForCwd >= 5) {
      const effectiveCwdW = Math.min(maxCwdW, availForCwd);
      cursor -= effectiveCwdW;
      colPositions.push({ align: "right", key: "cwd", w: effectiveCwdW, x: cursor });
      cursor -= COL_GAP;
    }
  }
  if (showTitle) {
    const availForTitle = cursor - minLabelW - COL_GAP;
    if (availForTitle >= 5) {
      const effectiveTitleW = Math.min(maxTitleW, availForTitle);
      cursor -= effectiveTitleW;
      colPositions.push({ align: "left", key: "title", w: effectiveTitleW, x: cursor });
      cursor -= COL_GAP;
    }
  }

  const nodeZoneW = cursor;

  // Helper: overlay column values onto a padded line at fixed x positions
  function placeColumns(base: string, cols: Array<{ pos: (typeof colPositions)[0]; val: string }>): string {
    let line = base;
    for (const { pos, val } of cols) {
      const truncated = truncateToWidth(val, pos.w);
      const v = pos.align === "left" ? padEndToWidth(truncated, pos.w) : padStartToWidth(truncated, pos.w);
      line = overlayAtColumn(line, pos.x, v);
    }
    return line;
  }

  // Build header line
  const headerLine = placeColumns(
    padEndToWidth(" tree", width),
    colPositions.map((p) => ({ pos: p, val: p.key })),
  );

  // Scroll (1 row reserved for header)
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

  // Compute the current path once so per-row prefix segments can highlight
  // the line-drawing characters that lead up to the current item.
  const currentPath = computeCurrentTreePath(treeData, currentSessionName, rows, paneTabGroups);

  // Build data lines
  const lines: Array<{ fg: string; left: string; right: string; row: TreeRow | null }> = [];
  const [headerLeft, headerRight] = splitAtColumn(headerLine, nodeZoneW);

  for (const row of visibleRows) {
    const display = fitTreeLabel(row.prefix, row.label, nodeZoneW);

    const isPaneRow = row.type === "pane" || row.type === "pane-tab";
    const line = placeColumns(
      fitToWidth(" " + row.prefix + display, width),
      colPositions.map((p) => ({
        pos: p,
        val:
          p.key === "cwd"
            ? (row.cwd ?? (isPaneRow ? "" : "-"))
            : p.key === "pid"
              ? row.pid
                ? String(row.pid)
                : isPaneRow
                  ? ""
                  : "-"
              : p.key === "title"
                ? (row.title ?? (isPaneRow ? "" : "-"))
                : (row.id ?? ""),
      })),
    );

    const [left, right] = splitAtColumn(line, nodeZoneW);

    const fg = row.current ? theme.textSecondary : row.active ? theme.text : theme.textDim;
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
        const rowIndex = clampedOffset + i;
        const isFocused = focusedRow >= 0 && rowIndex === focusedRow;
        const prefixLen = l.row?.prefix.length ?? 0;
        const cursorChar = isFocused ? "\u25B8" : (l.left[0] ?? " ");
        const restText = l.left.slice(1 + prefixLen);
        const accentFg = isFocused ? theme.textBright : l.fg;
        const bg = isFocused ? theme.bgFocused : undefined;
        const segments = l.row
          ? computeTreePrefixSegments(l.row, rowIndex, currentPath, l.fg, isFocused ? theme.textBright : undefined)
          : [];
        return (
          <box
            backgroundColor={bg}
            flexDirection="row"
            height={1}
            key={rowIndex}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0 && l.row) handleClick(l.row);
            }}
            width={width}
          >
            <text bg={bg} content={cursorChar} fg={accentFg} />
            {segments.map((seg, idx) => (
              <text bg={bg} content={seg.text} fg={seg.fg} key={idx} />
            ))}
            <text bg={bg} content={restText} fg={accentFg} />
            <text bg={bg} content={l.right} fg={isFocused ? theme.textBright : theme.textDim} />
          </box>
        );
      })}
    </box>
  );
}

export function applyTreePaneFieldUpdate(
  data: TreeData | null,
  paneId: string,
  field: TreePaneField,
  rawValue: string,
): TreeData | null {
  if (!data) return data;

  const nextValue =
    field === "command" ? (rawValue.length > 0 ? rawValue : "shell") : rawValue.length > 0 ? rawValue : undefined;

  let changed = false;
  const panes = data.panes.map((pane) => {
    if (pane.id !== paneId) return pane;
    if (pane[field] === nextValue) return pane;
    changed = true;
    return { ...pane, [field]: nextValue };
  });

  return changed ? { ...data, panes } : data;
}

export function buildTreeRows(
  data: TreeData,
  currentSessionName: string,
  paneTabGroups: Map<string, PaneTabGroup>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const { panes, sessions, windows } = data;

  // Root node — shows the tmux server name
  rows.push({
    active: false,
    current: false,
    id: "-",
    label: "\u2299",
    prefix: "",
    type: "root",
  });

  const visibleSessions = sessions.filter((s) => !s.name.startsWith("__hmx-"));

  for (let si = 0; si < visibleSessions.length; si++) {
    const session = visibleSessions[si]!;
    const isCurrent = session.name === currentSessionName;
    // Always use ├─/│ at the root level so the root node's vertical line
    // extends all the way down to the lowest leaf row in the tree.
    const sessBranch = "├─ ";
    const sessContinue = "│  ";
    const displaySessionName = stripNonPrintingControlChars(session.name);

    rows.push({
      active: isCurrent,
      current: isCurrent,
      id: session.id,
      label: "\u25A1 " + displaySessionName,
      prefix: sessBranch,
      sessionName: session.name,
      type: "session",
    });

    const sessionWindows = windows
      .filter((w) => w.sessionName === session.name && !w.name.startsWith("_hmx_"))
      .sort((a, b) => a.index - b.index);

    for (let wi = 0; wi < sessionWindows.length; wi++) {
      const win = sessionWindows[wi]!;
      const isLastWindow = wi === sessionWindows.length - 1;
      const winBranch = isLastWindow ? "└─ " : "├─ ";
      const winContinue = isLastWindow ? "   " : "│  ";
      const displayWindowName = stripNonPrintingControlChars(win.name);

      rows.push({
        active: isCurrent && win.active,
        current: isCurrent && win.active,
        id: win.id,
        label: `\u25A3 ${displayWindowName}`,
        prefix: sessContinue + winBranch,
        sessionName: session.name,
        type: "window",
        windowId: win.id,
      });

      // Non-active tab panes live in _hmx_ staging windows (filtered out
      // above), so no explicit hiding is needed here.
      const windowPanes = panes
        .filter((p) => p.sessionName === session.name && p.windowId === win.id)
        .sort((a, b) => a.index - b.index);

      for (let pi = 0; pi < windowPanes.length; pi++) {
        const pane = windowPanes[pi]!;
        const tabGroup = findTabGroupForPane(pane.id, paneTabGroups);
        const hasTabs = tabGroup != null && tabGroup.tabs.length >= 1;
        const isLastPane = pi === windowPanes.length - 1;
        const paneBranch = isLastPane ? "└─ " : "├─ ";
        const paneContinue = isLastPane ? "   " : "│  ";
        const displayCommand = stripNonPrintingControlChars(pane.command);
        const displayTitle = pane.title ? stripNonPrintingControlChars(pane.title) : undefined;
        const displayRemoteHost = pane.remoteHost ? stripNonPrintingControlChars(pane.remoteHost) : undefined;
        const activeTab = hasTabs ? tabGroup.tabs[tabGroup.activeIndex] : undefined;

        // When a tab group exists, use the active tab's label for the pane row
        // so user-renamed tabs surface at the parent level.
        const activeTabLabel = activeTab ? stripNonPrintingControlChars(activeTab.label) : undefined;
        const paneLabel = activeTabLabel
          ? `\u25A0 ${activeTabLabel}`
          : displayRemoteHost
            ? `↗ ${displayRemoteHost}`
            : `\u25A0 ${displayCommand}`;
        rows.push({
          active: isCurrent && win.active && pane.active,
          current: isCurrent && win.active && pane.active,
          cwd: pane.cwd ? shortenPath(pane.cwd) : undefined,
          // For pane-tab groups, show the stable slot identity on the parent
          // row instead of the live active pane object ID, which changes after
          // swap-pane operations.
          id: hasTabs ? tabGroup.slotKey : pane.id,
          label: paneLabel,
          paneId: pane.id,
          pid: pane.pid || undefined,
          prefix: sessContinue + winContinue + paneBranch,
          sessionName: session.name,
          title: displayTitle,
          type: "pane",
          windowId: win.id,
        });

        if (hasTabs) {
          for (let ti = 0; ti < tabGroup.tabs.length; ti++) {
            const tab = tabGroup.tabs[ti]!;
            const isLastTab = ti === tabGroup.tabs.length - 1;
            const tabBranch = isLastTab ? "└─ " : "├─ ";
            const isActiveTab = ti === tabGroup.activeIndex;

            rows.push({
              active: isCurrent && win.active && pane.active && isActiveTab,
              current: isCurrent && win.active && pane.active && isActiveTab,
              label: "\u02AD " + stripNonPrintingControlChars(tab.label),
              navigatePaneId: pane.id,
              paneId: tab.paneId,
              prefix: sessContinue + winContinue + paneContinue + tabBranch,
              sessionName: session.name,
              slotKey: tabGroup.slotKey,
              tabIndex: ti,
              type: "pane-tab",
              windowId: win.id,
            });
          }
        }
      }
    }
  }

  return rows;
}

export function coalesceTreeData(previous: TreeData | null, next: TreeData): TreeData {
  if (countVisibleTreeWindows(next) === 0 && countVisibleTreeWindows(previous) > 0) {
    return previous ?? next;
  }
  return next;
}

export function computeCurrentTreePath(
  data: TreeData | null,
  currentSessionName: string,
  rows: TreeRow[],
  paneTabGroups: Map<string, PaneTabGroup>,
): CurrentPath {
  const empty: CurrentPath = {
    hostPaneId: undefined,
    paneRowIndex: -1,
    sessionName: currentSessionName,
    sessionRowIndex: -1,
    tabRowIndex: -1,
    windowId: undefined,
    windowRowIndex: -1,
  };
  if (!data) return empty;
  const window = data.windows.find((w) => w.sessionName === currentSessionName && w.active);
  const pane = window
    ? data.panes.find((p) => p.sessionName === currentSessionName && p.windowId === window.id && p.active)
    : undefined;
  const sessionRowIndex = rows.findIndex((r) => r.type === "session" && r.sessionName === currentSessionName);
  const windowRowIndex = window
    ? rows.findIndex((r) => r.type === "window" && r.sessionName === currentSessionName && r.windowId === window.id)
    : -1;
  const paneRowIndex = pane
    ? rows.findIndex((r) => r.type === "pane" && r.sessionName === currentSessionName && r.paneId === pane.id)
    : -1;
  let tabRowIndex = -1;
  if (pane) {
    const tabGroup = findTabGroupForPane(pane.id, paneTabGroups);
    if (tabGroup) {
      tabRowIndex = rows.findIndex(
        (r) =>
          r.type === "pane-tab" &&
          r.sessionName === currentSessionName &&
          r.navigatePaneId === pane.id &&
          r.tabIndex === tabGroup.activeIndex,
      );
    }
  }
  return {
    hostPaneId: pane?.id,
    paneRowIndex,
    sessionName: currentSessionName,
    sessionRowIndex,
    tabRowIndex,
    windowId: window?.id,
    windowRowIndex,
  };
}

/**
 * Split a row's prefix into colored parts. Each 3-cell tree-drawing segment
 * at depth d represents the visual at column (3·d + 1) on this row. The
 * corner char (`├`/`└`/`│`) is the vertical-trunk piece and is rendered in
 * `theme.textSecondary` when it sits on the trunk leading from the root
 * down to the current item (see `isSegmentOnVisualPath`); otherwise it
 * inherits `rowFg`. The trailing `─ ` of an own-branch segment is the
 * horizontal arrow into the row's (dim) label, so it always takes `rowFg`
 * — only an actually-current/active row colors the arrow with its accent.
 * When `forceFg` is provided, every part uses it (keyboard-focused row).
 */
export function computeTreePrefixSegments(
  row: TreeRow,
  rowIndex: number,
  currentPath: CurrentPath,
  rowFg: string,
  forceFg?: string,
): Array<{ fg: string; text: string }> {
  const prefix = row.prefix;
  if (prefix.length === 0) return [];
  const segCount = prefix.length / 3;
  const parts: Array<{ fg: string; text: string }> = [];
  for (let d = 0; d < segCount; d++) {
    const text = prefix.slice(d * 3, d * 3 + 3);
    if (forceFg !== undefined) {
      parts.push({ fg: forceFg, text });
      continue;
    }
    const onPath = isSegmentOnVisualPath(row, d, rowIndex, currentPath);
    const cornerFg = onPath ? theme.textSecondary : rowFg;
    const isOwnBranch = d === segCount - 1;
    if (isOwnBranch) {
      // The corner connects to the trunk; the trailing `─ ` is the arrow
      // into the row's label and must follow the row's own dim/accent.
      parts.push({ fg: cornerFg, text: text[0]! });
      parts.push({ fg: rowFg, text: text.slice(1) });
    } else {
      parts.push({ fg: cornerFg, text });
    }
  }
  return parts;
}

export function fitTreeLabel(prefix: string, label: string, nodeZoneW: number): string {
  const availForLabel = Math.max(0, nodeZoneW - 1 - stringWidth(prefix) - 1);
  return truncateToWidth(label, availForLabel);
}

function countVisibleTreeWindows(data: TreeData | null): number {
  if (!data) return 0;
  return data.windows.filter((window) => !window.name.startsWith("_hmx_")).length;
}

/** Find the tab group a pane belongs to (the Map is keyed by slotKey, not paneId). */
function findTabGroupForPane(paneId: string, paneTabGroups: Map<string, PaneTabGroup>): PaneTabGroup | undefined {
  for (const group of paneTabGroups.values()) {
    if (group.tabs.some((t) => t.paneId === paneId)) return group;
  }
  return undefined;
}

/**
 * Decide whether the prefix segment at `depth` on `row` is part of the
 * visual trunk leading from the root down to the current item. Returns
 * true for segments on rows that are at or above the current ancestor at
 * that depth (sibling order via row index), plus descendants of the
 * current ancestor at that depth.
 */
function isSegmentOnVisualPath(row: TreeRow, depth: number, rowIndex: number, currentPath: CurrentPath): boolean {
  if (row.sessionName == null) return false;

  if (depth === 0) {
    if (currentPath.sessionRowIndex < 0) return false;
    if (rowIndex <= currentPath.sessionRowIndex) return true;
    return row.sessionName === currentPath.sessionName;
  }

  // Deeper segments belong to the current session's own subtree only.
  if (row.sessionName !== currentPath.sessionName) return false;

  if (depth === 1) {
    if (currentPath.windowRowIndex < 0) return false;
    if (rowIndex <= currentPath.windowRowIndex) return true;
    return row.windowId != null && row.windowId === currentPath.windowId;
  }

  if (depth === 2) {
    if (row.windowId == null || row.windowId !== currentPath.windowId) return false;
    if (currentPath.paneRowIndex < 0) return false;
    if (rowIndex <= currentPath.paneRowIndex) return true;
    // Pane-tab rows that descend from the current pane stay on path even
    // though they sit below the current pane row in row order.
    return row.type === "pane-tab" && row.navigatePaneId != null && row.navigatePaneId === currentPath.hostPaneId;
  }

  if (depth === 3) {
    if (row.windowId == null || row.windowId !== currentPath.windowId) return false;
    if (row.navigatePaneId == null || row.navigatePaneId !== currentPath.hostPaneId) return false;
    if (currentPath.tabRowIndex < 0) return false;
    return rowIndex <= currentPath.tabRowIndex;
  }

  return false;
}
