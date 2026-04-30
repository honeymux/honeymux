import type { CliRenderer } from "@opentui/core";
import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { AgentProviderRegistry } from "../../agents/provider.ts";
import type { AgentSessionStore } from "../../agents/session-store.ts";
import type { AgentSession, HookSnifferEntry } from "../../agents/types.ts";
import type { RemoteServerManager } from "../../remote/remote-server-manager.ts";
import type { Base16SchemeName, ThemeMode } from "../../themes/theme.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { TmuxKeyBindings, TmuxWindow } from "../../tmux/types.ts";
import type { HoneymuxConfig, UIMode } from "../../util/config.ts";
import type { KeyAction } from "../../util/keybindings.ts";
import type { PromptClickMode, PromptInputStart } from "../../util/prompt-detect.ts";
import type { PtyBridge } from "../../util/pty.ts";
import type { StatusBarInfo } from "../hooks/use-app-state-groups.ts";

export interface RuntimeDims {
  cols: number;
  height: number;
  rows: number;
  width: number;
}

export interface SetupTmuxRuntimeAgentRuntimeContext {
  activePaneIdRef: MutableRefObject<null | string>;
  muxotronExpandedRef: MutableRefObject<boolean>;
  registryRef: MutableRefObject<AgentProviderRegistry | null>;
  setAgentSessions: Dispatch<SetStateAction<AgentSession[]>>;
  setClaudeDialogPending: Dispatch<SetStateAction<boolean>>;
  setCodexDialogPending: Dispatch<SetStateAction<boolean>>;
  setGeminiDialogPending: Dispatch<SetStateAction<boolean>>;
  setHookSnifferEvents: Dispatch<SetStateAction<HookSnifferEntry[]>>;
  setOpenCodeDialogPending: Dispatch<SetStateAction<boolean>>;
  storeRef: MutableRefObject<AgentSessionStore | null>;
  uiModeRef: MutableRefObject<UIMode>;
}

export interface SetupTmuxRuntimeConfigRuntimeContext {
  setConfig: (value: HoneymuxConfig) => void;
  setConfigThemeBuiltin: (value: Base16SchemeName) => void;
  setConfigThemeMode: (value: ThemeMode) => void;
  setConfigUIMode: (value: UIMode) => void;
  setToolbarOpen: (value: boolean) => void;
}

export interface SetupTmuxRuntimeContext {
  agentRuntime: SetupTmuxRuntimeAgentRuntimeContext;
  configRuntime: SetupTmuxRuntimeConfigRuntimeContext;
  dialogs: SetupTmuxRuntimeDialogsContext;
  input: SetupTmuxRuntimeInputContext;
  mouse: SetupTmuxRuntimeMouseContext;
  sessionRuntime: SetupTmuxRuntimeSessionRuntimeContext;
  sessionState: SetupTmuxRuntimeSessionStateContext;
}

export interface SetupTmuxRuntimeDialogsContext {
  agentInstallDialogRef: MutableRefObject<boolean>;
  dialogInputRef: MutableRefObject<(data: string) => void>;
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  mainMenuCapturingRef: MutableRefObject<boolean>;
  optionsDialogCapturingRef: MutableRefObject<boolean>;
  setMainMenuDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export interface SetupTmuxRuntimeInputContext {
  agentPreviewRef: MutableRefObject<boolean>;
  extendedKeysActiveRef: MutableRefObject<boolean>;
  handleActivateMenuRef: MutableRefObject<() => void>;
  // --- Agent tree navigation ---
  handleAgentLatchRef: MutableRefObject<() => void>;

  handleAgentNextRef: MutableRefObject<() => void>;
  handleAgentPrevRef: MutableRefObject<() => void>;
  handleApplyFavoriteProfile: () => void;
  handleBufferZoomRef: MutableRefObject<() => void>;
  handleCloseQuickTerminalRef: MutableRefObject<() => void>;
  handleDismissRef: MutableRefObject<() => void>;
  handleExitMobileModeRef: MutableRefObject<() => void>;
  handleGotoAgentRef: MutableRefObject<() => void>;
  handleLayoutProfileClick: () => void;
  handleMobileToggleRef: MutableRefObject<() => void>;
  handleMuxotronDismissRef: MutableRefObject<() => void>;
  handleNewPaneTabRef: MutableRefObject<() => void>;
  handleNextPaneTabRef: MutableRefObject<() => void>;
  handleNotificationsClickRef: MutableRefObject<() => void>;
  handleOpenAgentsDialog: () => void;
  handleOpenConversationsRef: MutableRefObject<() => void>;
  handleOpenQuickTerminalRef: MutableRefObject<() => void>;
  handleOptionsClickRef: MutableRefObject<(opts?: { fromMainMenu?: boolean }) => void>;
  handlePrevPaneTabRef: MutableRefObject<() => void>;
  handleQuickApproveRef: MutableRefObject<() => void>;
  handleQuickDenyRef: MutableRefObject<() => void>;
  handleRedrawRef: MutableRefObject<() => void>;
  handleReviewAgentRef: MutableRefObject<(() => void) | null>;
  handleScreenshotRef: MutableRefObject<() => void>;
  handleSessionClickRef: MutableRefObject<() => void>;
  handleSessionNextRef: MutableRefObject<() => void>;
  handleSessionPrevRef: MutableRefObject<() => void>;
  handleSidebarActivateRef: MutableRefObject<() => void>;
  handleSidebarCancelRef: MutableRefObject<() => void>;
  handleSidebarDownRef: MutableRefObject<() => void>;
  handleSidebarFocusRef: MutableRefObject<() => void>;
  handleSidebarLeftRef: MutableRefObject<() => void>;
  handleSidebarRightRef: MutableRefObject<() => void>;
  handleSidebarToggleRef: MutableRefObject<() => void>;
  handleSidebarUpRef: MutableRefObject<() => void>;
  handleSidebarZoomRef: MutableRefObject<() => void>;
  handleTabNext: () => void;
  handleTabPrev: () => void;
  handleTextInputEscape: () => void;
  handleToolbarActivateRef: MutableRefObject<() => void>;
  handleToolbarCancelRef: MutableRefObject<() => void>;
  handleToolbarDismissRef: MutableRefObject<() => void>;
  handleToolbarDownRef: MutableRefObject<() => void>;
  handleToolbarFocusRef: MutableRefObject<() => void>;
  handleToolbarToggleRef: MutableRefObject<() => void>;
  handleToolbarUpRef: MutableRefObject<() => void>;
  handleZoomEndRef: MutableRefObject<(() => void) | null>;
  // --- Modifier zoom ---
  handleZoomStartRef: MutableRefObject<((action: import("../../util/keybindings.ts").KeyAction) => void) | null>;
  interactiveAgentRef: MutableRefObject<AgentSession | null>;
  matchZoomCodeRef: MutableRefObject<((code: number) => import("../../util/keybindings.ts").KeyAction | null) | null>;
  muxotronFocusActiveRef: MutableRefObject<boolean>;
  paneTabBorderClickRef: MutableRefObject<
    ((paneId: string, xOffset: number, paneWidth: number, screenX: number, screenY: number) => boolean) | null
  >;
  reEncodeActiveRef: MutableRefObject<boolean>;
  reviewLatchedRef: MutableRefObject<boolean>;
  sequenceMapRef: MutableRefObject<Map<string, KeyAction>>;
  showHintRef: MutableRefObject<((text: string) => void) | null>;
  sidebarFocusedIndexRef: MutableRefObject<number>;
  sidebarFocusedRef: MutableRefObject<boolean>;
  sidebarItemCountRef: MutableRefObject<number>;
  tmuxPrefixKeyAliasRef: MutableRefObject<null | string>;
  tmuxPrefixSequenceRef: MutableRefObject<null | string>;
  toggleReviewLatchRef: MutableRefObject<(() => void) | null>;
  toolbarFocusedIndexRef: MutableRefObject<number>;
  toolbarInputRef: MutableRefObject<((data: string) => boolean) | null>;
  toolbarOpenRef: MutableRefObject<boolean>;
  validateTabGroups: () => void;
  writeFnRef: MutableRefObject<(data: string) => void>;
  zoomActionRef: MutableRefObject<import("../../util/keybindings.ts").KeyAction | null>;
  zoomStickyRef: MutableRefObject<{ zoomAgentsView: boolean; zoomServerView: boolean }>;
}

export interface SetupTmuxRuntimeMouseContext {
  agentsDialogOpenRef: MutableRefObject<boolean>;
  dropdownOpenRef: MutableRefObject<boolean>;
  ignoreMouseInputRef: MutableRefObject<boolean>;
  layoutDropdownOpenRef: MutableRefObject<boolean>;
  mainMenuDialogOpenRef: MutableRefObject<boolean>;
  mobileModeRef: MutableRefObject<boolean>;
  muxotronExpandedRef: MutableRefObject<boolean>;
  overflowOpenRef: MutableRefObject<boolean>;
  overlayOpenRef: MutableRefObject<boolean>;
  paneTabBorderHitTestRef: MutableRefObject<((paneId: string, xOffset: number) => boolean) | null>;
  paneTabBorderRightClickRef: MutableRefObject<
    ((paneId: string, xOffset: number, screenX: number, screenY: number) => boolean) | null
  >;
  paneTabDragEndRef: MutableRefObject<
    ((sourcePaneId: string, sourceXOffset: number, targetPaneId: null | string, targetXOffset: number) => void) | null
  >;
  paneTabDragMoveRef: MutableRefObject<
    | ((
        sourcePaneId: string,
        sourceXOffset: number,
        targetPaneId: null | string,
        targetXOffset: number,
        screenX: number,
        screenY: number,
      ) => void)
    | null
  >;
  paneTabDraggingRef: MutableRefObject<boolean>;
  qtResizeDragEndRef: MutableRefObject<(() => void) | null>;
  qtResizeDragMoveRef: MutableRefObject<((screenX: number, screenY: number) => void) | null>;
  qtResizeDraggingRef: MutableRefObject<boolean>;
  qtResizeSizeRef: MutableRefObject<number>;
  quickTerminalMenuOpenRef: MutableRefObject<boolean>;
  quickTerminalOpenRef: MutableRefObject<boolean>;
  sidebarDragEndRef: MutableRefObject<(() => void) | null>;
  sidebarDragMoveRef: MutableRefObject<((x: number) => void) | null>;
  sidebarDraggingRef: MutableRefObject<boolean>;
  sidebarOpenRef: MutableRefObject<boolean>;
  sidebarWidthRef: MutableRefObject<number>;
  statusBarBottomOffsetRef: MutableRefObject<number>;
  statusBarClickRef: MutableRefObject<(() => boolean) | null>;
  statusBarTopOffsetRef: MutableRefObject<number>;
  tabDragEndRef: MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef: MutableRefObject<((x: number) => void) | null>;
  tabDraggingRef: MutableRefObject<boolean>;
  tabPressOriginRef: MutableRefObject<null | number>;
  tabRightClickRef: MutableRefObject<((x: number) => void) | null>;
  uiModeRef: MutableRefObject<UIMode>;
}

export interface SetupTmuxRuntimeSessionRuntimeContext {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  deferredSessionRef: MutableRefObject<null | string>;
  detachingRef: MutableRefObject<boolean>;
  dimsRef: MutableRefObject<RuntimeDims>;
  initTargetRef: MutableRefObject<string>;
  inputReady: MutableRefObject<boolean>;
  inputRouterSetup: MutableRefObject<boolean>;
  promptClickStateRef: MutableRefObject<PromptClickMode>;
  promptInputStartRef: MutableRefObject<PromptInputStart | null>;
  ptyRef: MutableRefObject<PtyBridge | null>;
  remoteManagerRef: MutableRefObject<RemoteServerManager | null>;
  renderer: CliRenderer;
  spawnPtyBridge: (targetSession: string) => unknown;
  switchingRef: MutableRefObject<Set<string>>;
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
  textInputActive: MutableRefObject<boolean>;
  tooNarrowRef: MutableRefObject<boolean>;
}

export interface SetupTmuxRuntimeSessionStateContext {
  historyLoadStartedRef: MutableRefObject<boolean>;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setCurrentSessionName: Dispatch<SetStateAction<string>>;
  setHistoryReady: Dispatch<SetStateAction<boolean>>;
  setKeyBindings: Dispatch<SetStateAction<TmuxKeyBindings | null>>;
  setSessionKey: Dispatch<SetStateAction<number>>;
  setSessions: Dispatch<SetStateAction<import("../../tmux/types.ts").TmuxSession[]>>;
  setStatusBarInfo: Dispatch<SetStateAction<StatusBarInfo | null>>;
  setWindows: Dispatch<SetStateAction<TmuxWindow[]>>;
}
