import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabGroup } from "./types.ts";

import { isTmuxClientClosedError } from "../../tmux/control-client.ts";
import { log as hmxLog } from "../../util/log.ts";
import {
  PANE_TAB_STATE_OPTION,
  buildPaneTabPersistState,
  parsePaneTabStateText,
  serializePaneTabState,
} from "../services/session-persistence.ts";
import {
  createPaneTabTmuxEventHandlers,
  registerPaneTabFormatSubscriptions,
  registerPaneTabTmuxEventHandlers,
} from "./event-handlers.ts";
import { type PaneTabInteractionsApi, usePaneTabInteractions } from "./interactions.ts";
import { buildPaneCycleModel } from "./navigation.ts";
import { createPaneTabOpQueue } from "./op-queue.ts";
import { type PaneTabOps, createPaneTabOps } from "./ops.ts";
import { findPaneTabGroupByPaneId, findPaneTabGroupForWindow, hasRefreshablePaneTabLabels } from "./selectors.ts";

export { hasRefreshablePaneTabLabels, paneNeedsPaneTabLabelRefresh } from "./selectors.ts";
export type { PaneTab, PaneTabGroup } from "./types.ts";

export interface PaneTabsApi extends PaneTabInteractionsApi {
  getPaneTabGroup: (paneId: string) => PaneTabGroup | undefined;
  getPaneTabGroupForWindow: (windowId: string) => PaneTabGroup | undefined;
  /** Close the active tab. Returns true if handled (pane was in a tab group). */
  handleClosePaneTab: () => Promise<boolean>;
  /** Close a specific tab by index. Returns true if handled. */
  handleClosePaneTabAt: (slotKey: string, tabIndex: number) => Promise<boolean>;
  /**
   * Drop any single-tab pane-tab group owning this pane, without clearing
   * the pane's border format. Used when the pane is transitioning to a new
   * owner (e.g. remote conversion) that will manage its own border format.
   */
  handleEvictPaneFromGroup: (paneId: string) => Promise<void>;
  handleNewPaneTab: () => Promise<void>;
  handleNextPaneTab: () => Promise<void>;
  handlePrevPaneTab: () => Promise<void>;
  /** Rename the tmux host window for a managed pane-tab group. */
  handleRenameManagedWindow: (windowId: string, newName: string) => Promise<boolean>;
  /** Rename a specific tab. Empty name clears user override (reverts to auto-naming). */
  handleRenamePaneTab: (slotKey: string, tabIndex: number, newName: string) => Promise<void>;
  handleSwitchPaneTab: (slotKey: string, tabIndex: number) => Promise<void>;
  paneTabGroups: Map<string, PaneTabGroup>;
  /** Validate tab groups against live tmux panes, removing dead tabs and dissolving stale groups. */
  validateTabGroups: () => void;
}

interface UsePaneTabsOptions {
  /** Tracks the focused pane in the active window from tmux events. */
  activePaneIdRef: MutableRefObject<null | string>;
  /** Must be kept in sync with the active window ID from tmuxSessionState. */
  activeWindowIdRef: MutableRefObject<null | string>;
  clientRef: MutableRefObject<TmuxControlClient | null>;
  /** True once the control client has connected to tmux. */
  connected: boolean;
  currentSessionName: string;
  /** When false, the hook returns an inert API and performs no side effects. */
  enabled: boolean;
  /** Increments whenever the tmux runtime is recreated with a new control client. */
  runtimeKey: number;
}

type WindowPaneInfo = {
  active: boolean;
  height: number;
  id: string;
  width: number;
};

export function resolveActivePaneIndex(panes: WindowPaneInfo[], activePaneId: null | string): number {
  if (activePaneId) {
    const preferredIndex = panes.findIndex((pane) => pane.id === activePaneId);
    if (preferredIndex >= 0) return preferredIndex;
  }
  const tmuxActiveIndex = panes.findIndex((pane) => pane.active);
  if (tmuxActiveIndex >= 0) return tmuxActiveIndex;
  return panes.length > 0 ? 0 : -1;
}

export function usePaneTabs({
  activePaneIdRef,
  activeWindowIdRef,
  clientRef,
  connected,
  currentSessionName,
  enabled,
  runtimeKey,
}: UsePaneTabsOptions): PaneTabsApi {
  const [paneTabGroups, setPaneTabGroups] = useState<Map<string, PaneTabGroup>>(new Map());
  // groupsRef is the source of truth — only commitGroups() writes to it.
  // Do NOT sync it from paneTabGroups on every render: a re-render triggered
  // by an unrelated state change (e.g. setWindows from %session-window-changed)
  // can race with an in-flight doSwitchTab, reverting activeIndex to its
  // pre-switch value before commitGroups has a chance to run.
  const groupsRef = useRef(paneTabGroups);

  const borderLinesRef = useRef("single");
  const opQueueRef = useRef<ReturnType<typeof createPaneTabOpQueue> | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const restoredSessionRef = useRef<null | string>(null);
  if (!opQueueRef.current) {
    opQueueRef.current = createPaneTabOpQueue();
  }
  const opQueue = opQueueRef.current;

  // ── Shared helpers ─────────────────────────────────────────────────

  /** Commit updated groups to ref + state, and persist into tmux session state. */
  const commitGroups = useCallback(
    (groups: Map<string, PaneTabGroup>) => {
      groupsRef.current = groups;
      setPaneTabGroups(groups);

      const persistedStateText =
        groups.size > 0 ? serializePaneTabState(buildPaneTabPersistState(groups, borderLinesRef.current)) : null;

      persistQueueRef.current = persistQueueRef.current.finally(async () => {
        const client = clientRef.current;
        if (!client) return;
        await client
          .setSessionUserOption(currentSessionName, PANE_TAB_STATE_OPTION, persistedStateText)
          .catch(() => {});
      });
    },
    [clientRef, currentSessionName],
  );

  /**
   * Get the active pane by querying the specific window from app state.
   * list-panes without -t uses the control client's current window which
   * can diverge from the session's active window shown via the PTY bridge.
   */
  const getActiveSlotKey = useCallback(async (): Promise<{
    height: number;
    paneId: string;
    slotKey: string;
    width: number;
  } | null> => {
    const client = clientRef.current;
    if (!client) return null;

    const windowId = activeWindowIdRef.current;
    if (!windowId) return null;

    let panes: Awaited<ReturnType<typeof client.listPanesInWindow>>;
    try {
      panes = await client.listPanesInWindow(windowId);
    } catch {
      // Window may have been destroyed by a racing exit hook.
      return null;
    }
    const activePaneIndex = resolveActivePaneIndex(panes, activePaneIdRef.current);
    const active = activePaneIndex >= 0 ? panes[activePaneIndex] : null;
    if (!active) return null;

    const existingGroup = findPaneTabGroupByPaneId(groupsRef.current, active.id);
    if (existingGroup) {
      return {
        height: existingGroup.slotHeight,
        paneId: active.id,
        slotKey: existingGroup.slotKey,
        width: existingGroup.slotWidth,
      };
    }

    return { height: active.height, paneId: active.id, slotKey: active.id, width: active.width };
  }, [clientRef, activePaneIdRef, activeWindowIdRef]);

  const paneTabOpsRef = useRef<PaneTabOps | null>(null);
  paneTabOpsRef.current = createPaneTabOps({
    activeWindowIdRef,
    borderLinesRef,
    clientRef,
    commitGroups,
    currentSessionName,
    emitLayoutChange: () => {
      const emitter = clientRef.current as unknown as {
        emit?: (event: string, ...args: string[]) => void;
      } | null;
      emitter?.emit?.("layout-change", "", "");
    },
    getActiveSlotKey,
    groupsRef,
    loadPaneTabState: async (sessionName: string) => {
      const client = clientRef.current;
      if (!client) return null;
      return parsePaneTabStateText(await client.getSessionUserOption(sessionName, PANE_TAB_STATE_OPTION));
    },
    log: () => {},
  });

  const enqueuePaneTabOp = useCallback(
    <T>(op: (paneTabOps: PaneTabOps) => Promise<T>, fallback: T): Promise<T> => {
      const paneTabOps = paneTabOpsRef.current;
      if (!paneTabOps) return Promise.resolve(fallback);
      return opQueue
        .enqueue(() => op(paneTabOps))
        .catch((error) => {
          if (!isTmuxClientClosedError(error)) throw error;
          const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
          hmxLog("pane-tabs", `ignored operation after tmux client closed error=${message}`);
          return fallback;
        });
    },
    [opQueue],
  );

  const queuePaneTabOp = useCallback(
    (op: (paneTabOps: PaneTabOps) => Promise<void>) => {
      void enqueuePaneTabOp(op, undefined).catch(() => {});
    },
    [enqueuePaneTabOp],
  );

  // ── Public API handlers (thin wrappers that serialize via queue) ───

  const handleNewPaneTab = useCallback(async () => {
    if (!enabled) return;
    await enqueuePaneTabOp((paneTabOps) => paneTabOps.doNewTab(), undefined);
  }, [enabled, enqueuePaneTabOp]);

  const handleSwitchPaneTab = useCallback(
    async (slotKey: string, tabIndex: number) => {
      await enqueuePaneTabOp((paneTabOps) => paneTabOps.doSwitchTab(slotKey, tabIndex), undefined);
    },
    [enqueuePaneTabOp],
  );

  const navigatePaneCycle = useCallback(
    async (delta: -1 | 1) => {
      const client = clientRef.current;
      const windowId = activeWindowIdRef.current;
      if (!client || !windowId) return;

      const panes = await client.listPanesInWindow(windowId);
      if (panes.length === 0) return;

      const activePaneIdx = resolveActivePaneIndex(panes, activePaneIdRef.current);
      if (activePaneIdx === -1) return;
      const { currentIndex: currentIdx, entries } = buildPaneCycleModel({
        activePaneIndex: activePaneIdx,
        enabled,
        groups: groupsRef.current,
        panes,
      });

      if (entries.length <= 1 || currentIdx === -1) return;

      const targetIdx = (currentIdx + delta + entries.length) % entries.length;
      const target = entries[targetIdx]!;
      const current = entries[currentIdx]!;
      const sameSlot = target.slotKey != null && target.slotKey === current.slotKey;

      if (target.slotKey != null && target.tabIndex != null) {
        const group = groupsRef.current.get(target.slotKey);
        if (group && target.tabIndex !== group.activeIndex) {
          await enqueuePaneTabOp((paneTabOps) => paneTabOps.doSwitchTab(target.slotKey!, target.tabIndex!), undefined);
        }
        if (!sameSlot) {
          await client.selectPane(target.paneId);
        }
      } else {
        await client.selectPane(target.paneId);
      }
    },
    [activePaneIdRef, activeWindowIdRef, clientRef, enabled, enqueuePaneTabOp],
  );

  const handleNextPaneTab = useCallback(async () => {
    await navigatePaneCycle(1);
  }, [navigatePaneCycle]);

  const handlePrevPaneTab = useCallback(async () => {
    await navigatePaneCycle(-1);
  }, [navigatePaneCycle]);

  const handleClosePaneTab = useCallback(async (): Promise<boolean> => {
    return await enqueuePaneTabOp((paneTabOps) => paneTabOps.doCloseTab(), false);
  }, [enqueuePaneTabOp]);

  const handleEvictPaneFromGroup = useCallback(
    async (paneId: string): Promise<void> => {
      await enqueuePaneTabOp((paneTabOps) => paneTabOps.doEvictPaneFromGroup(paneId), undefined);
    },
    [enqueuePaneTabOp],
  );

  const getPaneTabGroup = useCallback((paneId: string): PaneTabGroup | undefined => {
    return findPaneTabGroupByPaneId(groupsRef.current, paneId);
  }, []);

  const getPaneTabGroupForWindow = useCallback((windowId: string): PaneTabGroup | undefined => {
    return findPaneTabGroupForWindow(groupsRef.current, windowId);
  }, []);

  const handleRenamePaneTab = useCallback(
    async (slotKey: string, tabIndex: number, newName: string) => {
      await enqueuePaneTabOp((paneTabOps) => paneTabOps.doRenamePaneTab(slotKey, tabIndex, newName), undefined);
    },
    [enqueuePaneTabOp],
  );

  const handleRenameManagedWindow = useCallback(
    async (windowId: string, newName: string): Promise<boolean> => {
      return await enqueuePaneTabOp((paneTabOps) => paneTabOps.doRenameManagedWindow(windowId, newName), false);
    },
    [enqueuePaneTabOp],
  );

  const handleClosePaneTabAt = useCallback(
    async (slotKey: string, tabIndex: number): Promise<boolean> => {
      return await enqueuePaneTabOp((paneTabOps) => paneTabOps.doClosePaneTabAt(slotKey, tabIndex), false);
    },
    [enqueuePaneTabOp],
  );

  const queueReorderPaneTab = useCallback(
    (slotKey: string, fromIndex: number, toIndex: number) => {
      queuePaneTabOp((paneTabOps) => paneTabOps.doReorderPaneTab(slotKey, fromIndex, toIndex));
    },
    [queuePaneTabOp],
  );

  const queueMovePaneTab = useCallback(
    (fromSlotKey: string, fromTabIndex: number, toSlotKey: string, toInsertIndex: number) => {
      queuePaneTabOp((paneTabOps) => paneTabOps.doMovePaneTab(fromSlotKey, fromTabIndex, toSlotKey, toInsertIndex));
    },
    [queuePaneTabOp],
  );

  const queueMoveToUngroupedPane = useCallback(
    (fromSlotKey: string, fromTabIndex: number, targetPaneId: string, insertIndex: number) => {
      queuePaneTabOp((paneTabOps) =>
        paneTabOps.doMoveToUngroupedPane(fromSlotKey, fromTabIndex, targetPaneId, insertIndex),
      );
    },
    [queuePaneTabOp],
  );

  const paneTabInteractions = usePaneTabInteractions({
    borderLinesRef,
    clientRef,
    enabled,
    getPaneTabGroup,
    groupsRef,
    movePaneTab: queueMovePaneTab,
    moveToUngroupedPane: queueMoveToUngroupedPane,
    reorderPaneTab: queueReorderPaneTab,
    switchPaneTab: (slotKey: string, tabIndex: number) => {
      void handleSwitchPaneTab(slotKey, tabIndex);
    },
  });

  // validateTabGroups: triggered by tmux events, the pane_dead subscription,
  // and a periodic poll fallback (see the setInterval effect below).  The
  // queue defers validation if a tab mutation is already running so
  // dead-pane reconciliation uses the same serialized path.
  const validateTabGroups = useCallback(() => {
    opQueue.requestValidation(async () => {
      const paneTabOps = paneTabOpsRef.current;
      if (!paneTabOps || groupsRef.current.size === 0) return;
      try {
        await paneTabOps.doValidate();
      } catch (error) {
        hmxLog(
          "pane-tabs",
          `validate error error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        throw error;
      }
    });
  }, [opQueue]);

  const labelRefreshQueuedRef = useRef(false);
  const queueLabelRefresh = useCallback(() => {
    const hasRefreshable = hasRefreshablePaneTabLabels(groupsRef.current);
    if (!hasRefreshable || labelRefreshQueuedRef.current) return;
    labelRefreshQueuedRef.current = true;
    queuePaneTabOp(async (paneTabOps) => {
      try {
        await paneTabOps.doRefreshLabels();
      } finally {
        labelRefreshQueuedRef.current = false;
      }
    });
  }, [queuePaneTabOp]);

  const queueBootstrapUngroupedPanes = useCallback(() => {
    queuePaneTabOp((paneTabOps) => paneTabOps.doBootstrapUngroupedPanes());
  }, [queuePaneTabOp]);

  // Dissolve all tab groups when pane tabs are disabled at runtime.
  const prevEnabledRef = useRef(enabled);
  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    prevEnabledRef.current = enabled;
    if (wasEnabled && !enabled && connected && groupsRef.current.size > 0) {
      queuePaneTabOp((paneTabOps) => paneTabOps.doDissolveAll());
    }
  }, [connected, enabled, queuePaneTabOp]);

  // Restore persisted pane tab state from the tmux session after connecting.
  // This handles detach/reattach: the React state is gone but the
  // tmux panes, staging window, pane options, and session user options survive.
  // Also re-runs on session switch so each session restores its own state.
  useEffect(() => {
    if (!enabled || !connected) return;
    if (restoredSessionRef.current === currentSessionName) return;
    restoredSessionRef.current = currentSessionName;
    queuePaneTabOp(async (paneTabOps) => {
      await paneTabOps.doRestore();
      await paneTabOps.doBootstrapUngroupedPanes();
    });
  }, [connected, currentSessionName, enabled, queuePaneTabOp]);

  useEffect(() => {
    if (!enabled || !connected) return;
    let cleanup: (() => void) | null = null;
    let retryId: ReturnType<typeof setInterval> | null = null;

    const install = () => {
      const client = clientRef.current;
      if (!client || cleanup) return false;

      const handlers = createPaneTabTmuxEventHandlers({
        commitGroups,
        getGroups: () => groupsRef.current,
        queueBootstrap: queueBootstrapUngroupedPanes,
        queueLabelRefresh,
        validateTabGroups,
      });
      const cleanupSubscriptions = registerPaneTabFormatSubscriptions(client);
      const cleanupHandlers = registerPaneTabTmuxEventHandlers(client, handlers);
      cleanup = () => {
        cleanupHandlers();
        cleanupSubscriptions();
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
  }, [
    commitGroups,
    connected,
    enabled,
    queueBootstrapUngroupedPanes,
    queueLabelRefresh,
    runtimeKey,
    validateTabGroups,
  ]);

  return {
    getPaneTabGroup,
    getPaneTabGroupForWindow,
    handleClosePaneTab,
    handleClosePaneTabAt,
    handleEvictPaneFromGroup,
    handleNewPaneTab,
    handleNextPaneTab,
    handlePrevPaneTab,
    handleRenameManagedWindow,
    handleRenamePaneTab,
    handleSwitchPaneTab,
    paneTabGroups,
    ...paneTabInteractions,
    validateTabGroups,
  };
}
