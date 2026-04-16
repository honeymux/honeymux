import { describe, expect, it } from "bun:test";

import { buildAppPaneProps } from "./build-app-pane-props.ts";

describe("app wiring hooks", () => {
  it("maps pane wiring sections and preserves close/toggle behavior", () => {
    const dropdownInputRef = {
      current: (() => true) as ((data: string) => boolean) | null,
    };
    const tabDraggingRef = { current: false };
    const tabDragMoveRef = { current: null as ((x: number) => void) | null };
    const tabDragEndRef = { current: null as ((x: number) => void) | null };
    const overflowOpenRef = { current: false };
    const showHintRef = { current: null as ((text: string) => void) | null };
    const registryRef = { current: null };

    const setDropdownOpenCalls: boolean[] = [];
    const setLayoutDropdownOpenCalls: boolean[] = [];
    const setAgentsDialogOpenCalls: boolean[] = [];
    const setMainMenuDialogOpenCalls: boolean[] = [];
    const setToolbarOpenCalls: boolean[] = [];

    const handleTabClick = () => {};
    const handleTabRename = () => {};
    const handleTabReorder = () => {};
    const handleSessionSelect = () => Promise.resolve();
    const handleCreateSession = () => Promise.resolve();
    const handleRenameSession = () => Promise.resolve();
    const handleSessionClick = () => Promise.resolve();
    const handleTerminalReady = () => {};
    const handleOptionsClick = () => Promise.resolve();
    const handleAgentsDialogSelect = () => {};
    const handlePermissionRespond = () => {};
    const handleGoToPane = () => {};

    const paneProps = buildAppPaneProps({
      agentActions: {
        handleAgentsDialogSelect: handleAgentsDialogSelect as any,
        handleGoToPane: handleGoToPane as any,
        handleOpenAgentsDialog: () => {},
        handlePermissionRespond: handlePermissionRespond as any,
      } as any,
      agentDialogState: {
        agentSessions: [],
        agentsDialogOpen: true,
        setAgentsDialogOpen: (open: boolean) => {
          setAgentsDialogOpenCalls.push(open);
        },
      } as any,
      handlers: {
        handleTerminalReady: handleTerminalReady as any,
      },
      height: 30,
      historyWorkflow: {
        handleOpenConversationsRef: { current: () => {} },
        historyConsent: null,
        historyReady: false,
      } as any,
      layoutProfiles: {
        handleApplyFavoriteProfile: () => {},

        handleLayoutProfileClick: () => {},
        handleLayoutSave: () => {},
        handleLayoutSelect: () => {},
        handleRenameProfile: () => {},
        layoutDropdownOpen: true,
        layoutProfiles: [],
        setLayoutDropdownOpen: (open: boolean) => {
          setLayoutDropdownOpenCalls.push(open);
        },
      } as any,
      onSidebarViewChange: () => {},
      optionsWorkflow: {
        config: { agentAlertAnimConfusables: true, agentAlertAnimGlow: false },
        configAgentAlertAnimConfusables: true,
        configAgentAlertAnimGlow: false,
        configAgentAlertWatermark: false,
        configUIMode: "adaptive",
        handleOptionsClick,
        optionsDialogOpen: false,
        optionsDialogTab: "general",
        setOptionsDialogTab: () => {},
      } as any,
      paneTabsApi: {
        closePaneTabContextMenu: () => {},
        closePaneTabOverflow: () => {},
        getPaneTabGroup: () => undefined,
        getPaneTabGroupForWindow: () => undefined,
        handleClosePaneTab: async () => false,
        handleClosePaneTabAt: async () => false,
        handleNewPaneTab: () => {},
        handleNextPaneTab: () => {},
        handlePrevPaneTab: () => {},
        handleRenamePaneTab: async () => {},
        handleSwitchPaneTab: () => {},
        paneTabBorderClickRef: { current: null },
        paneTabBorderHitTestRef: { current: null },
        paneTabBorderRightClickRef: { current: null },
        paneTabContextMenu: null,
        paneTabDragEndRef: { current: null },
        paneTabDragMoveRef: { current: null },
        paneTabDraggingRef: { current: false },
        paneTabGroups: new Map(),
        paneTabOverflow: null,
        validateTabGroups: () => {},
      } as any,
      refs: {
        clientRef: { current: null },
        dropdownInputRef,
        handleDismissRef: { current: () => {} },
        handleGotoAgentRef: { current: () => {} },
        handleMobileToggleRef: { current: () => {} },
        handleNotificationsClickRef: { current: () => {} },
        handlePopupAccessRef: { current: () => {} },
        handleQuickApproveRef: { current: () => {} },
        handleQuickDenyRef: { current: () => {} },
        handleSidebarToggleRef: { current: () => {} },
        handleToolbarToggleRef: {
          current: () => {
            setToolbarOpenCalls.push(true);
          },
        },
        overflowOpenRef,
        ptyDragActiveRef: { current: null },
        registryRef,
        showHintRef,
        tabDragEndRef,
        tabDragMoveRef,
        tabDraggingRef,
        tabRightClickRef: { current: null },
        textInputEscapeHandlerRef: { current: null },
      } as any,
      tabActions: {
        handleTabClick,
        handleTabRename,
        handleTabReorder,
      } as any,
      tmuxSessionState: {
        activeIndex: 0,
        connected: true,
        currentSessionName: "alpha",
        keyBindings: null,
        sessions: [{ name: "alpha", windows: 1 }],
        windows: [{ active: true, id: 0, name: "main" }],
      } as any,
      uiActions: {
        handleClosePane: () => {},
        handleCreateSession,
        handleDetach: () => {},
        handleNewWindow: () => {},
        handleRedraw: () => {},
        handleRenameSession,
        handleSessionClick,
        handleSessionSelect,
        handleSplitHorizontal: () => {},
        handleSplitVertical: () => {},
        handleTextInputActive: () => {},
      } as any,
      uiChromeState: {
        dropdownOpen: true,
        setDropdownOpen: (open: boolean) => {
          setDropdownOpenCalls.push(open);
        },
        setMainMenuDialogOpen: (open: boolean) => {
          setMainMenuDialogOpenCalls.push(open);
        },
        setSidebarOpen: () => {},
        setSidebarView: () => {},
        setSidebarWidth: () => {},
        setToolbarOpen: (open: boolean) => {
          setToolbarOpenCalls.push(open);
        },
        sidebarOpen: false,
        sidebarView: "agents",
        sidebarWidth: 32,
        toolbarOpen: false,
      } as any,
      width: 120,
    });

    expect(paneProps.core.onTabClick).toBe(handleTabClick);
    expect(paneProps.core.onTabRename).toBe(handleTabRename);
    expect(paneProps.core.onTabReorder).toBe(handleTabReorder);
    expect(paneProps.core.sessionName).toBe("alpha");
    expect(paneProps.history.consentPending).toBe(true);
    expect(typeof paneProps.toolbar.onToolbarToggle).toBe("function");

    paneProps.core.onTabDragChange?.(true);
    expect(tabDraggingRef.current).toBe(true);

    paneProps.sessionDropdown.onDropdownClose?.();
    expect(dropdownInputRef.current).toBeNull();
    expect(setDropdownOpenCalls).toEqual([false]);

    dropdownInputRef.current = () => true;
    paneProps.layout.onLayoutDropdownClose?.();
    expect(dropdownInputRef.current).toBeNull();
    expect(setLayoutDropdownOpenCalls).toEqual([false]);

    dropdownInputRef.current = () => true;
    paneProps.agent.onAgentsDialogClose?.();
    expect(dropdownInputRef.current).toBeNull();
    expect(setAgentsDialogOpenCalls).toEqual([false]);

    paneProps.toolbar.onOpenMainMenu?.();
    expect(setMainMenuDialogOpenCalls).toEqual([true]);

    paneProps.toolbar.onToolbarToggle?.();
    expect(setToolbarOpenCalls).toEqual([true]);
  });
});
