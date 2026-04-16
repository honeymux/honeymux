import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { CodingAgentPaneActivity, CodingAgentPaneOutputSample } from "../../agents/pane-activity.ts";
import type {
  TmuxPaneAgentProps,
  TmuxPaneCoreProps,
  TmuxPaneHistoryProps,
  TmuxPaneLayoutProps,
  TmuxPaneSessionDropdownProps,
  TmuxPaneSharedProps,
  TmuxPaneToolbarProps,
} from "../../components/tmux-pane/types.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { UIMode } from "../../util/config.ts";
import type { PaneTabGroup } from "../pane-tabs/types.ts";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AgentActionsApi } from "./use-agent-actions.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { AgentDialogState, TmuxSessionState, UiChromeState } from "./use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "./use-history-workflow.ts";
import type { LayoutProfilesApi } from "./use-layout-profiles.ts";
import type { OptionsWorkflowApi } from "./use-options-workflow.ts";
import type { TabActionsApi } from "./use-tab-actions.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { TAB_ROWS } from "../options/model.ts";

export interface ClosePaneDropdownOptions {
  dropdownInputRef: MutableRefObject<((data: string) => boolean) | null>;
  setOpen: ((open: boolean) => void) | Dispatch<SetStateAction<boolean>>;
}

interface BuildAppPanePropsOptions {
  activePaneId?: null | string;
  activePaneRect?: import("./use-dim-inactive-panes.ts").DimPaneRect | null;
  agentActions: AgentActionsApi;
  agentDialogState: AgentDialogState;
  /** Human-readable label for the agentLatch binding (e.g. "right shift"). */
  agentLatchBindingLabel?: string;
  agentTerminalNode?: import("react").ReactNode;
  bufferZoomBinding?: string;
  /** Captured pane content lines (ANSI-stripped) for focused alive agents. */
  capturedPaneLines?: null | string[];
  codingAgentActivity?: CodingAgentPaneActivity;
  codingAgentLastOutputByPaneRef?: import("react").RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  dimInactivePanesEnabled?: boolean;
  dimInactivePanesOpacity?: number;
  effectiveUIMode?: UIMode;
  handlers: {
    handleTerminalReady: (terminal: GhosttyTerminalRenderable) => void;
  };
  height: number;
  historyWorkflow: HistoryWorkflowApi;
  infoCount?: number;
  /** Agent currently bridged interactively in the focused muxotron, if any. */
  interactiveAgent?: import("../../agents/types.ts").AgentSession | null;
  layoutProfiles: LayoutProfilesApi;
  mainMenuBindingLabel?: string;
  /** True when the mux-o-tron has keyboard focus in muxotron-focus mode (dim terminal). */
  muxotronFocusActive?: boolean;
  /** Called when user clicks the dimmed terminal area to dismiss muxotron focus. */
  onMuxotronDismiss?: () => void;
  onSidebarViewChange: (view: "agents" | "hook-sniffer" | "server") => void;
  /** Handles explicit agent selection from the tree while mux-o-tron is focused. */
  onTreeAgentSelect?: (session: import("../../agents/types.ts").AgentSession) => void;
  onTreeNavigate?: (sessionName: string, windowId: string, paneId: string) => void;
  optionsWorkflow: OptionsWorkflowApi;
  paneTabsApi: PaneTabsApi;
  refs: AppRuntimeRefs;
  /** True while the selected review session is latched into the muxotron PTY. */
  reviewLatched?: boolean;
  /** Agent selected from tree view — forces muxotronEnabled expansion. */
  selectedSession?: import("../../agents/types.ts").AgentSession | null;
  sidebarFocused?: boolean;
  sidebarFocusedIndex?: number;
  sidebarItemCountRef?: MutableRefObject<number>;
  sidebarViewActivateRef?: MutableRefObject<((index: number) => void) | null>;
  sidebarViewZoomRef?: MutableRefObject<((index: number) => void) | null>;
  tabActions: TabActionsApi;
  termCols?: number;
  termHeight?: number;
  termRows?: number;
  tmuxSessionState: TmuxSessionState;
  toolbarTimer?: {
    activateRef: MutableRefObject<((index: number) => void) | null>;
    focusedIndex: number;
    itemCountRef: MutableRefObject<number>;
  };
  uiActions: UiActionsApi;
  uiChromeState: UiChromeState;
  warningCount?: number;
  width: number;
}

export function buildAppPaneProps({
  activePaneId,
  activePaneRect,
  agentActions,
  agentDialogState,
  agentLatchBindingLabel,
  agentTerminalNode,
  bufferZoomBinding,
  capturedPaneLines,
  codingAgentActivity,
  codingAgentLastOutputByPaneRef,
  dimInactivePanesEnabled,
  dimInactivePanesOpacity,
  effectiveUIMode,
  handlers,
  height,
  historyWorkflow,
  infoCount,
  interactiveAgent,
  layoutProfiles,
  mainMenuBindingLabel,
  muxotronFocusActive,
  onMuxotronDismiss,
  onSidebarViewChange,
  onTreeAgentSelect,
  onTreeNavigate,
  optionsWorkflow,
  paneTabsApi,
  refs,
  reviewLatched,
  selectedSession,
  sidebarFocused,
  sidebarFocusedIndex,
  sidebarItemCountRef,
  sidebarViewActivateRef,
  sidebarViewZoomRef,
  tabActions,
  termCols,
  termHeight,
  termRows,
  tmuxSessionState,
  toolbarTimer,
  uiActions,
  uiChromeState,
  warningCount,
  width,
}: BuildAppPanePropsOptions) {
  const handleDropdownClose = () => {
    closePaneDropdown({
      dropdownInputRef: refs.dropdownInputRef,
      setOpen: uiChromeState.setDropdownOpen,
    });
  };

  const handleLayoutDropdownClose = () => {
    closePaneDropdown({
      dropdownInputRef: refs.dropdownInputRef,
      setOpen: layoutProfiles.setLayoutDropdownOpen,
    });
  };

  const handleAgentsDialogClose = () => {
    closePaneDropdown({
      dropdownInputRef: refs.dropdownInputRef,
      setOpen: agentDialogState.setAgentsDialogOpen,
    });
  };

  const core: TmuxPaneCoreProps = {
    activeIndex: tmuxSessionState.activeIndex,
    connected: tmuxSessionState.connected,
    height,
    onCloseWindow: tabActions.handleCloseWindow,
    onMoveWindowToSession: tabActions.handleMoveWindowToSession,
    onNewWindow: uiActions.handleNewWindow,
    onSessionClick: uiActions.handleSessionClick,
    onTabClick: tabActions.handleTabClick,
    onTabDragChange: (dragging: boolean) => {
      refs.tabDraggingRef.current = dragging;
    },
    onTabRename: tabActions.handleTabRename,
    onTabReorder: tabActions.handleTabReorder,
    onTerminalReady: handlers.handleTerminalReady,
    sessionName: tmuxSessionState.currentSessionName,
    tabDragEndRef: refs.tabDragEndRef,
    tabDragMoveRef: refs.tabDragMoveRef,
    width,
    windows: tmuxSessionState.windows,
  };

  const sessionDropdown: TmuxPaneSessionDropdownProps = {
    configOpen: optionsWorkflow.optionsDialogOpen,
    currentSession: tmuxSessionState.currentSessionName,
    dropdownOpen: uiChromeState.dropdownOpen,
    onCreateSession: uiActions.handleCreateSession,
    onDeleteSession: uiActions.handleDeleteSession,
    onDropdownClose: handleDropdownClose,
    onGetSessionInfo: uiActions.handleGetSessionInfo,
    onRenameSession: uiActions.handleRenameSession,
    onSessionSelect: uiActions.handleSessionSelect,
    onSetSessionColor: uiActions.handleSetSessionColor,
    onTextInputActive: uiActions.handleTextInputActive,
    sessions: tmuxSessionState.sessions,
  };

  const toolbar = buildMainPaneToolbarProps({
    activePaneRect,
    bufferZoomBinding,
    clientRef: refs.clientRef,
    currentSessionName: tmuxSessionState.currentSessionName,
    dimInactivePanesEnabled,
    dimInactivePanesOpacity,
    handleBufferZoom: () => refs.handleBufferZoomRef.current(),
    handleClosePane: () => {
      paneTabsApi.handleClosePaneTab().then((handled) => {
        if (!handled) uiActions.handleClosePane();
      });
    },
    handleDetach: uiActions.handleDetach,
    handleOpenMainMenu: () => uiChromeState.setMainMenuDialogOpen(true),
    handleSplitHorizontal: uiActions.handleSplitHorizontal,
    handleSplitVertical: uiActions.handleSplitVertical,
    handleTreeNavigate: onTreeNavigate,
    handleTreeSwitchPaneTab: paneTabsApi.handleSwitchPaneTab,
    mainMenuBindingLabel,
    muxotronFocusActive,
    onMobileToggle: () => refs.handleMobileToggleRef.current(),
    onMuxotronDismiss,
    onSidebarToggle: () => refs.handleSidebarToggleRef.current(),
    onSidebarViewChange,
    onToolbarToggle: () => refs.handleToolbarToggleRef.current(),
    paneTabGroups: paneTabsApi.paneTabGroups,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarItemCountRef,
    sidebarOpen: uiChromeState.sidebarOpen,
    sidebarView: uiChromeState.sidebarView,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    sidebarWidth: uiChromeState.sidebarWidth,
    tmuxKeyBindingHints: optionsWorkflow.config.tmuxKeyBindingHints ?? true,
    toolbarActivateRef: toolbarTimer?.activateRef,
    toolbarFocused: toolbarTimer != null && toolbarTimer.focusedIndex >= 0,
    toolbarFocusedIndex: toolbarTimer?.focusedIndex,
    toolbarItemCountRef: toolbarTimer?.itemCountRef,
    toolbarOpen: uiChromeState.toolbarOpen,
  });

  const layout: TmuxPaneLayoutProps = {
    layoutDropdownOpen: layoutProfiles.layoutDropdownOpen,
    layoutProfiles: layoutProfiles.layoutProfiles,
    onLayoutDelete: layoutProfiles.handleDeleteProfile,
    onLayoutDropdownClose: handleLayoutDropdownClose,
    onLayoutProfileClick: layoutProfiles.handleLayoutProfileClick,
    onLayoutRename: layoutProfiles.handleRenameProfile,
    onLayoutSave: layoutProfiles.handleLayoutSave,
    onLayoutSaveCommands: layoutProfiles.handleSaveCommands,
    onLayoutSelect: layoutProfiles.handleLayoutSelect,
    onLayoutSetFavorite: layoutProfiles.handleSetFavorite,
  };

  const agent: TmuxPaneAgentProps = {
    activePaneId,
    agentAlertAnimConfusables: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimConfusables
      : (optionsWorkflow.config.agentAlertAnimConfusables ?? true),
    agentAlertAnimCycleCount: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimCycleCount
      : (optionsWorkflow.config.agentAlertAnimCycleCount ?? 1),
    agentAlertAnimDelay: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimDelay
      : (optionsWorkflow.config.agentAlertAnimDelay ?? 60),
    agentAlertAnimEqualizer: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimEqualizer
      : (optionsWorkflow.config.agentAlertAnimEqualizer ?? false),
    agentAlertAnimGlow: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimGlow
      : (optionsWorkflow.config.agentAlertAnimGlow ?? false),
    agentAlertAnimScribble: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configAgentAlertAnimScribble
      : (optionsWorkflow.config.agentAlertAnimScribble ?? false),
    agentLatchBindingLabel,
    agentNavNextRef: refs.agentNavNextRef,
    agentNavPrevRef: refs.agentNavPrevRef,
    agentSessions: agentDialogState.agentSessions,
    agentSessionsForDialog: agentDialogState.agentSessions,
    agentTermCols: termCols,
    agentTermRows: termRows,
    agentTerminalNode,
    agentsDialogOpen: agentDialogState.agentsDialogOpen,
    capturedPaneLines,
    codingAgentActivity,
    codingAgentLastOutputByPaneRef,
    configAgentsPreview:
      optionsWorkflow.optionsDialogOpen && optionsWorkflow.optionsDialogTab === "agents"
        ? (TAB_ROWS.agents[optionsWorkflow.optionsDialogRow] ?? null)
        : null,

    hookSnifferEvents: agentDialogState.hookSnifferEvents,
    infoCount,
    interactiveAgent,
    muxotronEnabled: optionsWorkflow.optionsDialogOpen
      ? optionsWorkflow.configMuxotronEnabled
      : (optionsWorkflow.config.muxotronEnabled ?? true),
    muxotronExpanded:
      (effectiveUIMode === "adaptive" &&
        agentDialogState.agentSessions.some(
          (s) => s.status === "unanswered" && !s.dismissed && s.paneId !== activePaneId,
        )) ||
      !!selectedSession,
    muxotronFocusActive,
    onAgentsDialogClose: handleAgentsDialogClose,
    onAgentsDialogSelect: agentActions.handleAgentsDialogSelect,
    onApprove: () => refs.handleQuickApproveRef.current(),
    onDeny: () => refs.handleQuickDenyRef.current(),
    onDismiss: () => refs.handleDismissRef.current(),
    onGoToPane: agentActions.handleGoToPane,
    onGoto: () => refs.handleGotoAgentRef.current(),
    onMuxotronClick: agentActions.handleOpenAgentsDialog,
    onNextAgent: selectedSession ? () => refs.handleAgentNextRef.current() : undefined,
    onNotificationsClick: () => refs.handleNotificationsClickRef.current(),
    onPermissionRespond: agentActions.handlePermissionRespond,
    onPrevAgent: selectedSession ? () => refs.handleAgentPrevRef.current() : undefined,
    onReviewLatchToggle: () => refs.toggleReviewLatchRef.current?.(),
    onTreeAgentSelect,
    registryRef: refs.registryRef,
    reviewLatched: reviewLatched ?? false,
    selectedSession,
    termHeight,
    warningCount,
  };

  const history = buildMainPaneHistoryProps({
    handleOpenConversationsRef: historyWorkflow.handleOpenConversationsRef,
    historyConsent: historyWorkflow.historyConsent,
    historyReady: historyWorkflow.historyReady,
  });

  const shared: TmuxPaneSharedProps = {
    activeWindowIdDisplayEnabled: optionsWorkflow.configActiveWindowIdDisplayEnabled,
    dropdownInputRef: refs.dropdownInputRef,
    keyBindings: tmuxSessionState.keyBindings,
    overflowOpenRef: refs.overflowOpenRef,
    ptyDragActiveRef: refs.ptyDragActiveRef,
    showHintRef: refs.showHintRef,
    statusBarInfo: tmuxSessionState.statusBarInfo,
    tabRightClickRef: refs.tabRightClickRef,
    textInputEscapeHandlerRef: refs.textInputEscapeHandlerRef,
    uiMode: effectiveUIMode ?? optionsWorkflow.configUIMode,
  };

  return {
    agent,
    core,
    history,
    layout,
    sessionDropdown,
    shared,
    toolbar,
  };
}

export function buildMainPaneHistoryProps({
  handleOpenConversationsRef,
  historyConsent,
  historyReady,
}: {
  handleOpenConversationsRef: MutableRefObject<() => void>;
  historyConsent: boolean | null;
  historyReady: boolean;
}): TmuxPaneHistoryProps {
  return {
    consentPending: historyConsent === null,
    historyReady: historyConsent === true && historyReady,
    onConversations: historyConsent !== false ? () => handleOpenConversationsRef.current() : undefined,
  };
}

export function buildMainPaneToolbarProps({
  activePaneRect,
  bufferZoomBinding,
  clientRef,
  currentSessionName,
  dimInactivePanesEnabled,
  dimInactivePanesOpacity,
  handleBufferZoom,
  handleClosePane,
  handleDetach,
  handleOpenMainMenu,
  handleSplitHorizontal,
  handleSplitVertical,
  handleTreeNavigate,
  handleTreeSwitchPaneTab,
  mainMenuBindingLabel,
  muxotronFocusActive,
  onMobileToggle,
  onMuxotronDismiss,
  onSidebarToggle,
  onSidebarViewChange,
  onToolbarToggle,
  paneTabGroups,
  sidebarFocused,
  sidebarFocusedIndex,
  sidebarItemCountRef,
  sidebarOpen,
  sidebarView,
  sidebarViewActivateRef,
  sidebarViewZoomRef,
  sidebarWidth,
  tmuxKeyBindingHints,
  toolbarActivateRef,
  toolbarFocused,
  toolbarFocusedIndex,
  toolbarItemCountRef,
  toolbarOpen,
}: {
  activePaneRect?: import("./use-dim-inactive-panes.ts").DimPaneRect | null;
  bufferZoomBinding?: string;
  clientRef?: MutableRefObject<TmuxControlClient | null>;
  currentSessionName?: string;
  dimInactivePanesEnabled?: boolean;
  dimInactivePanesOpacity?: number;
  handleBufferZoom: () => void;
  handleClosePane: () => void;
  handleDetach: () => void;
  handleOpenMainMenu: () => void;
  handleSplitHorizontal: () => void;
  handleSplitVertical: () => void;
  handleTreeNavigate?: (sessionName: string, windowId: string, paneId: string) => void;
  handleTreeSwitchPaneTab?: (slotKey: string, tabIndex: number) => void;
  mainMenuBindingLabel?: string;
  muxotronFocusActive?: boolean;
  onMobileToggle?: () => void;
  onMuxotronDismiss?: () => void;
  onSidebarToggle: () => void;
  onSidebarViewChange: (view: "agents" | "hook-sniffer" | "server") => void;
  onToolbarToggle: () => void;
  paneTabGroups?: Map<string, PaneTabGroup>;
  sidebarFocused?: boolean;
  sidebarFocusedIndex?: number;
  sidebarItemCountRef?: MutableRefObject<number>;
  sidebarOpen: boolean;
  sidebarView: "agents" | "hook-sniffer" | "server";
  sidebarViewActivateRef?: MutableRefObject<((index: number) => void) | null>;
  sidebarViewZoomRef?: MutableRefObject<((index: number) => void) | null>;
  sidebarWidth: number;
  tmuxKeyBindingHints?: boolean;
  toolbarActivateRef?: MutableRefObject<((index: number) => void) | null>;
  toolbarFocused?: boolean;
  toolbarFocusedIndex?: number;
  toolbarItemCountRef?: MutableRefObject<number>;
  toolbarOpen: boolean;
}): TmuxPaneToolbarProps {
  return {
    activePaneRect,
    bufferZoomBinding,
    dimInactivePanesEnabled,
    dimInactivePanesOpacity,
    mainMenuBindingLabel,
    muxotronFocusActive,
    onBufferZoom: handleBufferZoom,
    onClosePane: handleClosePane,
    onDetach: handleDetach,
    onMobileToggle,
    onMuxotronDismiss,
    onOpenMainMenu: handleOpenMainMenu,
    onSidebarToggle,
    onSidebarViewChange,
    onSplitHorizontal: handleSplitHorizontal,
    onSplitVertical: handleSplitVertical,
    onToolbarToggle,
    sidebarClientRef: clientRef,
    sidebarCurrentSessionName: currentSessionName,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarItemCountRef,
    sidebarOnTreeNavigate: handleTreeNavigate,
    sidebarOnTreeSwitchPaneTab: handleTreeSwitchPaneTab,
    sidebarOpen,
    sidebarPaneTabGroups: paneTabGroups,
    sidebarView,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    sidebarWidth,
    tmuxKeyBindingHints,
    toolbarActivateRef,
    toolbarFocused,
    toolbarFocusedIndex,
    toolbarItemCountRef,
    toolbarOpen,
  };
}

export function closePaneDropdown({ dropdownInputRef, setOpen }: ClosePaneDropdownOptions): void {
  dropdownInputRef.current = null;
  setOpen(false);
}
