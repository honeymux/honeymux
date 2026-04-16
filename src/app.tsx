import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { KeybindingConfig } from "./util/keybindings.ts";

import { buildAppRuntimeContext } from "./app/hooks/build-app-runtime-context.ts";
import { useAgentActions } from "./app/hooks/use-agent-actions.ts";
import { useAgentBinaryDetection } from "./app/hooks/use-agent-binary-detection.ts";
import { useAgentPaneActivity } from "./app/hooks/use-agent-pane-activity.ts";
import { useAgentPtyBridge } from "./app/hooks/use-agent-pty-bridge.ts";
import { useAppChromeFocus } from "./app/hooks/use-app-chrome-focus.ts";
import { applyTerminalCursorVisibility, useAppOverlayModel } from "./app/hooks/use-app-overlay-model.tsx";
import { syncAppRuntimeRefs, useAppRuntimeRefs } from "./app/hooks/use-app-runtime-refs.ts";
import { useAppRuntimeShortcuts } from "./app/hooks/use-app-runtime-shortcuts.ts";
import { useAgentDialogState, useTmuxSessionState, useUiChromeState } from "./app/hooks/use-app-state-groups.ts";
import { useDimInactivePanes } from "./app/hooks/use-dim-inactive-panes.ts";
import { useHistoryWorkflow } from "./app/hooks/use-history-workflow.ts";
import { useLayoutProfiles } from "./app/hooks/use-layout-profiles.ts";
import { useMainMenuDispatch } from "./app/hooks/use-main-menu-dispatch.ts";
import { useMainPaneModel } from "./app/hooks/use-main-pane-model.ts";
import { useMuxotronFocusAndAgentSelection } from "./app/hooks/use-muxotron-focus-and-agent-selection.ts";
import { useNotificationsReview } from "./app/hooks/use-notifications-review.ts";
import { useOptionsWorkflow } from "./app/hooks/use-options-workflow.ts";
import { usePaneTabsIntegration } from "./app/hooks/use-pane-tabs-integration.ts";
import { usePromptClickState } from "./app/hooks/use-prompt-click-state.ts";
import { usePtyLifecycle } from "./app/hooks/use-pty-lifecycle.ts";
import { shouldMarkPermissionPromptAnswered, usePtyWritePipeline } from "./app/hooks/use-pty-write-pipeline.ts";
import { useRemoteManager } from "./app/hooks/use-remote-manager.ts";
import { useRootDetection } from "./app/hooks/use-root-detection.ts";
import { isScrollbackTooTall, useScreenshotWorkflow } from "./app/hooks/use-screenshot-workflow.ts";
import { useTabActions } from "./app/hooks/use-tab-actions.ts";
import { useUiActions } from "./app/hooks/use-ui-actions.ts";
import { setupTmuxRuntime } from "./app/runtime/setup-tmux-runtime.ts";
import { saveLastSession } from "./app/services/session-persistence.ts";
import { AppOverlays } from "./components/app-overlays.tsx";
import { DisablePaneTabsDialog } from "./components/disable-pane-tabs-dialog.tsx";
import { MobileMode } from "./components/mobile-mode.tsx";
import { OptionsPreviewOverlays } from "./components/options-preview-overlays.tsx";
import { PaneBorderMenu } from "./components/pane-border-menu.tsx";
import { PaneTabContextMenu } from "./components/pane-tab-context-menu.tsx";
import { PaneTabOverflowDropdown } from "./components/pane-tab-overflow-dropdown.tsx";
import {
  ScreenshotDialog,
  ScreenshotDoneDialog,
  ScreenshotLargeDialog,
  copyToClipboard,
} from "./components/screenshot-dialog.tsx";
import { TerminalView } from "./components/terminal-view.tsx";
import { TmuxPane } from "./components/tmux-pane.tsx";
import { TOOLBAR_WIDTH } from "./components/toolbar.tsx";
import { prepareGhosttyTerminalForTmux } from "./util/ghostty-terminal.ts";
import { buildSequenceMap, loadKeybindings } from "./util/keybindings.ts";
import { log } from "./util/log.ts";
import { computeTerminalMetrics } from "./util/pane-layout.ts";

interface AppProps {
  sessionName: string;
}

export function App({ sessionName }: AppProps) {
  const renderer = useRenderer();
  const { height, width } = useTerminalDimensions();

  const tmuxSessionState = useTmuxSessionState(sessionName);
  const { connected, currentSessionName, keyBindings, sessionKey } = tmuxSessionState;
  const uiChromeState = useUiChromeState();
  const {
    mainMenuCapturing,
    mainMenuDialogOpen,
    muxotronFocusActive,
    sidebarOpen,
    sidebarWidth,
    toolbarOpen,
    zoomAction,
  } = uiChromeState;
  const agentDialogState = useAgentDialogState();
  const {
    agentSessions,
    agentsDialogOpen,
    claudeDialogPending,
    codexDialogPending,
    geminiDialogPending,
    openCodeDialogPending,
    quickTerminalOpen,
    setAgentsDialogOpen,
    setClaudeDialogPending,
    setCodexDialogPending,
    setGeminiDialogPending,
    setOpenCodeDialogPending,
  } = agentDialogState;

  // Keybindings (loaded once from ~/.config/honeymux/keybindings.json)
  const [keybindingConfig, setKeybindingConfig] = useState<KeybindingConfig>(() => loadKeybindings());
  const [sequenceMap, setSequenceMap] = useState(() => buildSequenceMap(keybindingConfig));
  const appRuntimeRefs = useAppRuntimeRefs({ sequenceMap });
  const [isMobileMode, setIsMobileMode] = useState(false);

  const suppressPassthroughRef = useRef(false);
  const {
    activePaneIdRef,
    clientRef,
    deferredSessionRef,
    dimsRef,
    dropdownInputRef,
    handleNotificationsClickRef,
    handleOptionsClickRef,
    handleRedrawRef,
    handleSessionClickRef,
    handleSessionNextRef,
    handleSessionPrevRef,
    inputReady,
    mobileModeRef,
    promptClickStateRef,
    promptInputStartRef,
    ptyRef,
    registryRef: _registryRef,
    remoteManagerRef,
    sidebarItemCountRef,
    spawnPtyBridgeRef,
    terminalRef,
    textInputActive,
    textInputEscapeHandlerRef,
    tooNarrowRef,
    toolbarItemCountRef,
  } = appRuntimeRefs;
  const historyWorkflow = useHistoryWorkflow({
    setAgentsDialogOpen,
  });
  const { conversationsDialogOpen, historyConsentDialogOpen } = historyWorkflow;

  const optionsWorkflow = useOptionsWorkflow({
    setDropdownOpen: uiChromeState.setDropdownOpen,
  });
  const {
    config,
    configAgentAlertWatermark,
    configIgnoreMouseInput,
    configPrivilegedPaneDetection,
    configQuickTerminalSize,
    configScreenshotDir,
    configScreenshotFlash,
    configTmuxPrefixKeyAliasCapturing,
    configUIMode,
    handleOptionsClick,
    optionsDialogOpen,
    optionsDialogRow,
    optionsDialogTab,
    setConfigPaneTabsEnabled,
  } = optionsWorkflow;
  handleOptionsClickRef.current = handleOptionsClick;
  const screenshotWorkflow = useScreenshotWorkflow({
    configScreenshotDir,
    configScreenshotFlash,
    refs: appRuntimeRefs,
  });
  const {
    dismissScreenshotDone,
    dismissScreenshotLargeDialog,
    handleScreenshotCapture,
    openScreenshotDialog,
    screenshotButtonCol,
    screenshotDialogOpen,
    screenshotDoneButtonCol,
    screenshotDonePath,
    screenshotLargeDialogOpen,
    screenshotPreview,
    setScreenshotButtonCol,
    setScreenshotDialogOpen,
    setScreenshotDoneButtonCol,
    setScreenshotDonePath,
  } = screenshotWorkflow;
  const appChromeFocus = useAppChromeFocus({
    refs: appRuntimeRefs,
    uiChromeState,
    width,
  });
  const {
    handleSidebarViewChange,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    toolbarActivateRef,
    toolbarFocusedIndex,
  } = appChromeFocus;

  const layoutProfilesState = useLayoutProfiles({
    refs: appRuntimeRefs,
    tmuxSessionState,
    uiChromeState,
  });
  const { layoutDropdownOpen } = layoutProfilesState;

  const activeWindowIdRef = useRef<null | string>(null);
  const displayWindows = tmuxSessionState.windows;
  const activeWindow = tmuxSessionState.windows[tmuxSessionState.activeIndex];
  // Only update window/pane refs when we have a valid active window.
  // During pane-tab switches the window-renamed handler removes the staging
  // window from state before setActiveIndex is corrected, leaving a transient
  // render where activeWindow is undefined.  Unconditionally writing null here
  // would poison the ref for every subsequent re-render until a
  // session-window-changed refresh happens — and even that gets overwritten by
  // later re-renders from unrelated state changes (e.g. setPaneTabGroups).
  const prevActiveWindowId = useRef<null | string>(null);
  if (activeWindow) {
    activeWindowIdRef.current = activeWindow.id;
    if (activeWindow.id !== prevActiveWindowId.current) {
      prevActiveWindowId.current = activeWindow.id;
      // Only initialize activePaneIdRef from window data when the active window
      // changes.  Within a window, %window-pane-changed keeps it up to date.
      activePaneIdRef.current = activeWindow.paneId ?? null;
    }
  }

  // Keep activePaneIdRef in sync when the user clicks a different pane within the same window
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const handler = (_windowId: string, paneId: string) => {
      activePaneIdRef.current = paneId;
    };
    client.on("window-pane-changed", handler);
    return () => {
      client.off("window-pane-changed", handler);
    };
  }, [connected]);

  const paneTabsEnabled = config.paneTabsEnabled ?? false;
  const paneTabsIntegration = usePaneTabsIntegration({
    activeWindowIdRef,
    connected,
    currentSessionName,
    enabled: paneTabsEnabled,
    refs: appRuntimeRefs,
    runtimeKey: sessionKey,
    setConfigPaneTabsEnabled,
  });
  const {
    closePaneBorderMenu,
    guardedSetConfigPaneTabsEnabled,
    handlePaneTabDisableCancel,
    handlePaneTabDisableConfirm,
    inactivePaneCount,
    openPaneBorderMenu,
    paneBorderMenu,
    paneTabDisableConfirmButtonCol,
    paneTabDisableConfirmOpen,
    paneTabsApi,
    setPaneTabDisableConfirmButtonCol,
  } = paneTabsIntegration;
  const guardedOptionsWorkflow = {
    ...optionsWorkflow,
    setConfigPaneTabsEnabled: guardedSetConfigPaneTabsEnabled,
  };

  const rootTargetSession = currentSessionName;
  const { rootPanes: detectedRootPanes } = useRootDetection({ clientRef, connected, targetSession: rootTargetSession });

  const agentDetection = useAgentBinaryDetection({
    clientRef,
    connected,
    setClaudeDialogPending,
    setCodexDialogPending,
    setGeminiDialogPending,
    setOpenCodeDialogPending,
  });
  const notificationsReviewState = useNotificationsReview({
    agentDetection,
    claudeDialogPending,
    codexDialogPending,
    geminiDialogPending,
    historyReady: historyWorkflow.historyReady,
    openCodeDialogPending,
    rootPanesDetected: detectedRootPanes.length > 0,
    setClaudeDialogPending,
    setCodexDialogPending,
    setGeminiDialogPending,
    setOpenCodeDialogPending,
  });
  const {
    addInfo,
    clearSshErrors,
    dialogReview: dialogNotificationsReview,
    dialogSshError,
    handleNotificationsClick,
    handleSshServerStatusChange,
    infoCount,
    infoDialogPending,
    overlayReview: overlayNotificationsReview,
    overlaySshError,
    sshErrorDialogServer,
    warningCount,
  } = notificationsReviewState;
  handleNotificationsClickRef.current = handleNotificationsClick;
  appRuntimeRefs.addInfoRef.current = addInfo;

  usePromptClickState({
    clientRef,
    connected,
    promptClickStateRef,
    promptInputStartRef,
    terminalRef,
  });

  const dimTargetSession = currentSessionName;
  const dimEnabled = config.dimInactivePanes ?? false;
  const { activePaneRect, inactivePaneRects } = useDimInactivePanes({
    clientRef,
    connected,
    enabled: dimEnabled,
    targetSession: dimTargetSession,
  });

  const effectiveUIMode = configUIMode;
  const activePaneId = activePaneIdRef.current;
  const muxotronFocusState = useMuxotronFocusAndAgentSelection({
    activePaneId,
    agentSessions,
    config,
    effectiveUIMode,
    keybindingConfig,
    refs: appRuntimeRefs,
    setConfig: optionsWorkflow.setConfig,
    uiChromeState,
  });
  const {
    agentLatchBindingLabel,
    attachedAgent,
    capturedPaneLines,
    clearTreeSelectedSession,
    handleToggleZoomSticky,
    handleTreeAgentSelect,
    interactiveAgent,
    reviewLatched,
    treeSelectedSession,
    treeSelectedSessionRef,
  } = muxotronFocusState;

  // Terminal content dimensions (below tab bar, no borders)
  const terminalMetrics = computeTerminalMetrics({
    height,
    uiMode: effectiveUIMode,
    width,
  });
  const tooSmall = terminalMetrics.tooSmall;
  const tooNarrow = width < 80;
  const tooShort = height < 24;
  const tooSmallForUse = tooNarrow || tooShort;
  const sidebarDeduction = sidebarOpen ? sidebarWidth + 1 : 0;
  const toolbarDeduction = toolbarOpen ? TOOLBAR_WIDTH + 1 : 0;
  // When mobile mode is active, size the PTY to match the mobile agents view:
  // width - 2*TOOLBAR_WIDTH (nav buttons on each side), height - 4 (1 header + 3 exit button)
  const termCols = isMobileMode
    ? Math.max(10, width - 2 * TOOLBAR_WIDTH)
    : terminalMetrics.cols - sidebarDeduction - toolbarDeduction;
  const termRows = isMobileMode ? Math.max(3, height - 4) : terminalMetrics.rows;

  // --- Interactive agent PTY bridge for the focused muxotron ---
  // Size the bridged PTY to match honeymux's own tmux-client dimensions
  // (termCols × termRows). Using any other size would cause tmux to see
  // a dimension mismatch between our two clients (honeymux + overlay) on
  // the shared window, which renders as the dot-grid pattern in the
  // larger client's viewport. We subtract a couple of rows so the focused
  // view doesn't extend all the way to the bottom of the screen.
  const AGENT_ZOOM_ROW_TRIM = 3;
  const agentInteractiveCols = Math.max(10, termCols);
  const agentInteractiveRows = Math.max(3, termRows - AGENT_ZOOM_ROW_TRIM);
  const agentBridge = useAgentPtyBridge({
    clientRef,
    onAgentInput: (data) => {
      if (interactiveAgent && shouldMarkPermissionPromptAnswered(data)) {
        appRuntimeRefs.storeRef.current?.markAnswered(interactiveAgent.sessionId);
        appRuntimeRefs.handleMuxotronDismissRef.current();
      }
    },
    policyOsc52Passthrough: config.policyLocalOsc52Passthrough,
    policyOtherOscPassthrough: config.policyLocalOtherOscPassthrough,
    remoteManagerRef: appRuntimeRefs.remoteManagerRef,
    session: attachedAgent,
    termCols: agentInteractiveCols,
    termRows: agentInteractiveRows,
    writeFnRef: appRuntimeRefs.writeFnRef,
  });
  const agentTerminalNode = attachedAgent ? (
    <TerminalView
      bg={undefined}
      cols={agentInteractiveCols}
      key={attachedAgent.sessionId}
      onReady={agentBridge.onTerminalReady}
      rows={agentInteractiveRows}
      showCursor
    />
  ) : null;
  const handleInteractiveMuxotronScroll = useCallback(
    (sequence: string) => {
      appRuntimeRefs.writeFnRef.current(sequence);
    },
    [appRuntimeRefs.writeFnRef],
  );

  const rootPanes = detectedRootPanes;
  const agentInstallDialogOpen =
    claudeDialogPending ||
    openCodeDialogPending ||
    geminiDialogPending ||
    codexDialogPending ||
    infoDialogPending ||
    optionsDialogOpen ||
    mainMenuDialogOpen ||
    conversationsDialogOpen ||
    historyConsentDialogOpen ||
    screenshotDialogOpen ||
    screenshotLargeDialogOpen ||
    screenshotDonePath !== null ||
    sshErrorDialogServer !== null ||
    agentsDialogOpen;

  const statusBarTopOffset =
    tmuxSessionState.statusBarInfo?.position === "top" ? tmuxSessionState.statusBarInfo.lines : 0;
  const statusBarBottomOffset =
    tmuxSessionState.statusBarInfo?.position === "bottom" ? tmuxSessionState.statusBarInfo.lines : 0;

  syncAppRuntimeRefs(appRuntimeRefs, {
    agentInstallDialogOpen,
    dims: { cols: termCols, height, rows: termRows, width },
    ignoreMouseInput: configIgnoreMouseInput,
    layoutDropdownOpen,
    mainMenuCapturing,
    optionsDialogCapturing: configTmuxPrefixKeyAliasCapturing,
    statusBarBottomOffset,
    statusBarTopOffset,
    tmuxPrefixKeyAlias: config.tmuxPrefixKeyAlias ?? null,
    tooNarrow: tooSmallForUse,
    uiMode: effectiveUIMode,
  });
  mobileModeRef.current = isMobileMode;

  // Sync tmux mouse mode: on when not ignoring, off when ignoring
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.setTmuxMouse(!configIgnoreMouseInput).catch(() => {});
  }, [configIgnoreMouseInput, clientRef]);

  const { spawnPtyBridge } = usePtyLifecycle({
    clientRef,
    connected,
    deferredSessionRef,
    dimsRef,
    inputReady,
    policyOsc52Passthrough: config.policyLocalOsc52Passthrough,
    policyOtherOscPassthrough: config.policyLocalOtherOscPassthrough,
    ptyRef,
    renderer,
    suppressPassthroughRef,
    termCols,
    termRows,
    terminalRef,
    tooNarrow: tooSmallForUse,
    tooNarrowRef,
    tooSmall,
  });
  spawnPtyBridgeRef.current = spawnPtyBridge;

  const tabActionState = useTabActions({
    paneTabsApi,
    refs: appRuntimeRefs,
    tmuxSessionState,
    uiChromeState,
  });
  const uiActionState = useUiActions({
    layoutProfiles: layoutProfilesState,
    optionsWorkflow,
    refs: appRuntimeRefs,
    renderer,
    tmuxSessionState,
    uiChromeState,
  });
  const { beamPromiseRef, beamTokenRef, handleRedraw, handleSessionClick, handleSessionNext, handleSessionPrev } =
    uiActionState;

  usePtyWritePipeline({
    beamState: {
      beamPromiseRef,
      beamTokenRef,
    },
    honeybeamsEnabled: config.honeybeamsEnabled !== false,
    keyBindings,
    // An attached agent bridge owns `writeFnRef` via its useLayoutEffect
    // swap. The pipeline must skip reassigning writeFnRef for as long as
    // that swap is in place, otherwise typing while latched would flow
    // back into the main terminal PTY instead of the agent PTY.
    overlayActive: attachedAgent !== null,
    quickTerminalOpen,
    refs: appRuntimeRefs,
    renderer,
    toolbarOpen,
  });

  handleSessionClickRef.current = handleSessionClick;
  handleSessionNextRef.current = handleSessionNext;
  handleSessionPrevRef.current = handleSessionPrev;
  handleRedrawRef.current = handleRedraw;

  // Redraw after UI mode change — the terminal component remounts and needs
  // tmux to re-send the screen contents.
  const prevUIModeRef = useRef(effectiveUIMode);
  useEffect(() => {
    if (prevUIModeRef.current !== effectiveUIMode) {
      prevUIModeRef.current = effectiveUIMode;
      handleRedraw();
    }
  }, [effectiveUIMode, handleRedraw]);

  const agentActionState = useAgentActions({
    agentDetection,
    agentDialogState,
    historyWorkflow,
    paneTabsApi,
    refs: appRuntimeRefs,
    tmuxSessionState,
    uiActions: uiActionState,
  });
  const { handleGoToPane, handleOpenQuickTerminal, handlePermissionRespond, handleQuickTerminalClose } =
    agentActionState;
  useAppRuntimeShortcuts({
    agentActions: {
      handleAgentsDialogSelect: agentActionState.handleAgentsDialogSelect,
      handleGoToPane,
      handleOpenQuickTerminal,
      handlePermissionRespond,
      handleQuickTerminalClose,
    },
    agentSessions,
    bufferZoomFade: config.bufferZoomFade,
    bufferZoomMaxLines: config.bufferZoomMaxLines,
    clearTreeSelectedSession,
    handleRedraw,
    openPaneBorderMenu,
    openScreenshotDialog,
    refs: appRuntimeRefs,
    renderer,
    setAgentsDialogOpen,
    setIsMobileMode,
    sidebarOpen,
    sidebarWidth,
    suppressPassthroughRef,
    treeSelectedSessionRef,
  });

  const runtimeContext = buildAppRuntimeContext({
    agentActions: agentActionState,
    agentDialogState,
    historyWorkflow,
    layoutProfiles: layoutProfilesState,
    optionsWorkflow,
    paneTabsApi,
    refs: appRuntimeRefs,
    renderer,
    spawnPtyBridge,
    tabActions: tabActionState,
    tmuxSessionState,
    uiActions: uiActionState,
    uiChromeState,
  });

  // Initialize tmux connection and PTY
  useEffect(() => {
    return setupTmuxRuntime(runtimeContext);
  }, [sessionKey]);

  const remoteManagerVersion = useRemoteManager({
    clearSshErrors,
    connected,
    handleSshServerStatusChange,
    refs: appRuntimeRefs,
    remoteConfigs: config.remote,
  });
  const paneBorderRemoteServers = useMemo(() => {
    return (
      config.remote?.map((server) => ({
        availability: paneBorderMenu
          ? (remoteManagerRef.current?.getRemoteConversionAvailability(paneBorderMenu.paneId, server.name) ??
            "unavailable")
          : "unavailable",
        name: server.name,
      })) ?? []
    );
  }, [config.remote, paneBorderMenu, remoteManagerVersion]);

  const { activity: codingAgentActivity, lastOutputByPaneRef: codingAgentLastOutputByPaneRef } = useAgentPaneActivity({
    agentSessions,
    clientRef,
    connected,
    currentSessionName,
  });

  // Persist active session name for resume-on-launch
  useEffect(() => {
    saveLastSession(currentSessionName);
  }, [currentSessionName]);

  // Register terminal ref from TerminalView
  const handleTerminalReady = useCallback(
    (terminal: GhosttyTerminalRenderable) => {
      terminalRef.current = terminal;
      prepareGhosttyTerminalForTmux(terminal);
      applyTerminalCursorVisibility(terminal, {
        dialogOpen: agentInstallDialogOpen,
        interactiveAgent: attachedAgent,
        muxotronFocusActive,
        tooSmallForUse,
      });
    },
    [agentInstallDialogOpen, attachedAgent, terminalRef, tooSmallForUse, muxotronFocusActive],
  );

  // Hide the terminal cursor whenever a dropdown is open.  Dropdown open/close
  // is tracked via dropdownInputRef (set by useDropdownKeyboard in child
  // components), which is a ref — not React state — so the state-based useEffect
  // in useAppOverlayModel cannot observe it.  A per-frame post-process function
  // bridges the gap: it hides the cursor while the ref is non-null and restores
  // it (using the synced runtime refs) once the dropdown closes.  The
  // "was open" flag lives in a ref so it survives effect re-runs caused by
  // unmemoized state-group object identities in the dep array — otherwise a
  // render that lands between the open and close frames would reset the flag
  // and the restore branch would never fire, leaving the cursor hidden.
  const cursorHiddenByDropdownRef = useRef(false);
  useEffect(() => {
    const enforceCursorVisibility = () => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      const isDropdownOpen = dropdownInputRef.current !== null;
      if (isDropdownOpen) {
        terminal.showCursor = false;
        cursorHiddenByDropdownRef.current = true;
      } else if (cursorHiddenByDropdownRef.current) {
        // Dropdown just closed — re-evaluate from synced refs so the cursor
        // restores to the correct state without waiting for a React re-render.
        const dims = dimsRef.current;
        const tooSmall = dims.width < 80 || dims.height < 24;
        terminal.showCursor =
          !tooSmall &&
          !appRuntimeRefs.agentInstallDialogRef.current &&
          !agentDialogState.overlayOpenRef.current &&
          !uiChromeState.muxotronFocusActiveRef.current;
        cursorHiddenByDropdownRef.current = false;
      }
    };
    renderer.addPostProcessFn(enforceCursorVisibility);
    return () => renderer.removePostProcessFn(enforceCursorVisibility);
  }, [renderer, terminalRef, dropdownInputRef, dimsRef, appRuntimeRefs, agentDialogState, uiChromeState]);

  useMainMenuDispatch({
    agentActions: agentActionState,
    agentDialogState,
    guardedOptionsWorkflow,
    handleToggleZoomSticky,
    historyWorkflow,
    layoutProfiles: layoutProfilesState,
    notificationsReview: dialogNotificationsReview,
    paneTabsApi,
    paneTabsDialogs: {
      disableConfirmButtonCol: paneTabDisableConfirmButtonCol,
      disableConfirmOpen: paneTabDisableConfirmOpen,
      handleDisableCancel: handlePaneTabDisableCancel,
      handleDisableConfirm: handlePaneTabDisableConfirm,
      setDisableConfirmButtonCol: setPaneTabDisableConfirmButtonCol,
    },
    paneTabsEnabled,
    runtimeRefs: appRuntimeRefs,
    screenshots: {
      buttonCol: screenshotButtonCol,
      dialogOpen: screenshotDialogOpen,
      dismissLargeDialog: dismissScreenshotLargeDialog,
      doneButtonCol: screenshotDoneButtonCol,
      donePath: screenshotDonePath,
      handleCapture: handleScreenshotCapture,
      largeDialogOpen: screenshotLargeDialogOpen,
      scrollbackDisabled: isScrollbackTooTall(screenshotPreview, config.screenshotMaxHeightPixels),
      setButtonCol: setScreenshotButtonCol,
      setDialogOpen: setScreenshotDialogOpen,
      setDoneButtonCol: setScreenshotDoneButtonCol,
      setDonePath: setScreenshotDonePath,
    },
    setKeybindingConfig,
    setSequenceMap,
    sshError: dialogSshError,
    tabActions: tabActionState,
    uiChromeState,
  });
  const { handleTreeNavigate, mainPaneProps } = useMainPaneModel({
    activePaneId,
    activePaneRect,
    agentActions: agentActionState,
    agentDialogState,
    agentLatchBindingLabel,
    agentTerminalNode,
    capturedPaneLines,
    codingAgentActivity,
    codingAgentLastOutputByPaneRef,
    dimEnabled,
    displayWindows,
    effectiveUIMode,
    handleSidebarViewChange,
    handleTerminalReady,
    height,
    historyWorkflow,
    infoCount,
    interactiveAgent: attachedAgent,
    keybindingConfig,
    layoutProfiles: layoutProfilesState,
    muxotronFocusActive,
    onInteractiveScrollSequence: handleInteractiveMuxotronScroll,
    onTreeAgentSelect: handleTreeAgentSelect,
    optionsWorkflow,
    paneTabsApi,
    refs: appRuntimeRefs,
    reviewLatched,
    selectedSession: treeSelectedSession,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarItemCountRef,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    tabActions: tabActionState,
    termCols: agentInteractiveCols,
    termRows: agentInteractiveRows,
    tmuxSessionState,
    toolbarActivateRef,
    toolbarFocusedIndex,
    toolbarItemCountRef,
    uiActions: uiActionState,
    uiChromeState,
    warningCount,
    width,
  });

  const overlayModel = useAppOverlayModel({
    activePaneId,
    agentInstallDialogOpen,
    agentSessions,
    config,
    configAgentAlertWatermark,
    configQuickTerminalSize,
    dimEnabled,
    effectiveUIMode,
    height,
    inactivePaneRects,
    interactiveAgent: attachedAgent,
    layoutProfiles: layoutProfilesState.layoutProfiles,
    muxotronFocusActive,
    onToggleZoomSticky: handleToggleZoomSticky,
    onTreeNavigate: handleTreeNavigate,
    optionsDialogOpen,
    optionsDialogRow,
    optionsDialogTab,
    paneTabDragFloat: paneTabsApi.paneTabDragFloat,
    privilegedPaneDetectionEnabled: configPrivilegedPaneDetection !== false,
    refs: appRuntimeRefs,
    rootPanes,
    sidebarOpen,
    sidebarWidth,
    termCols,
    termRows,
    tooSmallForUse,
    width,
    zoomAction,
  });
  const { hasFavoriteProfile, mainRootOverlayNode, optionsPreview, overlayZoomState } = overlayModel;

  return (
    <box height={height} width={width}>
      {isMobileMode ? (
        <MobileMode height={height} onExitMobileMode={() => setIsMobileMode(false)} width={width} />
      ) : (
        <TmuxPane key="main" {...mainPaneProps} rootOverlayNode={mainRootOverlayNode} />
      )}
      <AppOverlays
        agentActions={agentActionState}
        agentDialogState={agentDialogState}
        hasFavoriteProfile={hasFavoriteProfile}
        height={height}
        historyWorkflow={historyWorkflow}
        keybindingConfig={keybindingConfig}
        notificationsReview={overlayNotificationsReview}
        optionsWorkflow={guardedOptionsWorkflow}
        paneTabsApi={paneTabsApi}
        refs={appRuntimeRefs}
        sshError={overlaySshError}
        tmuxSessionState={tmuxSessionState}
        tooNarrow={tooSmallForUse}
        tooShort={tooShort}
        uiChromeState={uiChromeState}
        width={width}
        zoomState={overlayZoomState}
      />
      <PaneTabContextMenu
        dropdownInputRef={dropdownInputRef}
        onTextInputActive={(active) => {
          textInputActive.current = active;
        }}
        paneTabsApi={paneTabsApi}
        textInputEscapeHandlerRef={textInputEscapeHandlerRef}
        width={width}
      />
      <PaneBorderMenu
        dropdownInputRef={dropdownInputRef}
        menu={paneBorderMenu}
        onAddPaneTab={() => paneTabsApi.handleNewPaneTab()}
        onClose={closePaneBorderMenu}
        onConvertToRemote={(paneId, serverName) => {
          void (async () => {
            const manager = remoteManagerRef.current;
            if (!manager || manager.getRemoteConversionAvailability(paneId, serverName) !== "ready") {
              log("remote", `convertPane skipped: mirror not ready for ${paneId} on ${serverName}`);
              return;
            }
            // Evict the pane from any pane-tab group BEFORE conversion so the
            // remote pane's border format (set by remoteManager.convertPane)
            // is not overwritten by a racing label-refresh triggered by the
            // local respawn.
            await paneTabsApi.handleEvictPaneFromGroup(paneId);
            try {
              await manager.convertPane(paneId, serverName);
            } catch (err) {
              log("remote", `convertPane error: ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
        }}
        onRevertToLocal={(paneId) => {
          remoteManagerRef.current?.revertPane(paneId).catch((err) => {
            log("remote", `revertPane error: ${err.message}`);
          });
        }}
        paneTabsEnabled={paneTabsEnabled}
        remotePaneServer={
          paneBorderMenu ? (remoteManagerRef.current?.isRemotePane(paneBorderMenu.paneId)?.serverName ?? null) : null
        }
        remoteServers={paneBorderRemoteServers}
      />
      <PaneTabOverflowDropdown dropdownInputRef={dropdownInputRef} paneTabsApi={paneTabsApi} width={width} />
      {paneTabDisableConfirmOpen && (
        <DisablePaneTabsDialog
          buttonCol={paneTabDisableConfirmButtonCol}
          inactivePaneCount={inactivePaneCount}
          onCancel={handlePaneTabDisableCancel}
          onDisable={handlePaneTabDisableConfirm}
        />
      )}
      {screenshotDialogOpen && (
        <ScreenshotDialog
          buttonCol={screenshotButtonCol}
          height={height}
          maxHeightPixels={config.screenshotMaxHeightPixels}
          onCancel={() => setScreenshotDialogOpen(false)}
          onFocusScrollback={() => setScreenshotButtonCol(1)}
          onScrollback={() => handleScreenshotCapture("scrollback")}
          onViewport={() => handleScreenshotCapture("viewport")}
          preview={screenshotPreview}
          scrollbackDisabled={isScrollbackTooTall(screenshotPreview, config.screenshotMaxHeightPixels)}
          width={width}
        />
      )}
      {screenshotDonePath !== null && (
        <ScreenshotDoneDialog
          buttonCol={screenshotDoneButtonCol}
          filePath={screenshotDonePath}
          onCopy={() => {
            copyToClipboard(screenshotDonePath);
            dismissScreenshotDone();
          }}
          onDismiss={dismissScreenshotDone}
        />
      )}
      {screenshotLargeDialogOpen && (
        <ScreenshotLargeDialog height={height} onDismiss={dismissScreenshotLargeDialog} width={width} />
      )}
      <OptionsPreviewOverlays
        height={height}
        quickSizePreview={optionsPreview.quickSizePreview}
        quickTerminalSize={optionsPreview.quickTerminalSize}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        termCols={termCols}
        termRows={termRows}
        uiMode={effectiveUIMode}
        unansweredCount={optionsPreview.unansweredCount}
        watermarkEnabled={optionsPreview.watermarkEnabled}
        watermarkPreviewFocused={optionsPreview.watermarkPreviewFocused}
        watermarkShape={optionsPreview.watermarkShape}
        width={width}
      />
    </box>
  );
}
