import { describe, expect, it } from "bun:test";

import {
  buildAppPaneProps,
  buildMainPaneHistoryProps,
  buildMainPaneToolbarProps,
  closePaneDropdown,
} from "./build-app-pane-props.ts";

describe("build-app-pane-props", () => {
  it("toggles toolbar open state", () => {
    let toggled = false;
    const onToolbarToggle = () => {
      toggled = true;
    };

    const props = buildMainPaneToolbarProps({
      handleBufferZoom: () => {},
      handleClosePane: () => {},
      handleDetach: () => {},
      handleOpenMainMenu: () => {},
      handleSplitHorizontal: () => {},
      handleSplitVertical: () => {},
      onSidebarToggle: () => {},
      onSidebarViewChange: () => {},
      onToolbarToggle,
      sidebarOpen: false,
      sidebarView: "agents" as const,
      sidebarWidth: 32,
      toolbarOpen: true,
    });
    expect(typeof props.onToolbarToggle).toBe("function");
    props.onToolbarToggle!();
    expect(toggled).toBe(true);
  });

  it("maps history consent states to conversation/indexing flags", () => {
    let openConversationsCalls = 0;
    const openConversationsRef = {
      current: () => {
        openConversationsCalls++;
      },
    };

    const allowed = buildMainPaneHistoryProps({
      handleOpenConversationsRef: openConversationsRef,
      historyConsent: true,
      historyReady: false,
    });
    expect(typeof allowed.onConversations).toBe("function");
    allowed.onConversations?.();
    expect(openConversationsCalls).toBe(1);
    expect(allowed.historyReady).toBe(false);
    expect(allowed.consentPending).toBe(false);

    const denied = buildMainPaneHistoryProps({
      handleOpenConversationsRef: openConversationsRef,
      historyConsent: false,
      historyReady: true,
    });
    expect(denied.onConversations).toBeUndefined();
    expect(denied.historyReady).toBe(false);
    expect(denied.consentPending).toBe(false);

    const pending = buildMainPaneHistoryProps({
      handleOpenConversationsRef: openConversationsRef,
      historyConsent: null,
      historyReady: true,
    });
    expect(typeof pending.onConversations).toBe("function");
    pending.onConversations?.();
    expect(openConversationsCalls).toBe(2);
    expect(pending.historyReady).toBe(false);
    expect(pending.consentPending).toBe(true);
  });

  it("clears dropdown handler and closes dropdown", () => {
    const dropdownInputRef = {
      current: () => true,
    };
    let isOpen = true;

    closePaneDropdown({
      dropdownInputRef,
      setOpen: (open: boolean) => {
        isOpen = open;
      },
    });

    expect(dropdownInputRef.current).toBeNull();
    expect(isOpen).toBe(false);
  });

  it("threads coding agent activity into the muxotron agent props", () => {
    const props = {
      activePaneId: null,
      agentActions: {
        handleAgentsDialogSelect: () => {},
        handleGoToPane: () => {},
        handleOpenAgentsDialog: () => {},
        handlePermissionRespond: () => {},
      },
      agentDialogState: {
        agentSessions: [],
        agentsDialogOpen: false,
        hookSnifferEvents: [],
        setAgentsDialogOpen: () => {},
      },
      capturedPaneLines: null,
      codingAgentActivity: { hasConnectedAgent: true, lastOutputAt: 1234, lastOutputTickAt: 5678 },
      dimInactivePanesEnabled: false,
      dimInactivePanesOpacity: 40,
      effectiveUIMode: "adaptive" as const,
      handlers: {
        handleTerminalReady: () => {},
      },
      height: 24,
      historyWorkflow: {
        handleOpenConversationsRef: { current: () => {} },
        historyConsent: false,
        historyReady: false,
      },
      infoCount: 0,
      layoutProfiles: {
        handleDeleteProfile: () => {},
        handleLayoutProfileClick: () => {},
        handleLayoutSave: async () => undefined,
        handleLayoutSelect: () => {},
        handleRenameProfile: () => {},
        handleSaveCommands: () => {},
        handleSetFavorite: () => {},
        layoutDropdownOpen: false,
        layoutProfiles: [],
        setLayoutDropdownOpen: () => {},
      },
      muxotronFocusActive: false,
      optionsWorkflow: {
        config: {
          agentAlertAnimConfusables: true,
          agentAlertAnimCycleCount: 1,
          agentAlertAnimDelay: 60,
          agentAlertAnimEqualizer: false,
          agentAlertAnimGlow: false,
          agentAlertAnimScribble: false,
          dimInactivePanesOpacity: 40,
          muxotronEnabled: true,
        },
        configActiveWindowIdDisplayEnabled: false,
        configAgentAlertAnimConfusables: true,
        configAgentAlertAnimCycleCount: 1,
        configAgentAlertAnimDelay: 60,
        configAgentAlertAnimEqualizer: false,
        configAgentAlertAnimGlow: false,
        configAgentAlertAnimScribble: false,
        configMuxotronEnabled: true,
        configThemeBuiltin: "catppuccin-mocha",
        configThemeMode: "built-in",
        configUIMode: "adaptive",
        optionsDialogOpen: false,
        optionsDialogRow: 0,
        optionsDialogTab: "general",
      },
      paneTabsApi: {
        handleClosePaneTab: async () => false,
        handleSwitchPaneTab: () => {},
        paneTabGroups: new Map(),
      },
      refs: {
        agentNavNextRef: { current: null },
        agentNavPrevRef: { current: null },
        clientRef: { current: null },
        dropdownInputRef: { current: null },
        handleAgentNextRef: { current: () => {} },
        handleAgentPrevRef: { current: () => {} },
        handleBufferZoomRef: { current: () => {} },
        handleCloseQuickTerminalRef: { current: () => {} },
        handleDismissRef: { current: () => {} },
        handleGotoAgentRef: { current: () => {} },
        handleMobileToggleRef: { current: () => {} },
        handleMuxotronDismissRef: { current: () => {} },
        handleNotificationsClickRef: { current: () => {} },
        handleOpenQuickTerminalRef: { current: () => {} },
        handleOptionsClickRef: { current: () => {} },
        handleOverlayCloseRef: { current: () => {} },
        handlePopupAccessRef: { current: () => {} },
        handleQuickApproveRef: { current: () => {} },
        handleQuickDenyRef: { current: () => {} },
        handleScreenshotRef: { current: () => {} },
        handleSidebarToggleRef: { current: () => {} },
        handleToolbarToggleRef: { current: () => {} },
        overflowOpenRef: { current: false },
        registryRef: { current: null },
        showHintRef: { current: null },
        tabDragEndRef: { current: null },
        tabDragMoveRef: { current: null },
        tabDraggingRef: { current: false },
        tabRightClickRef: { current: null },
        textInputEscapeHandlerRef: { current: null },
      },
      selectedSession: null,
      sidebarFocused: false,
      sidebarFocusedIndex: 0,
      sidebarItemCountRef: { current: 0 },
      sidebarViewActivateRef: { current: null },
      tabActions: {
        handleCloseWindow: () => {},
        handleMoveWindowToSession: () => {},
        handleTabClick: () => {},
        handleTabRename: () => {},
        handleTabReorder: () => {},
      },
      termHeight: 24,
      tmuxSessionState: {
        activeIndex: 0,
        connected: true,
        currentSessionName: "alpha",
        keyBindings: null,
        sessions: [],
        statusBarInfo: null,
        windows: [],
      },
      uiActions: {
        handleClosePane: () => {},
        handleCreateSession: () => {},
        handleDeleteSession: () => {},
        handleDetach: () => {},
        handleGetSessionInfo: async () => ({ paneTabsEnabled: 0, panes: 0, windows: 0 }),
        handleNewWindow: () => {},
        handleRenameSession: () => {},
        handleSessionClick: () => {},
        handleSessionSelect: async () => {},
        handleSetSessionColor: () => {},
        handleSidebarToggle: () => {},
        handleSplitHorizontal: () => {},
        handleSplitVertical: () => {},
        handleTextInputActive: () => {},
      },
      uiChromeState: {
        dropdownOpen: false,
        setDropdownOpen: () => {},
        setMainMenuDialogOpen: () => {},
        sidebarOpen: false,
        sidebarView: "agents" as const,
        sidebarWidth: 32,
        toolbarOpen: false,
      },
      warningCount: 0,
      width: 80,
    } as any;

    const result = buildAppPaneProps(props);
    expect(result.agent.codingAgentActivity).toEqual({
      hasConnectedAgent: true,
      lastOutputAt: 1234,
      lastOutputTickAt: 5678,
    });
  });
});
