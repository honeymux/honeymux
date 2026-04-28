import { describe, expect, mock, test } from "bun:test";

import type { HistoryEntry } from "../../agents/history-search.ts";

import { dispatchDialogInput } from "./dialog-input-dispatch.ts";

function createDeps(overrides?: any): any {
  return {
    agentActions: {
      handleClaudeInstall: mock(async () => {}),
      handleClaudeNever: mock(async () => {}),
      handleClaudeSkip: mock(async () => {}),
      handleCodexInstall: mock(async () => {}),
      handleCodexNever: mock(async () => {}),
      handleCodexSkip: mock(async () => {}),
      handleConversationsSelect: mock((_entry: unknown) => {}),
      handleGeminiInstall: mock(async () => {}),
      handleGeminiNever: mock(async () => {}),
      handleGeminiSkip: mock(async () => {}),
      handleOpenCodeInstall: mock(async () => {}),
      handleOpenCodeNever: mock(async () => {}),
      handleOpenCodeSkip: mock(async () => {}),
    },
    agentDialogState: {
      claudeDialogPending: false,
      codexDialogPending: false,
      dialogSelected: "install",
      geminiDialogPending: false,
      openCodeDialogPending: false,
      setDialogSelected: mock((_selected: unknown) => {}),
    },
    historyWorkflow: {
      closeConversationsDialog: mock(() => {}),
      closeConversationsMenu: mock(() => {}),
      consentDialogSelected: "allow",
      conversationsCursor: 0,
      conversationsDialogOpen: false,
      conversationsLoadedCount: 50,
      conversationsMenuIndex: 0,
      conversationsMenuOpen: false,
      conversationsPageOffset: 0,
      conversationsQuery: "",
      conversationsResultIndex: 0,
      conversationsResults: { hasMore: false, results: [], total: 0 },
      conversationsSearchCaseSensitive: false,
      conversationsSearchRegex: false,
      goToConversationsAbsoluteIndex: mock((_index: number) => {}),
      handleConsentAllow: mock(async () => {}),
      handleConsentDeny: mock(async () => {}),
      historyConsentDialogOpen: false,
      jumpToNewestConversationsPage: mock(() => {}),
      jumpToOldestConversationsPage: mock(() => {}),
      loadMoreConversations: mock(() => {}),
      openConversationsMenu: mock(() => {}),
      resetConversationsPagination: mock(() => {}),
      setConsentDialogSelected: mock((_selected: unknown) => {}),
      setConversationsCursor: mock((_cursor: unknown) => {}),
      setConversationsDialogOpen: mock((_open: unknown) => {}),
      setConversationsMenuIndex: mock((_index: unknown) => {}),
      setConversationsQuery: mock((_query: unknown) => {}),
      setConversationsResultIndex: mock((_index: unknown) => {}),
      showNewerConversationsPage: mock(() => {}),
      showOlderConversationsPage: mock(() => {}),
      toggleConversationsMenu: mock(() => {}),
      toggleConversationsSearchCaseSensitive: mock(() => {}),
      toggleConversationsSearchRegex: mock(() => {}),
    },
    mainMenu: {
      getMainMenuActionForSlot: mock(() => null),
      onMainMenuAction: mock((_action: string) => {}),
      onMainMenuBindingChange: mock((_action: string, _combo: string) => {}),
      onToggleZoomSticky: mock((_action: string) => {}),
      paneTabsEnabled: true,
      rowCount: 0,
      writeToPty: mock((_data: string) => {}),
    },
    notificationsReview: {
      close: mock(() => {}),
      dismissCurrentInfo: mock(() => {}),
      infoDialogPending: false,
      open: false,
    },
    optionsWorkflow: {
      configActiveWindowIdDisplayEnabled: false,
      configAgentAlertAnimConfusables: false,
      configAgentAlertAnimCycleCount: 1,
      configAgentAlertAnimDelay: 60,
      configAgentAlertAnimEqualizer: false,
      configAgentAlertAnimGlow: false,
      configAgentAlertAnimScribble: false,
      configAgentAlertCursorAlert: false,
      configAgentAlertCursorBlink: false,
      configAgentAlertCursorColor: "#fff",
      configAgentAlertCursorShape: "underline",
      configAgentAlertWatermark: "off",
      configAnimationCycleCountCursor: 0,
      configAnimationCycleCountEditing: false,
      configAnimationCycleCountText: "1",
      configAnimationDelayCursor: 0,
      configAnimationDelayEditing: false,
      configAnimationDelayText: "60",
      configCursorColorPickerOpen: false,
      configDimInactivePanes: false,
      configDimInactivePanesOpacity: 40,
      configHoneybeamsEnabled: false,
      configIgnoreMouseInput: false,
      configMuxotronEnabled: false,
      configPaneTabsEnabled: false,
      configPrivilegedPaneDetection: false,
      configPrivilegedPaneDetectionOpacity: 0,
      configQuickTerminalSize: 90,
      configRemoteAdding: null,
      configRemoteEditing: null,
      configRemoteSelectedIndex: 0,
      configRemoteServers: [],
      configRemoteTesting: null,
      configScreenshotDir: "",
      configScreenshotFlash: false,
      configThemeBuiltin: "dracula",
      configThemeMode: "built-in",
      configTmuxKeyBindingHints: false,
      configTmuxPrefixKeyAlias: null,
      configTmuxPrefixKeyAliasCaptureError: "",
      configTmuxPrefixKeyAliasCapturing: false,
      configUIMode: "adaptive",
      handleOptionsConfirm: mock(async () => {}),
      openedFromMainMenuRef: { current: false },
      optionsDialogOpen: false,
      optionsDialogRow: 0,
      optionsDialogTab: "general",
      previewConfigChange: mock(() => {}),
      remoteEditRef: { current: { adding: null, editing: null } },
      screenshotDirEditRef: { current: { cursor: 0, dir: "", editing: false } },
      setConfigActiveWindowIdDisplayEnabled: mock((_v: boolean) => {}),
      setConfigAgentAlertAnimConfusables: mock((_v: boolean) => {}),
      setConfigAgentAlertAnimCycleCount: mock((_v: number) => {}),
      setConfigAgentAlertAnimDelay: mock((_v: number) => {}),
      setConfigAgentAlertAnimEqualizer: mock((_v: boolean) => {}),
      setConfigAgentAlertAnimGlow: mock((_v: boolean) => {}),
      setConfigAgentAlertAnimScribble: mock((_v: boolean) => {}),
      setConfigAgentAlertCursorAlert: mock((_v: boolean) => {}),
      setConfigAgentAlertCursorBlink: mock((_v: boolean) => {}),
      setConfigAgentAlertCursorColor: mock((_v: string) => {}),
      setConfigAgentAlertCursorShape: mock((_v: string) => {}),
      setConfigAgentAlertWatermark: mock((_v: string) => {}),
      setConfigAnimationCycleCountCursor: mock((_v: number) => {}),
      setConfigAnimationCycleCountEditing: mock((_v: boolean) => {}),
      setConfigAnimationCycleCountText: mock((_v: string) => {}),
      setConfigAnimationDelayCursor: mock((_v: number) => {}),
      setConfigAnimationDelayEditing: mock((_v: boolean) => {}),
      setConfigAnimationDelayText: mock((_v: string) => {}),
      setConfigCursorColorPickerOpen: mock((_v: boolean) => {}),
      setConfigDimInactivePanes: mock((_v: boolean) => {}),
      setConfigDimInactivePanesOpacity: mock((_v: number) => {}),
      setConfigHoneybeamsEnabled: mock((_v: boolean) => {}),
      setConfigIgnoreMouseInput: mock((_v: boolean) => {}),
      setConfigMuxotronEnabled: mock((_v: boolean) => {}),
      setConfigPaneTabsEnabled: mock((_v: boolean) => {}),
      setConfigPrivilegedPaneDetection: mock((_v: boolean) => {}),
      setConfigPrivilegedPaneDetectionOpacity: mock((_v: number) => {}),
      setConfigQuickTerminalSize: mock((_v: number) => {}),
      setConfigRemoteAdding: mock((_v: unknown) => {}),
      setConfigRemoteEditing: mock((_v: unknown) => {}),
      setConfigRemoteSelectedIndex: mock((_v: number) => {}),
      setConfigRemoteServers: mock((_v: unknown) => {}),
      setConfigRemoteTesting: mock((_v: unknown) => {}),
      setConfigScreenshotDir: mock((_v: string) => {}),
      setConfigScreenshotDirCursor: mock((_v: number) => {}),
      setConfigScreenshotDirEditing: mock((_v: boolean) => {}),
      setConfigScreenshotFlash: mock((_v: boolean) => {}),
      setConfigThemeBuiltin: mock((_v: string) => {}),
      setConfigThemeMode: mock((_v: string) => {}),
      setConfigTmuxKeyBindingHints: mock((_v: boolean) => {}),
      setConfigTmuxPrefixKeyAlias: mock((_v: null | string) => {}),
      setConfigTmuxPrefixKeyAliasCaptureError: mock((_v: string) => {}),
      setConfigTmuxPrefixKeyAliasCapturing: mock((_v: boolean) => {}),
      setConfigUIMode: mock((_v: string) => {}),
      setOptionsDialogRow: mock((_row: number) => {}),
      setOptionsDialogTab: mock((_tab: string) => {}),
    },
    paneTabsEnabled: {
      disableConfirmButtonCol: 0,
      disableConfirmOpen: false,
      handleDisableCancel: mock(() => {}),
      handleDisableConfirm: mock(() => {}),
      setDisableConfirmButtonCol: mock((_col: number) => {}),
    },
    runtimeRefs: {
      dropdownInputRef: { current: null },
      sequenceMapRef: { current: new Map() },
    },
    screenshots: {
      buttonCol: 0,
      dialogOpen: false,
      dismissError: mock(() => {}),
      dismissLargeDialog: mock(() => {}),
      doneButtonCol: 0,
      donePath: null,
      error: null,
      handleCapture: mock((_mode: string) => {}),
      largeDialogOpen: false,
      scrollbackDisabled: false,
      setButtonCol: mock((_col: number) => {}),
      setDialogOpen: mock((_open: boolean) => {}),
      setDoneButtonCol: mock((_col: number) => {}),
      setDonePath: mock((_path: null | string) => {}),
    },
    sshError: {
      dismiss: mock(() => {}),
      server: null,
    },
    uiChromeState: {
      mainMenuCapturing: false,
      mainMenuDialogOpen: false,
      mainMenuSelectedCol: "left",
      mainMenuSelectedRow: 0,
      mainMenuTab: "functions",
      setMainMenuCaptureError: mock((_error: string) => {}),
      setMainMenuCapturing: mock((_capturing: boolean) => {}),
      setMainMenuDialogOpen: mock((_open: boolean) => {}),
      setMainMenuSelectedCol: mock((_col: string) => {}),
      setMainMenuSelectedRow: mock((_row: unknown) => {}),
      setMainMenuTab: mock((_tab: string) => {}),
    },
    ...overrides,
  };
}

describe("dispatchDialogInput", () => {
  test("typing in the conversations dialog resets paging while updating the query", () => {
    const setConversationsQuery = mock((_query: unknown) => {});
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const resetConversationsPagination = mock(() => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 2,
        conversationsDialogOpen: true,
        conversationsQuery: "ab",
        resetConversationsPagination,
        setConversationsCursor,
        setConversationsQuery,
      },
    });

    dispatchDialogInput("c", deps);

    expect(setConversationsQuery).toHaveBeenCalledWith("abc");
    expect(setConversationsCursor).toHaveBeenCalledWith(3);
    expect(resetConversationsPagination).toHaveBeenCalledTimes(1);
  });

  test("ctrl+a moves the conversations cursor to the beginning", () => {
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const setConversationsQuery = mock((_query: unknown) => {});
    const resetConversationsPagination = mock(() => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 5,
        conversationsDialogOpen: true,
        conversationsQuery: "hello",
        resetConversationsPagination,
        setConversationsCursor,
        setConversationsQuery,
      },
    });

    dispatchDialogInput("\x01", deps);

    expect(setConversationsCursor).toHaveBeenCalledWith(0);
    expect(setConversationsQuery).not.toHaveBeenCalled();
    expect(resetConversationsPagination).not.toHaveBeenCalled();
  });

  test("ctrl+e moves the conversations cursor to the end", () => {
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 0,
        conversationsDialogOpen: true,
        conversationsQuery: "hello",
        setConversationsCursor,
      },
    });

    dispatchDialogInput("\x05", deps);

    expect(setConversationsCursor).toHaveBeenCalledWith(5);
  });

  test("ctrl+w deletes a whitespace-delimited word backward in the conversations query", () => {
    const setConversationsQuery = mock((_query: unknown) => {});
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const resetConversationsPagination = mock(() => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 11,
        conversationsDialogOpen: true,
        conversationsQuery: "foo bar baz",
        resetConversationsPagination,
        setConversationsCursor,
        setConversationsQuery,
      },
    });

    dispatchDialogInput("\x17", deps);

    expect(setConversationsQuery).toHaveBeenCalledWith("foo bar ");
    expect(setConversationsCursor).toHaveBeenCalledWith(8);
    expect(resetConversationsPagination).toHaveBeenCalledTimes(1);
  });

  test("alt+b moves the conversations cursor one word backward", () => {
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 11,
        conversationsDialogOpen: true,
        conversationsQuery: "foo bar baz",
        setConversationsCursor,
      },
    });

    dispatchDialogInput("\x1bb", deps);

    expect(setConversationsCursor).toHaveBeenCalledWith(8);
  });

  test("alt+f moves the conversations cursor one word forward", () => {
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 0,
        conversationsDialogOpen: true,
        conversationsQuery: "foo bar",
        setConversationsCursor,
      },
    });

    dispatchDialogInput("\x1bf", deps);

    expect(setConversationsCursor).toHaveBeenCalledWith(3);
  });

  test("cursor-aware backspace removes the char before the cursor, not the end", () => {
    const setConversationsQuery = mock((_query: unknown) => {});
    const setConversationsCursor = mock((_cursor: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsCursor: 2,
        conversationsDialogOpen: true,
        conversationsQuery: "abcd",
        setConversationsCursor,
        setConversationsQuery,
      },
    });

    dispatchDialogInput("\x7f", deps);

    expect(setConversationsQuery).toHaveBeenCalledWith("acd");
    expect(setConversationsCursor).toHaveBeenCalledWith(1);
  });

  test("tab opens the conversations search menu", () => {
    const openConversationsMenu = mock(() => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        openConversationsMenu,
      },
    });

    dispatchDialogInput("\t", deps);

    expect(openConversationsMenu).toHaveBeenCalledTimes(1);
  });

  test("space toggles the focused conversations regex mode while the menu is open", () => {
    const toggleConversationsSearchRegex = mock(() => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsMenuIndex: 1,
        conversationsMenuOpen: true,
        toggleConversationsSearchRegex,
      },
    });

    dispatchDialogInput(" ", deps);

    expect(toggleConversationsSearchRegex).toHaveBeenCalledTimes(1);
  });

  test("up wraps from the first conversations menu item to the last", () => {
    const setConversationsMenuIndex = mock((_index: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsMenuIndex: 0,
        conversationsMenuOpen: true,
        setConversationsMenuIndex,
      },
    });

    dispatchDialogInput("\x1b[A", deps);

    expect(setConversationsMenuIndex).toHaveBeenCalledTimes(1);
    const updater = setConversationsMenuIndex.mock.calls[0]?.[0] as (value: number) => number;
    expect(updater(0)).toBe(1);
  });

  test("down wraps from the last conversations menu item to the first", () => {
    const setConversationsMenuIndex = mock((_index: unknown) => {});
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsMenuIndex: 1,
        conversationsMenuOpen: true,
        setConversationsMenuIndex,
      },
    });

    dispatchDialogInput("\x1b[B", deps);

    expect(setConversationsMenuIndex).toHaveBeenCalledTimes(1);
    const updater = setConversationsMenuIndex.mock.calls[0]?.[0] as (value: number) => number;
    expect(updater(1)).toBe(0);
  });

  test("loads more conversations when moving near the end of the loaded window", () => {
    const loadMoreConversations = mock(() => {});
    const setConversationsResultIndex = mock((_index: unknown) => {});
    const results = Array.from({ length: 50 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsResultIndex: 46,
        conversationsResults: { hasMore: true, results, total: 120 },
        loadMoreConversations,
        setConversationsResultIndex,
      },
    });

    dispatchDialogInput("\x1b[B", deps);

    expect(loadMoreConversations).toHaveBeenCalledTimes(1);
    expect(setConversationsResultIndex).toHaveBeenCalledWith(47);
  });

  test("page down moves forward by one conversations page without loading every result", () => {
    const goToConversationsAbsoluteIndex = mock((_index: number) => {});
    const results = Array.from({ length: 50 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsResultIndex: 12,
        conversationsResults: { hasMore: true, results, total: 1088 },
        goToConversationsAbsoluteIndex,
      },
    });

    dispatchDialogInput("\x1b[6~", deps);

    expect(goToConversationsAbsoluteIndex).toHaveBeenCalledTimes(1);
    expect(goToConversationsAbsoluteIndex).toHaveBeenCalledWith(62);
  });

  test("page up wraps backward by one conversations page", () => {
    const goToConversationsAbsoluteIndex = mock((_index: number) => {});
    const results = Array.from({ length: 50 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsResultIndex: 0,
        conversationsResults: { hasMore: true, results, total: 1088 },
        goToConversationsAbsoluteIndex,
      },
    });

    dispatchDialogInput("\x1b[5~", deps);

    expect(goToConversationsAbsoluteIndex).toHaveBeenCalledTimes(1);
    expect(goToConversationsAbsoluteIndex).toHaveBeenCalledWith(1038);
  });

  test("wraps to the true oldest conversation when moving up from the first loaded row", () => {
    const setConversationsResultIndex = mock((_index: unknown) => {});
    const jumpToOldestConversationsPage = mock(() => {});
    const results = Array.from({ length: 100 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsLoadedCount: 50,
        conversationsResultIndex: 0,
        conversationsResults: { hasMore: true, results, total: 428 },
        jumpToOldestConversationsPage,
        setConversationsResultIndex,
      },
    });

    dispatchDialogInput("\x1b[A", deps);

    expect(jumpToOldestConversationsPage).toHaveBeenCalledTimes(1);
    expect(setConversationsResultIndex).toHaveBeenCalledWith(27);
  });

  test("wraps from the oldest page back to the newest page without loading all results", () => {
    const jumpToNewestConversationsPage = mock(() => {});
    const setConversationsResultIndex = mock((_index: unknown) => {});
    const results = Array.from({ length: 28 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsLoadedCount: 50,
        conversationsPageOffset: 400,
        conversationsResultIndex: 27,
        conversationsResults: { hasMore: false, results, total: 428 },
        jumpToNewestConversationsPage,
        setConversationsResultIndex,
      },
    });

    dispatchDialogInput("\x1b[B", deps);

    expect(jumpToNewestConversationsPage).toHaveBeenCalledTimes(1);
    expect(setConversationsResultIndex).toHaveBeenCalledWith(0);
  });

  test("selects the correct conversation after a page expansion", () => {
    const handleConversationsSelect = mock((_entry: unknown) => {});
    const expandedResults = Array.from({ length: 100 }, (_, index) => ({
      agentType: "codex",
      filePath: `/tmp/${index}.jsonl`,
      sessionId: `sess-${index}`,
      text: `prompt ${index}`,
      timestamp: 1000 - index,
    })) satisfies HistoryEntry[];
    const deps = createDeps({
      agentActions: {
        ...createDeps().agentActions,
        handleConversationsSelect,
      },
      historyWorkflow: {
        ...createDeps().historyWorkflow,
        conversationsDialogOpen: true,
        conversationsResultIndex: 50,
        conversationsResults: { hasMore: true, results: expandedResults, total: 120 },
      },
    });

    dispatchDialogInput("\r", deps);

    expect(handleConversationsSelect).toHaveBeenCalledWith(expandedResults[50]);
  });

  test("esc in Claude dialog during review closes review without skipping", () => {
    const closeNotificationsReview = mock(() => {});
    const handleClaudeSkip = mock(async () => {});
    const deps = createDeps({
      agentActions: {
        ...createDeps().agentActions,
        handleClaudeSkip,
      },
      agentDialogState: {
        claudeDialogPending: true,
        codexDialogPending: false,
        dialogSelected: "install",
        geminiDialogPending: false,
        openCodeDialogPending: false,
        setDialogSelected: mock((_selected: unknown) => {}),
      },
      notificationsReview: {
        close: closeNotificationsReview,
        dismissCurrentInfo: mock(() => {}),
        infoDialogPending: false,
        open: true,
      },
    });

    dispatchDialogInput("\x1b", deps);

    expect(closeNotificationsReview).toHaveBeenCalledTimes(1);
    expect(handleClaudeSkip).toHaveBeenCalledTimes(0);
  });

  test("options dialog forwards input to open dropdown handler", () => {
    const dropdownHandler = mock((_data: string) => true);
    const deps = createDeps({
      optionsWorkflow: {
        ...createDeps().optionsWorkflow,
        optionsDialogOpen: true,
      },
      runtimeRefs: {
        dropdownInputRef: { current: dropdownHandler },
        sequenceMapRef: { current: new Map() },
      },
    });

    dispatchDialogInput("x", deps);

    expect(dropdownHandler).toHaveBeenCalledWith("x");
  });

  test("options dialog captures a modifier-only prefix alias", () => {
    const setConfigTmuxPrefixKeyAlias = mock((_value: null | string) => {});
    const setConfigTmuxPrefixKeyAliasCapturing = mock((_value: boolean) => {});
    const setConfigTmuxPrefixKeyAliasCaptureError = mock((_value: string) => {});
    const deps = createDeps({
      optionsWorkflow: {
        ...createDeps().optionsWorkflow,
        configTmuxPrefixKeyAliasCapturing: true,
        optionsDialogOpen: true,
        setConfigTmuxPrefixKeyAlias,
        setConfigTmuxPrefixKeyAliasCaptureError,
        setConfigTmuxPrefixKeyAliasCapturing,
      },
    });

    dispatchDialogInput("\x1b[57447;2:3u", deps);

    expect(setConfigTmuxPrefixKeyAlias).toHaveBeenCalledWith("right_shift");
    expect(setConfigTmuxPrefixKeyAliasCapturing).toHaveBeenCalledWith(false);
  });

  test("options dialog reports prefix-alias conflicts using main-menu style messaging", () => {
    const setConfigTmuxPrefixKeyAliasCaptureError = mock((_value: string) => {});
    const deps = createDeps({
      optionsWorkflow: {
        ...createDeps().optionsWorkflow,
        configTmuxPrefixKeyAliasCapturing: true,
        optionsDialogOpen: true,
        setConfigTmuxPrefixKeyAliasCaptureError,
      },
      runtimeRefs: {
        dropdownInputRef: { current: null },
        sequenceMapRef: { current: new Map([["right_shift", "zoomAgentsView"]]) },
      },
    });

    dispatchDialogInput("\x1b[57447;2:3u", deps);

    expect(setConfigTmuxPrefixKeyAliasCaptureError).toHaveBeenCalledWith(
      "right shift already bound to Zoom agents view",
    );
  });

  test("options dialog does not capture bare alt after rejecting alt+a for prefix alias", () => {
    const setConfigTmuxPrefixKeyAlias = mock((_value: null | string) => {});
    const setConfigTmuxPrefixKeyAliasCapturing = mock((_value: boolean) => {});
    const setConfigTmuxPrefixKeyAliasCaptureError = mock((_value: string) => {});
    const deps = createDeps({
      optionsWorkflow: {
        ...createDeps().optionsWorkflow,
        configTmuxPrefixKeyAliasCapturing: true,
        optionsDialogOpen: true,
        setConfigTmuxPrefixKeyAlias,
        setConfigTmuxPrefixKeyAliasCaptureError,
        setConfigTmuxPrefixKeyAliasCapturing,
      },
    });

    dispatchDialogInput("\x1ba", deps);
    dispatchDialogInput("\x1b[57443;3:3u", deps);

    expect(setConfigTmuxPrefixKeyAlias).not.toHaveBeenCalled();
    expect(setConfigTmuxPrefixKeyAliasCapturing).not.toHaveBeenCalledWith(false);
    expect(setConfigTmuxPrefixKeyAliasCaptureError).toHaveBeenCalledWith("prefix key alias must be a modifier key");
  });

  test("main menu capture accepts a bare functional key (Home via VTE SS3 form)", () => {
    // VTE/GNOME Terminal sends Home as `\x1b O H`. Without Kitty keyboard
    // protocol there is no modifier flag, but Home has no in-band shadow so
    // it must still be bindable bare from the capture UI.
    const onMainMenuBindingChange = mock((_action: string, _combo: string) => {});
    const setMainMenuCapturing = mock((_capturing: boolean) => {});
    const deps = createDeps({
      mainMenu: {
        ...createDeps().mainMenu,
        getMainMenuActionForSlot: mock(() => "options"),
        onMainMenuBindingChange,
      },
      uiChromeState: {
        ...createDeps().uiChromeState,
        mainMenuCapturing: true,
        mainMenuDialogOpen: true,
        setMainMenuCapturing,
      },
    });

    dispatchDialogInput("\x1bOH", deps);

    expect(onMainMenuBindingChange).toHaveBeenCalledWith("options", "home");
    expect(setMainMenuCapturing).toHaveBeenCalledWith(false);
  });

  test("main menu capture accepts a bare F-key (F5 via legacy CSI ~ form)", () => {
    const onMainMenuBindingChange = mock((_action: string, _combo: string) => {});
    const setMainMenuCapturing = mock((_capturing: boolean) => {});
    const deps = createDeps({
      mainMenu: {
        ...createDeps().mainMenu,
        getMainMenuActionForSlot: mock(() => "sessions"),
        onMainMenuBindingChange,
      },
      uiChromeState: {
        ...createDeps().uiChromeState,
        mainMenuCapturing: true,
        mainMenuDialogOpen: true,
        setMainMenuCapturing,
      },
    });

    dispatchDialogInput("\x1b[15~", deps);

    expect(onMainMenuBindingChange).toHaveBeenCalledWith("sessions", "f5");
    expect(setMainMenuCapturing).toHaveBeenCalledWith(false);
  });

  test("main menu capture still rejects a bare printable letter", () => {
    const onMainMenuBindingChange = mock((_action: string, _combo: string) => {});
    const setMainMenuCapturing = mock((_capturing: boolean) => {});
    const deps = createDeps({
      mainMenu: {
        ...createDeps().mainMenu,
        getMainMenuActionForSlot: mock(() => "options"),
        onMainMenuBindingChange,
      },
      uiChromeState: {
        ...createDeps().uiChromeState,
        mainMenuCapturing: true,
        mainMenuDialogOpen: true,
        setMainMenuCapturing,
      },
    });

    dispatchDialogInput("a", deps);

    expect(onMainMenuBindingChange).not.toHaveBeenCalled();
    expect(setMainMenuCapturing).not.toHaveBeenCalledWith(false);
  });

  test("main menu capture rejects a modifier already reserved as the tmux prefix key alias", () => {
    const setMainMenuCaptureError = mock((_value: string) => {});
    const onMainMenuBindingChange = mock((_action: string, _combo: string) => {});
    const deps = createDeps({
      mainMenu: {
        ...createDeps().mainMenu,
        getMainMenuActionForSlot: mock(() => "zoomAgentsView"),
        onMainMenuBindingChange,
      },
      optionsWorkflow: {
        ...createDeps().optionsWorkflow,
        configTmuxPrefixKeyAlias: "right_shift",
      },
      uiChromeState: {
        ...createDeps().uiChromeState,
        mainMenuCapturing: true,
        mainMenuDialogOpen: true,
        setMainMenuCaptureError,
      },
    });

    dispatchDialogInput("\x1b[57447;2:3u", deps);

    expect(setMainMenuCaptureError).toHaveBeenCalledWith("right shift already bound to tmux prefix key alias");
    expect(onMainMenuBindingChange).not.toHaveBeenCalled();
  });
});
