import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

const setupInputRouterMock = mock((..._args: any[]) => {});
const setupMouseForwardMock = mock((..._args: any[]) => {});
const historyLoadAsyncMock = mock(async () => {});
const hasHistoryConsentMock = mock(() => true);
const ensureKeybindingsFileMock = mock(() => {});
const mapCoordinatesFn = mock((_x: number, _y: number, _button: number, _suffix: string) => null as null);
const createMouseCoordinateMapperMock = mock((_args: any) => mapCoordinatesFn);

const historyIndexMock = {
  loadAsync: historyLoadAsyncMock,
  onReady: null as (() => void) | null,
  status: "ready",
};

mock.module("../../input/router.ts", () => ({
  setupInputRouter: setupInputRouterMock,
  setupMouseForward: setupMouseForwardMock,
}));

mock.module("../../agents/history-search.ts", () => ({
  hasHistoryConsent: hasHistoryConsentMock,
  historyIndex: historyIndexMock,
}));

mock.module("../../util/keybindings.ts", () => ({
  MODIFIER_KEY_CODES: {
    57447: "right_shift",
  },
  ensureKeybindingsFile: ensureKeybindingsFileMock,
}));

mock.module("../../input/create-mouse-coordinate-mapper.ts", () => ({
  createMouseCoordinateMapper: createMouseCoordinateMapperMock,
}));

const { setupInputLayer } = await import("./setup-input-layer.ts");

function createContext(overrides?: Partial<SetupTmuxRuntimeContext>): {
  ctx: SetupTmuxRuntimeContext;
  detachMock: ReturnType<typeof mock>;
  onDialogInputMock: ReturnType<typeof mock>;
  onDropdownInputMock: ReturnType<typeof mock>;
  ptyWriteMock: ReturnType<typeof mock>;
  redrawMock: ReturnType<typeof mock>;
  setHistoryReadyMock: ReturnType<typeof mock>;
  showHintMock: ReturnType<typeof mock>;
  writeFnMock: ReturnType<typeof mock>;
} {
  const detachMock = mock(async () => {});
  const setHistoryReadyMock = mock((_value: unknown) => {});
  const onDialogInputMock = mock((_data: string) => {});
  const onDropdownInputMock = mock((_data: string) => false);
  const ptyWriteMock = mock((_data: string) => {});
  const showHintMock = mock((_text: string) => {});
  const redrawMock = mock(() => {});
  const writeFnMock = mock((_data: string) => {});

  const ctx = {
    agentRuntime: {
      activePaneIdRef: { current: null },
      muxotronExpandedRef: { current: false },
      registryRef: { current: null },
      setAgentSessions: (_value: unknown) => {},
      setClaudeDialogPending: (_value: unknown) => {},
      setCodexDialogPending: (_value: unknown) => {},
      setGeminiDialogPending: (_value: unknown) => {},
      setHookSnifferEvents: (_value: unknown) => {},
      setOpenCodeDialogPending: (_value: unknown) => {},
      storeRef: { current: null },
      uiModeRef: { current: "adaptive" as const },
    },
    configRuntime: {
      setConfig: (_value: unknown) => {},
      setConfigThemeBuiltin: (_value: unknown) => {},
      setConfigThemeMode: (_value: unknown) => {},
      setConfigUIMode: (_value: unknown) => {},
      setToolbarOpen: (_value: unknown) => {},
    },
    dialogs: {
      agentInstallDialogRef: { current: false },
      dialogInputRef: { current: onDialogInputMock },
      dropdownInputRef: { current: onDropdownInputMock },
      mainMenuCapturingRef: { current: false },
      optionsDialogCapturingRef: { current: false },
      setMainMenuDialogOpen: (_open: boolean) => {},
    },
    input: {
      handleActivateMenuRef: { current: () => {} },
      handleApplyFavoriteProfile: () => {},
      handleDismissRef: { current: () => {} },
      handleExitMobileModeRef: { current: () => {} },
      handleGotoAgentRef: { current: () => {} },
      handleLayoutProfileClick: () => {},
      handleMobileToggleRef: { current: () => {} },
      handleNewPaneTabRef: { current: () => {} },
      handleNextPaneTabRef: { current: () => {} },
      handleNotificationsClickRef: { current: () => {} },
      handleOpenAgentsDialog: () => {},
      handleOpenConversationsRef: { current: () => {} },
      handleOptionsClickRef: { current: () => {} },
      handlePopupAccessRef: { current: () => {} },

      handlePrevPaneTabRef: { current: () => {} },
      handleQuickApproveRef: { current: () => {} },
      handleQuickDenyRef: { current: () => {} },
      handleRedrawRef: { current: redrawMock },
      handleScreenshotRef: { current: () => {} },
      handleSessionClickRef: { current: () => {} },
      handleSidebarToggleRef: { current: () => {} },
      handleTabNext: () => {},
      handleTabPrev: () => {},
      handleTextInputEscape: () => {},
      handleZoomEndRef: { current: null },
      handleZoomStartRef: { current: null },
      matchZoomCodeRef: { current: null },
      muxotronFocusActiveRef: { current: false },
      paneTabBorderClickRef: { current: null },
      reEncodeActiveRef: { current: false },
      reviewLatchedRef: { current: false },
      sequenceMapRef: { current: new Map() },
      showHintRef: { current: showHintMock },
      tmuxPrefixKeyAliasRef: { current: null },
      tmuxPrefixSequenceRef: { current: null },
      toggleReviewLatchRef: { current: null },
      writeFnRef: { current: writeFnMock },
      zoomActionRef: { current: null },
      zoomStickyRef: { current: { zoomAgentsView: false, zoomServerView: false } },
    },
    mouse: {
      agentsDialogOpenRef: { current: false },
      dropdownOpenRef: { current: false },
      ignoreMouseInputRef: { current: false },
      layoutDropdownOpenRef: { current: false },
      mainMenuDialogOpenRef: { current: false },
      muxotronExpandedRef: { current: false },
      overflowOpenRef: { current: false },
      overlayOpenRef: { current: false },
      paneTabBorderHitTestRef: { current: null },
      paneTabBorderRightClickRef: { current: null },
      paneTabDragEndRef: { current: null },
      paneTabDragMoveRef: { current: null },
      paneTabDraggingRef: { current: false },
      ptyDragActiveRef: { current: null },
      qtResizeDragEndRef: { current: null },
      qtResizeDragMoveRef: { current: null },
      qtResizeDraggingRef: { current: false },
      qtResizeSizeRef: { current: 90 },
      sidebarDragEndRef: { current: null },
      sidebarDragMoveRef: { current: null },
      sidebarDraggingRef: { current: false },
      sidebarOpenRef: { current: false },
      sidebarWidthRef: { current: 32 },
      statusBarBottomOffsetRef: { current: 0 },
      statusBarClickRef: { current: null },
      statusBarTopOffsetRef: { current: 0 },
      tabDragEndRef: { current: null },
      tabDragMoveRef: { current: null },
      tabDraggingRef: { current: false },
      tabPressOriginRef: { current: null },
      tabRightClickRef: { current: null },
      uiModeRef: { current: "adaptive" as const },
    },
    sessionRuntime: {
      clientRef: {
        current: {
          detach: detachMock,
          getActiveMouseAnyFlag: async () => false,
          getAllPaneInfo: async () => [],
          off: () => {},
          on: () => {},
        } as any,
      },
      deferredSessionRef: { current: null },
      detachingRef: { current: false },
      dimsRef: { current: { cols: 120, height: 40, rows: 40, width: 120 } },
      initTargetRef: { current: "alpha" },
      inputReady: { current: true },
      inputRouterSetup: { current: false },
      promptClickStateRef: { current: "unknown" as const },
      promptInputStartRef: { current: null },
      ptyRef: { current: { write: ptyWriteMock } as any },
      renderer: { id: "renderer" },
      spawnPtyBridge: (_target: string) => null,
      switchingRef: { current: new Set<string>() },
      terminalRef: { current: null },
      textInputActive: { current: false },
      tooNarrowRef: { current: false },
    },
    sessionState: {
      historyLoadStartedRef: { current: false },
      setActiveIndex: (_value: unknown) => {},
      setConnected: (_value: unknown) => {},
      setCurrentSessionName: (_value: unknown) => {},
      setHistoryReady: setHistoryReadyMock,
      setKeyBindings: (_value: unknown) => {},
      setSessionKey: (_value: unknown) => {},
      setStatusBarInfo: (_value: unknown) => {},
      setWindows: (_value: unknown) => {},
    },
    ...overrides,
  } as SetupTmuxRuntimeContext;

  return {
    ctx,
    detachMock,
    onDialogInputMock,
    onDropdownInputMock,
    ptyWriteMock,
    redrawMock,
    setHistoryReadyMock,
    showHintMock,
    writeFnMock,
  };
}

describe("setupInputLayer", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    historyIndexMock.onReady = null;
    hasHistoryConsentMock.mockReturnValue(true);
  });

  test("initializes history load, input router, and mouse forwarding once", () => {
    const { ctx, detachMock, onDialogInputMock, redrawMock, setHistoryReadyMock, showHintMock } = createContext();

    setupInputLayer(ctx);

    expect(historyIndexMock.onReady).toBeTypeOf("function");
    historyIndexMock.onReady?.();
    expect(setHistoryReadyMock).toHaveBeenCalledWith(true);

    expect(historyLoadAsyncMock).toHaveBeenCalledTimes(1);
    expect(ctx.sessionState.historyLoadStartedRef.current).toBe(true);
    expect(setupInputRouterMock).toHaveBeenCalledTimes(1);
    expect(ensureKeybindingsFileMock).toHaveBeenCalledTimes(1);
    expect(createMouseCoordinateMapperMock).toHaveBeenCalledTimes(1);
    expect(setupMouseForwardMock).toHaveBeenCalledTimes(1);
    const mouseMapperArgs = createMouseCoordinateMapperMock.mock.calls[0]![0] as any;
    expect(mouseMapperArgs.dialogs).toBe(ctx.dialogs);
    expect(mouseMapperArgs.input).toBe(ctx.input);
    expect(mouseMapperArgs.mouse).toBe(ctx.mouse);
    expect(mouseMapperArgs.sessionRuntime).toBe(ctx.sessionRuntime);

    const callbacks = setupInputRouterMock.mock.calls[0]![2] as any;
    callbacks.onTooNarrowInput();
    expect(ctx.sessionRuntime.detachingRef.current).toBe(true);
    expect(detachMock).toHaveBeenCalledTimes(1);

    callbacks.onDialogInput("x");
    expect(onDialogInputMock).toHaveBeenCalledWith("x");

    callbacks.onRedraw();
    expect(showHintMock).toHaveBeenCalledWith("redraw");
    expect(redrawMock).toHaveBeenCalledTimes(1);

    const mouseConfig = setupMouseForwardMock.mock.calls[0]![1] as any;
    expect(mouseConfig.mapCoordinates).toBe(mapCoordinatesFn);
  });

  test("does not initialize router twice when already set up", () => {
    const { ctx } = createContext();
    ctx.sessionRuntime.inputRouterSetup.current = true;
    ctx.sessionState.historyLoadStartedRef.current = true;

    setupInputLayer(ctx);

    expect(historyLoadAsyncMock).not.toHaveBeenCalled();
    expect(setupInputRouterMock).not.toHaveBeenCalled();
    expect(ensureKeybindingsFileMock).not.toHaveBeenCalled();
    expect(setupMouseForwardMock).not.toHaveBeenCalled();
  });

  test("skips history preload when consent is not granted", () => {
    hasHistoryConsentMock.mockReturnValue(false);
    const { ctx } = createContext();

    setupInputLayer(ctx);

    expect(historyLoadAsyncMock).not.toHaveBeenCalled();
    expect(ctx.sessionState.historyLoadStartedRef.current).toBe(false);
  });

  test("routes forwarded raw mouse input through the local PTY", () => {
    const { ctx, ptyWriteMock, writeFnMock } = createContext();

    setupInputLayer(ctx);

    const writeMouseToPane = setupMouseForwardMock.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    expect(writeMouseToPane).toBeTypeOf("function");

    writeMouseToPane?.("\x1b[<64;20;5M");

    expect(ptyWriteMock).toHaveBeenCalledWith("\x1b[<64;20;5M");
    expect(writeFnMock).not.toHaveBeenCalled();
  });
});
