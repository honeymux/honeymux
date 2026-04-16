import type { CliRenderer } from "@opentui/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useCallback } from "react";

import type { AgentSession } from "../../agents/types.ts";
import type { AgentActionsApi } from "./use-agent-actions.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { enterBufferZoom } from "../../util/buffer-zoom.ts";

interface CompleteReviewGotoOptions {
  activePaneIdRef: MutableRefObject<null | string>;
  clearTreeSelectedSession: () => void;
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  handleGoToPane: (session: AgentSession) => void;
  handleSidebarCancel?: () => void;
  handleToolbarCancel?: () => void;
  handleZoomEnd?: () => void;
  paneFocusPollMs?: number;
  paneFocusTimeoutMs?: number;
  postTeardownSettleMs?: number;
  retryPaneFocusTimeoutMs?: number;
  session: AgentSession;
  setAgentsDialogOpen: Dispatch<SetStateAction<boolean>>;
}

interface PaneBorderMenuAnchor {
  screenX: number;
  screenY: number;
}

interface UseAppRuntimeShortcutsOptions {
  agentActions: Pick<
    AgentActionsApi,
    | "handleAgentsDialogSelect"
    | "handleGoToPane"
    | "handleOpenQuickTerminal"
    | "handlePermissionRespond"
    | "handleQuickTerminalClose"
  >;
  agentSessions: AgentSession[];
  bufferZoomFade: boolean;
  bufferZoomMaxLines: number;
  clearTreeSelectedSession: () => void;
  handleRedraw: UiActionsApi["handleRedraw"];
  openPaneBorderMenu: (paneId: string, screenX: number, screenY: number) => void;
  openScreenshotDialog: () => void;
  refs: AppRuntimeRefs;
  renderer: CliRenderer;
  setAgentsDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsMobileMode: Dispatch<SetStateAction<boolean>>;
  sidebarOpen: boolean;
  sidebarWidth: number;
  suppressPassthroughRef: MutableRefObject<boolean>;
  treeSelectedSessionRef: MutableRefObject<AgentSession | null>;
}

interface WaitForActivePaneOptions {
  activePaneIdRef: MutableRefObject<null | string>;
  paneId: string;
  pollMs?: number;
  timeoutMs?: number;
}

export async function completeReviewGoto({
  activePaneIdRef,
  clearTreeSelectedSession,
  dropdownInputRef,
  handleGoToPane,
  handleSidebarCancel,
  handleToolbarCancel,
  handleZoomEnd,
  paneFocusPollMs,
  paneFocusTimeoutMs,
  postTeardownSettleMs = 20,
  retryPaneFocusTimeoutMs,
  session,
  setAgentsDialogOpen,
}: CompleteReviewGotoOptions): Promise<void> {
  const targetPaneId = session.paneId ?? null;

  handleGoToPane(session);
  if (targetPaneId) {
    await waitForActivePane({
      activePaneIdRef,
      paneId: targetPaneId,
      pollMs: paneFocusPollMs,
      timeoutMs: paneFocusTimeoutMs,
    });
  }
  handleZoomEnd?.();
  dropdownInputRef.current = null;
  setAgentsDialogOpen(false);
  clearTreeSelectedSession();
  handleSidebarCancel?.();
  handleToolbarCancel?.();

  if (!targetPaneId) return;

  await waitForDelay(postTeardownSettleMs);
  if (activePaneIdRef.current === targetPaneId) return;

  // Review teardown is the only path that can still steal focus back to the
  // pre-sidebar pane. If that happens, replay goto once from the settled
  // post-review state.
  handleGoToPane(session);
  await waitForActivePane({
    activePaneIdRef,
    paneId: targetPaneId,
    pollMs: paneFocusPollMs,
    timeoutMs: retryPaneFocusTimeoutMs ?? paneFocusTimeoutMs,
  });
}

export function getDismissTargetSession(
  selectedSession: AgentSession | null,
  agentSessions: AgentSession[],
): AgentSession | undefined {
  if (selectedSession) return selectedSession;
  return agentSessions
    .filter((session) => session.status === "unanswered" && !session.dismissed)
    .sort((a, b) => a.startedAt - b.startedAt)[0];
}

export function getPaneBorderMenuAnchor(
  pane: { left: number; top: number; width: number },
  sidebarOpen: boolean,
  sidebarWidth: number,
): PaneBorderMenuAnchor {
  const sidebarOffset = sidebarOpen ? sidebarWidth + 1 : 0;
  return {
    screenX: sidebarOffset + 1 + pane.left + pane.width - 2,
    screenY: pane.top + 3,
  };
}

export function getTargetOrFirstWaitingSession(
  selectedSession: AgentSession | null,
  agentSessions: AgentSession[],
): AgentSession | undefined {
  if (selectedSession) return selectedSession;
  return agentSessions
    .filter((session) => session.status === "unanswered")
    .sort((a, b) => a.startedAt - b.startedAt)[0];
}

export function useAppRuntimeShortcuts({
  agentActions,
  agentSessions,
  bufferZoomFade,
  bufferZoomMaxLines,
  clearTreeSelectedSession,
  handleRedraw,
  openPaneBorderMenu,
  openScreenshotDialog,
  refs,
  renderer,
  setAgentsDialogOpen,
  setIsMobileMode,
  sidebarOpen,
  sidebarWidth,
  suppressPassthroughRef,
  treeSelectedSessionRef,
}: UseAppRuntimeShortcutsOptions): void {
  const handleMobileToggle = useCallback(() => {
    setIsMobileMode((previous) => !previous);
  }, [setIsMobileMode]);

  const {
    activePaneIdRef,
    clientRef,
    dialogMenuToggleRef,
    dropdownInputRef,
    handleActivateMenuRef,
    handleAgentLatchRef,
    handleBufferZoomRef,
    handleCloseQuickTerminalRef,
    handleDismissRef,
    handleExitMobileModeRef,
    handleGotoAgentRef,
    handleMobileToggleRef,
    handleOpenQuickTerminalRef,
    handleQuickApproveRef,
    handleQuickDenyRef,
    handleScreenshotRef,
    handleSidebarCancelRef,
    handleToolbarCancelRef,
    handleZoomEndRef,
    handleZoomStartRef,
    muxotronFocusActiveRef,
    showHintRef,
    statusBarClickRef,
    storeRef,
    terminalRef,
  } = refs;

  const getTargetOrFirstWaiting = () => getTargetOrFirstWaitingSession(treeSelectedSessionRef.current, agentSessions);

  handleQuickApproveRef.current = () => {
    const session = getTargetOrFirstWaiting();
    if (session && session.status === "unanswered") {
      const permissionId = session.lastEvent?.toolUseId ?? session.sessionId;
      agentActions.handlePermissionRespond(session.sessionId, permissionId, "allow");
      handleZoomEndRef.current?.();
      dropdownInputRef.current = null;
      setAgentsDialogOpen(false);
      clearTreeSelectedSession();
    }
  };

  handleQuickDenyRef.current = () => {
    const session = getTargetOrFirstWaiting();
    if (session && session.status === "unanswered") {
      const permissionId = session.lastEvent?.toolUseId ?? session.sessionId;
      agentActions.handlePermissionRespond(session.sessionId, permissionId, "deny");
      handleZoomEndRef.current?.();
      dropdownInputRef.current = null;
      setAgentsDialogOpen(false);
      clearTreeSelectedSession();
    }
  };

  handleGotoAgentRef.current = () => {
    const session = getTargetOrFirstWaiting();
    if (session) {
      void completeReviewGoto({
        activePaneIdRef,
        clearTreeSelectedSession,
        dropdownInputRef,
        handleGoToPane: agentActions.handleGoToPane,
        handleSidebarCancel: handleSidebarCancelRef.current,
        handleToolbarCancel: handleToolbarCancelRef.current,
        handleZoomEnd: handleZoomEndRef.current ?? undefined,
        session,
        setAgentsDialogOpen,
      });
    }
  };

  handleDismissRef.current = () => {
    const session = getDismissTargetSession(treeSelectedSessionRef.current, agentSessions);
    if (session) {
      storeRef.current?.dismissSession(session.sessionId);
      clearTreeSelectedSession();
    }
  };

  handleAgentLatchRef.current = () => {
    // Context-sensitive agent latch binding: when no review session is active,
    // focus the muxotron on the oldest unanswered agent (mirroring
    // the permission-context tap behavior of `zoomAgentsView`). Latch
    // toggling for tree-selected sessions is handled in the router via
    // `onReviewLatchToggle` before this callback is reached.
    if (muxotronFocusActiveRef.current) {
      handleZoomEndRef.current?.();
    } else {
      handleZoomStartRef.current?.("zoomAgentsView");
    }
  };

  handleOpenQuickTerminalRef.current = agentActions.handleOpenQuickTerminal;
  handleCloseQuickTerminalRef.current = agentActions.handleQuickTerminalClose;
  handleScreenshotRef.current = openScreenshotDialog;
  handleBufferZoomRef.current = () => {
    void enterBufferZoom({
      clientRef,
      fade: bufferZoomFade,
      handleRedraw,
      kittyKeyboardFlags: 15,
      maxLines: bufferZoomMaxLines,
      renderer,
      suppressPassthroughRef,
      terminalRef,
    }).catch((error) => {
      showHintRef.current?.(error instanceof Error ? error.message : "Scrollback failed");
    });
  };

  handleMobileToggleRef.current = handleMobileToggle;
  handleExitMobileModeRef.current = () => setIsMobileMode(false);

  statusBarClickRef.current = null;

  handleActivateMenuRef.current = async () => {
    // If a dialog has registered a hamburger menu toggle, use it.
    const dialogToggle = dialogMenuToggleRef.current;
    if (dialogToggle) {
      dialogToggle();
      return;
    }

    const paneId = activePaneIdRef.current;
    const client = clientRef.current;
    if (!paneId || !client) return;

    try {
      const panes = await client.getAllPaneInfo();
      const pane = panes.find((candidate) => candidate.id === paneId);
      if (!pane) return;
      const { screenX, screenY } = getPaneBorderMenuAnchor(pane, sidebarOpen, sidebarWidth);
      openPaneBorderMenu(paneId, screenX, screenY);
    } catch {
      // Session may be disconnected.
    }
  };
}

export function waitForActivePane({
  activePaneIdRef,
  paneId,
  pollMs = 10,
  timeoutMs = 250,
}: WaitForActivePaneOptions): Promise<boolean> {
  if (activePaneIdRef.current === paneId) return Promise.resolve(true);

  return new Promise((resolve) => {
    let finished = false;
    const finish = (focused: boolean) => {
      if (finished) return;
      finished = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      resolve(focused);
    };
    const intervalId = setInterval(() => {
      if (activePaneIdRef.current === paneId) {
        finish(true);
      }
    }, pollMs);
    const timeoutId = setTimeout(() => {
      finish(activePaneIdRef.current === paneId);
    }, timeoutMs);
  });
}

function waitForDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
