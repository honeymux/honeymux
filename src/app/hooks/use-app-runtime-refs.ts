import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import { useRef } from "react";

import type { AgentProviderRegistry } from "../../agents/provider.ts";
import type { AgentSessionStore } from "../../agents/session-store.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { RemoteServerManager } from "../../remote/remote-server-manager.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { UIMode } from "../../util/config.ts";
import type { KeyAction } from "../../util/keybindings.ts";
import type { PromptClickMode, PromptInputStart } from "../../util/prompt-detect.ts";
import type { PtyBridge } from "../../util/pty.ts";
import type { RuntimeDims } from "../runtime/runtime-context.ts";

export interface AppRuntimeRefs {
  /** Pane ID of the currently focused pane. */
  activePaneIdRef: MutableRefObject<null | string>;
  /** Adds a persistent info item to the notifications queue. Assigned by
   * useNotificationsReview so earlier hooks can enqueue notifications. */
  addInfoRef: MutableRefObject<((id: string, message: string | string[]) => void) | null>;
  agentInstallDialogRef: MutableRefObject<boolean>;
  /** Installed by the agents dialog for dialog-local next/prev navigation. */
  agentNavNextRef: MutableRefObject<(() => void) | null>;
  agentNavPrevRef: MutableRefObject<(() => void) | null>;
  /** True when a tree-selected agent is being previewed (not yet latched). */
  agentPreviewRef: MutableRefObject<boolean>;
  clientRef: MutableRefObject<TmuxControlClient | null>;
  deferredSessionRef: MutableRefObject<null | string>;
  dialogInputRef: MutableRefObject<(data: string) => void>;
  /** Registered by the currently open dialog's hamburger menu toggle (if any). */
  dialogMenuToggleRef: MutableRefObject<(() => void) | null>;
  dimsRef: MutableRefObject<RuntimeDims>;
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  handleActivateMenuRef: MutableRefObject<() => void>;
  /** Context-sensitive agent latch binding (agentLatch): latches/unlatches
   * the tree-selected review session, or falls through to a muxotron zoom
   * onto the oldest unanswered agent. */
  handleAgentLatchRef: MutableRefObject<() => void>;
  handleAgentNextRef: MutableRefObject<() => void>;
  handleAgentPrevRef: MutableRefObject<() => void>;
  handleBufferZoomRef: MutableRefObject<() => void>;
  handleCloseQuickTerminalRef: MutableRefObject<() => void>;
  handleDismissRef: MutableRefObject<() => void>;
  handleExitMobileModeRef: MutableRefObject<() => void>;
  handleGotoAgentRef: MutableRefObject<() => void>;
  handleMobileToggleRef: MutableRefObject<() => void>;
  handleMuxotronDismissRef: MutableRefObject<() => void>;
  handleNewPaneTabRef: MutableRefObject<() => void>;
  handleNextPaneTabRef: MutableRefObject<() => void>;
  handleNotificationsClickRef: MutableRefObject<() => void>;
  handleOpenQuickTerminalRef: MutableRefObject<() => void>;
  handleOptionsClickRef: MutableRefObject<() => void>;
  handlePrevPaneTabRef: MutableRefObject<() => void>;
  handleQuickApproveRef: MutableRefObject<() => void>;
  handleQuickDenyRef: MutableRefObject<() => void>;
  handleRedrawRef: MutableRefObject<() => void>;
  /** Enters the muxotron review/preview workflow with the first agent. */
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
  handleToolbarActivateRef: MutableRefObject<() => void>;
  handleToolbarCancelRef: MutableRefObject<() => void>;
  handleToolbarDismissRef: MutableRefObject<() => void>;
  handleToolbarDownRef: MutableRefObject<() => void>;
  handleToolbarFocusRef: MutableRefObject<() => void>;
  handleToolbarToggleRef: MutableRefObject<() => void>;
  handleToolbarUpRef: MutableRefObject<() => void>;
  handleZoomEndRef: MutableRefObject<(() => void) | null>;
  handleZoomStartRef: MutableRefObject<((action: KeyAction) => void) | null>;
  ignoreMouseInputRef: MutableRefObject<boolean>;
  inputReady: MutableRefObject<boolean>;
  inputRouterSetup: MutableRefObject<boolean>;
  /** Non-null while the focused muxotron view is attached to an agent pane PTY. */
  interactiveAgentRef: MutableRefObject<AgentSession | null>;
  layoutDropdownOpenRef: MutableRefObject<boolean>;
  mainMenuCapturingRef: MutableRefObject<boolean>;
  matchZoomCodeRef: MutableRefObject<((code: number) => KeyAction | null) | null>;
  mobileModeRef: MutableRefObject<boolean>;
  /** True when the Mux-o-Tron is expanded to full width (adaptive mode, non-dismissed unanswered agent). */
  muxotronExpandedRef: MutableRefObject<boolean>;
  muxotronFocusActiveRef: MutableRefObject<boolean>;
  optionsDialogCapturingRef: MutableRefObject<boolean>;
  overflowOpenRef: MutableRefObject<boolean>;
  promptClickStateRef: MutableRefObject<PromptClickMode>;
  promptInputStartRef: MutableRefObject<PromptInputStart | null>;
  ptyDragActiveRef: MutableRefObject<((active: boolean) => void) | null>;
  ptyRef: MutableRefObject<PtyBridge | null>;
  qtResizeDragEndRef: MutableRefObject<(() => void) | null>;
  qtResizeDragMoveRef: MutableRefObject<((screenX: number, screenY: number) => void) | null>;
  qtResizeDraggingRef: MutableRefObject<boolean>;
  qtResizeSizeRef: MutableRefObject<number>;
  reEncodeActiveRef: MutableRefObject<boolean>;
  registryRef: MutableRefObject<AgentProviderRegistry | null>;
  remoteManagerRef: MutableRefObject<RemoteServerManager | null>;
  /** True while the review session is latched to the selected agent's PTY (keys routed there). */
  reviewLatchedRef: MutableRefObject<boolean>;
  sequenceMapRef: MutableRefObject<Map<string, KeyAction>>;
  showHintRef: MutableRefObject<((text: string) => void) | null>;
  sidebarDragEndRef: MutableRefObject<(() => void) | null>;
  sidebarDragMoveRef: MutableRefObject<((x: number) => void) | null>;
  sidebarDraggingRef: MutableRefObject<boolean>;
  sidebarFocusedIndexRef: MutableRefObject<number>;
  sidebarFocusedRef: MutableRefObject<boolean>;
  sidebarItemCountRef: MutableRefObject<number>;
  sidebarOpenRef: MutableRefObject<boolean>;
  sidebarWidthRef: MutableRefObject<number>;
  spawnPtyBridgeRef: MutableRefObject<((targetSession: string) => unknown) | null>;
  statusBarBottomOffsetRef: MutableRefObject<number>;
  statusBarClickRef: MutableRefObject<(() => boolean) | null>;
  statusBarTopOffsetRef: MutableRefObject<number>;
  storeRef: MutableRefObject<AgentSessionStore | null>;
  tabDragEndRef: MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef: MutableRefObject<((x: number) => void) | null>;
  tabDraggingRef: MutableRefObject<boolean>;
  tabPressOriginRef: MutableRefObject<null | number>;
  tabRightClickRef: MutableRefObject<((x: number) => void) | null>;
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
  textInputActive: MutableRefObject<boolean>;
  textInputEscapeHandlerRef: MutableRefObject<(() => void) | null>;
  tmuxPrefixKeyAliasRef: MutableRefObject<null | string>;
  tmuxPrefixSequenceRef: MutableRefObject<null | string>;
  /** Toggles the review latch on/off. Installed by the muxotron-focus hook. */
  toggleReviewLatchRef: MutableRefObject<(() => void) | null>;
  tooNarrowRef: MutableRefObject<boolean>;
  toolbarFocusedIndexRef: MutableRefObject<number>;
  toolbarInputRef: MutableRefObject<((data: string) => boolean) | null>;
  toolbarItemCountRef: MutableRefObject<number>;
  toolbarOpenRef: MutableRefObject<boolean>;
  /** Focuses the muxotron on the selected agent. Installed by the muxotron-focus hook. */
  treeAgentSelectRef: MutableRefObject<((session: AgentSession) => void) | null>;
  uiModeRef: MutableRefObject<UIMode>;
  writeFnRef: MutableRefObject<(data: string) => void>;
  /** Which zoom overlay is active, or null for in-place mux-o-tron focus. */
  zoomActionRef: MutableRefObject<KeyAction | null>;
  /** Per-action sticky flag so the input router can check synchronously. */
  zoomStickyRef: MutableRefObject<{ zoomAgentsView: boolean; zoomServerView: boolean }>;
}

interface RuntimeRefSyncValues {
  agentInstallDialogOpen: boolean;
  dims: RuntimeDims;
  ignoreMouseInput: boolean;
  layoutDropdownOpen: boolean;
  mainMenuCapturing: boolean;
  optionsDialogCapturing: boolean;
  statusBarBottomOffset: number;
  statusBarTopOffset: number;
  tmuxPrefixKeyAlias: null | string;
  tooNarrow: boolean;
  uiMode: UIMode;
}

interface UseAppRuntimeRefsOptions {
  sequenceMap: Map<string, KeyAction>;
}

export function syncAppRuntimeRefs(refs: AppRuntimeRefs, values: RuntimeRefSyncValues): void {
  refs.ignoreMouseInputRef.current = values.ignoreMouseInput;
  refs.tmuxPrefixKeyAliasRef.current = values.tmuxPrefixKeyAlias;
  refs.mainMenuCapturingRef.current = values.mainMenuCapturing;
  refs.optionsDialogCapturingRef.current = values.optionsDialogCapturing;
  refs.uiModeRef.current = values.uiMode;
  refs.dimsRef.current = values.dims;
  refs.statusBarTopOffsetRef.current = values.statusBarTopOffset;
  refs.statusBarBottomOffsetRef.current = values.statusBarBottomOffset;
  refs.tooNarrowRef.current = values.tooNarrow;
  refs.layoutDropdownOpenRef.current = values.layoutDropdownOpen;
  refs.agentInstallDialogRef.current = values.agentInstallDialogOpen;
}

export function useAppRuntimeRefs({ sequenceMap }: UseAppRuntimeRefsOptions): AppRuntimeRefs {
  const sequenceMapRef = useRef<Map<string, KeyAction>>(sequenceMap);
  const clientRef = useRef<TmuxControlClient | null>(null);
  const storeRef = useRef<AgentSessionStore | null>(null);
  const registryRef = useRef<AgentProviderRegistry | null>(null);
  const ptyRef = useRef<PtyBridge | null>(null);
  const spawnPtyBridgeRef = useRef<((targetSession: string) => unknown) | null>(null);
  const terminalRef = useRef<GhosttyTerminalRenderable | null>(null);
  const inputRouterSetup = useRef(false);
  const handleOptionsClickRef = useRef<() => void>(() => {});
  const handleToolbarToggleRef = useRef<() => void>(() => {});
  const toolbarOpenRef = useRef(false);
  const handleSessionClickRef = useRef<() => void>(() => {});
  const handleSessionNextRef = useRef<() => void>(() => {});
  const handleSessionPrevRef = useRef<() => void>(() => {});
  const handleQuickApproveRef = useRef<() => void>(() => {});
  const handleQuickDenyRef = useRef<() => void>(() => {});
  const handleGotoAgentRef = useRef<() => void>(() => {});
  const handleAgentLatchRef = useRef<() => void>(() => {});
  const handleRedrawRef = useRef<() => void>(() => {});
  const handleReviewAgentRef = useRef<(() => void) | null>(null);
  const showHintRef = useRef<((text: string) => void) | null>(null);
  const inputReady = useRef(false);
  const textInputActive = useRef(false);
  const textInputEscapeHandlerRef = useRef<(() => void) | null>(null);
  const dropdownInputRef = useRef<((data: string) => boolean) | null>(null);
  const toolbarInputRef = useRef<((data: string) => boolean) | null>(null);
  const toolbarFocusedIndexRef = useRef(-1);
  const toolbarItemCountRef = useRef(0);
  const handleToolbarFocusRef = useRef<() => void>(() => {});
  const handleToolbarUpRef = useRef<() => void>(() => {});
  const handleToolbarDownRef = useRef<() => void>(() => {});
  const handleToolbarActivateRef = useRef<() => void>(() => {});
  const handleToolbarCancelRef = useRef<() => void>(() => {});
  const handleSidebarFocusRef = useRef<() => void>(() => {});
  const handleSidebarUpRef = useRef<() => void>(() => {});
  const handleSidebarDownRef = useRef<() => void>(() => {});
  const handleSidebarLeftRef = useRef<() => void>(() => {});
  const handleSidebarRightRef = useRef<() => void>(() => {});
  const handleSidebarActivateRef = useRef<() => void>(() => {});
  const handleSidebarZoomRef = useRef<() => void>(() => {});
  const handleSidebarCancelRef = useRef<() => void>(() => {});
  const handleMuxotronDismissRef = useRef<() => void>(() => {});
  const handleAgentNextRef = useRef<() => void>(() => {});
  const handleAgentPrevRef = useRef<() => void>(() => {});
  const agentNavNextRef = useRef<(() => void) | null>(null);
  const agentNavPrevRef = useRef<(() => void) | null>(null);
  const sidebarFocusedRef = useRef(false);
  const sidebarFocusedIndexRef = useRef(-1);
  const sidebarItemCountRef = useRef(0);
  const ignoreMouseInputRef = useRef(false);
  const tmuxPrefixKeyAliasRef = useRef<null | string>(null);
  const tmuxPrefixSequenceRef = useRef<null | string>(null);
  const uiModeRef = useRef<UIMode>("adaptive");
  const dimsRef = useRef<RuntimeDims>({
    cols: 10,
    height: 3,
    rows: 3,
    width: 10,
  });
  const tooNarrowRef = useRef(false);
  const deferredSessionRef = useRef<null | string>(null);
  const layoutDropdownOpenRef = useRef(false);
  const mainMenuCapturingRef = useRef(false);
  const optionsDialogCapturingRef = useRef(false);
  const agentInstallDialogRef = useRef(false);
  const dialogInputRef = useRef<(data: string) => void>(() => {});
  const overflowOpenRef = useRef(false);
  const ptyDragActiveRef = useRef<((active: boolean) => void) | null>(null);
  const handleToolbarDismissRef = useRef<() => void>(() => {});
  const sidebarOpenRef = useRef(false);
  const sidebarWidthRef = useRef(32);
  const handleSidebarToggleRef = useRef<() => void>(() => {});
  const handleMobileToggleRef = useRef<() => void>(() => {});
  const handleExitMobileModeRef = useRef<() => void>(() => {});
  const sidebarDraggingRef = useRef(false);
  const sidebarDragMoveRef = useRef<((x: number) => void) | null>(null);
  const sidebarDragEndRef = useRef<(() => void) | null>(null);
  const tabDraggingRef = useRef(false);
  const tabDragMoveRef = useRef<((x: number) => void) | null>(null);
  const tabDragEndRef = useRef<((x: number) => void) | null>(null);
  const tabRightClickRef = useRef<((x: number) => void) | null>(null);
  const tabPressOriginRef = useRef<null | number>(null);
  const statusBarTopOffsetRef = useRef(0);
  const handleOpenQuickTerminalRef = useRef<() => void>(() => {});
  const handleCloseQuickTerminalRef = useRef<() => void>(() => {});
  const handleActivateMenuRef = useRef<() => void>(() => {});
  const dialogMenuToggleRef = useRef<(() => void) | null>(null);
  const handleScreenshotRef = useRef<() => void>(() => {});
  const handleBufferZoomRef = useRef<() => void>(() => {});
  const handleNotificationsClickRef = useRef<() => void>(() => {});
  const writeFnRef = useRef<(data: string) => void>(() => {});
  const promptClickStateRef = useRef<PromptClickMode>("unknown");
  const promptInputStartRef = useRef<PromptInputStart | null>(null);
  const mobileModeRef = useRef(false);
  const qtResizeDraggingRef = useRef(false);
  const qtResizeSizeRef = useRef(90);
  const qtResizeDragMoveRef = useRef<((screenX: number, screenY: number) => void) | null>(null);
  const qtResizeDragEndRef = useRef<(() => void) | null>(null);
  const statusBarBottomOffsetRef = useRef(0);
  const statusBarClickRef = useRef<(() => boolean) | null>(null);
  const remoteManagerRef = useRef<RemoteServerManager | null>(null);
  const handleZoomStartRef = useRef<((action: KeyAction) => void) | null>(null);
  const handleZoomEndRef = useRef<(() => void) | null>(null);
  const matchZoomCodeRef = useRef<((code: number) => KeyAction | null) | null>(null);
  const muxotronFocusActiveRef = useRef(false);
  const zoomActionRef = useRef<KeyAction | null>(null);
  const zoomStickyRef = useRef({ zoomAgentsView: false, zoomServerView: false });
  const reEncodeActiveRef = useRef(false);
  const muxotronExpandedRef = useRef(false);
  const handleDismissRef = useRef<() => void>(() => {});
  const handleNewPaneTabRef = useRef<() => void>(() => {});
  const handlePrevPaneTabRef = useRef<() => void>(() => {});
  const handleNextPaneTabRef = useRef<() => void>(() => {});
  const activePaneIdRef = useRef<null | string>(null);
  const addInfoRef = useRef<((id: string, message: string | string[]) => void) | null>(null);
  const interactiveAgentRef = useRef<AgentSession | null>(null);
  const reviewLatchedRef = useRef(false);
  const agentPreviewRef = useRef(false);
  const toggleReviewLatchRef = useRef<(() => void) | null>(null);
  const treeAgentSelectRef = useRef<((session: AgentSession) => void) | null>(null);

  return {
    activePaneIdRef,
    addInfoRef,
    agentInstallDialogRef,
    agentNavNextRef,
    agentNavPrevRef,
    agentPreviewRef,
    clientRef,
    deferredSessionRef,
    dialogInputRef,
    dialogMenuToggleRef,
    dimsRef,
    dropdownInputRef,
    handleActivateMenuRef,
    handleAgentLatchRef,
    handleAgentNextRef,
    handleAgentPrevRef,
    handleBufferZoomRef,
    handleCloseQuickTerminalRef,
    handleDismissRef,
    handleExitMobileModeRef,
    handleGotoAgentRef,
    handleMobileToggleRef,
    handleMuxotronDismissRef,
    handleNewPaneTabRef,
    handleNextPaneTabRef,
    handleNotificationsClickRef,
    handleOpenQuickTerminalRef,
    handleOptionsClickRef,
    handlePrevPaneTabRef,
    handleQuickApproveRef,
    handleQuickDenyRef,
    handleRedrawRef,
    handleReviewAgentRef,
    handleScreenshotRef,
    handleSessionClickRef,
    handleSessionNextRef,
    handleSessionPrevRef,
    handleSidebarActivateRef,
    handleSidebarCancelRef,
    handleSidebarDownRef,
    handleSidebarFocusRef,
    handleSidebarLeftRef,
    handleSidebarRightRef,
    handleSidebarToggleRef,
    handleSidebarUpRef,
    handleSidebarZoomRef,
    handleToolbarActivateRef,
    handleToolbarCancelRef,
    handleToolbarDismissRef,
    handleToolbarDownRef,
    handleToolbarFocusRef,
    handleToolbarToggleRef,
    handleToolbarUpRef,
    handleZoomEndRef,
    handleZoomStartRef,
    ignoreMouseInputRef,
    inputReady,
    inputRouterSetup,
    interactiveAgentRef,
    layoutDropdownOpenRef,
    mainMenuCapturingRef,
    matchZoomCodeRef,
    mobileModeRef,
    muxotronExpandedRef,
    muxotronFocusActiveRef,
    optionsDialogCapturingRef,
    overflowOpenRef,
    promptClickStateRef,
    promptInputStartRef,
    ptyDragActiveRef,
    ptyRef,
    qtResizeDragEndRef,
    qtResizeDragMoveRef,
    qtResizeDraggingRef,
    qtResizeSizeRef,
    reEncodeActiveRef,
    registryRef,
    remoteManagerRef,
    reviewLatchedRef,
    sequenceMapRef,
    showHintRef,
    sidebarDragEndRef,
    sidebarDragMoveRef,
    sidebarDraggingRef,
    sidebarFocusedIndexRef,
    sidebarFocusedRef,
    sidebarItemCountRef,
    sidebarOpenRef,
    sidebarWidthRef,
    spawnPtyBridgeRef,
    statusBarBottomOffsetRef,
    statusBarClickRef,
    statusBarTopOffsetRef,
    storeRef,
    tabDragEndRef,
    tabDragMoveRef,
    tabDraggingRef,
    tabPressOriginRef,
    tabRightClickRef,
    terminalRef,
    textInputActive,
    textInputEscapeHandlerRef,
    tmuxPrefixKeyAliasRef,
    tmuxPrefixSequenceRef,
    toggleReviewLatchRef,
    tooNarrowRef,
    toolbarFocusedIndexRef,
    toolbarInputRef,
    toolbarItemCountRef,
    toolbarOpenRef,
    treeAgentSelectRef,
    uiModeRef,
    writeFnRef,
    zoomActionRef,
    zoomStickyRef,
  };
}
