import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import { useCallback, useMemo } from "react";

import type { CodingAgentPaneActivity, CodingAgentPaneOutputSample } from "../../agents/pane-activity.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { TmuxWindow } from "../../tmux/types.ts";
import type { UIMode } from "../../util/config.ts";
import type { KeybindingConfig } from "../../util/keybindings.ts";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AgentActionsApi } from "./use-agent-actions.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { AgentDialogState, TmuxSessionState, UiChromeState } from "./use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "./use-history-workflow.ts";
import type { LayoutProfilesApi } from "./use-layout-profiles.ts";
import type { OptionsWorkflowApi } from "./use-options-workflow.ts";
import type { TabActionsApi } from "./use-tab-actions.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { formatBinding } from "../../util/keybindings.ts";
import { buildAppPaneProps } from "./build-app-pane-props.ts";

export interface MainPaneModelApi {
  handleTreeNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  mainPaneProps: ReturnType<typeof buildAppPaneProps>;
}

interface UseMainPaneModelOptions {
  activePaneId: null | string;
  activePaneRect: import("./use-dim-inactive-panes.ts").DimPaneRect | null;
  agentActions: AgentActionsApi;
  agentDialogState: AgentDialogState;
  agentLatchBindingLabel: string | undefined;
  agentTerminalNode: import("react").ReactNode;
  capturedPaneLines: null | string[];
  codingAgentActivity: CodingAgentPaneActivity;
  codingAgentLastOutputByPaneRef: import("react").RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  dimEnabled: boolean;
  displayWindows: TmuxWindow[];
  effectiveUIMode: UIMode;
  handleSidebarViewChange: (view: "agents" | "hook-sniffer" | "server") => void;
  handleTerminalReady: (terminal: GhosttyTerminalRenderable) => void;
  height: number;
  historyWorkflow: HistoryWorkflowApi;
  infoCount: number;
  interactiveAgent: AgentSession | null;
  keybindingConfig: KeybindingConfig;
  layoutProfiles: LayoutProfilesApi;
  muxotronFocusActive: boolean;
  onInteractiveScrollSequence: (sequence: string) => void;
  onTreeAgentSelect: (session: AgentSession) => void;
  optionsWorkflow: OptionsWorkflowApi;
  paneTabsApi: PaneTabsApi;
  refs: AppRuntimeRefs;
  reviewLatched: boolean;
  selectedSession: AgentSession | null;
  sidebarFocused: boolean;
  sidebarFocusedIndex: number;
  sidebarItemCountRef: MutableRefObject<number>;
  sidebarViewActivateRef: MutableRefObject<((index: number) => void) | null>;
  sidebarViewZoomRef: MutableRefObject<((index: number) => void) | null>;
  tabActions: TabActionsApi;
  /** honeymux's own tmux-client column count (width minus chrome). */
  termCols: number;
  /** honeymux's own tmux-client row count (height minus chrome). */
  termRows: number;
  tmuxSessionState: TmuxSessionState;
  toolbarActivateRef: MutableRefObject<((index: number) => void) | null>;
  toolbarFocusedIndex: number;
  toolbarItemCountRef: MutableRefObject<number>;
  uiActions: UiActionsApi;
  uiChromeState: UiChromeState;
  warningCount: number;
  width: number;
}

export function formatBufferZoomBinding(keybindingConfig: KeybindingConfig): string | undefined {
  return keybindingConfig.bufferZoom ? formatBinding(keybindingConfig.bufferZoom) : undefined;
}

export function formatMainMenuBinding(keybindingConfig: KeybindingConfig): string | undefined {
  return keybindingConfig.mainMenu ? formatBinding(keybindingConfig.mainMenu) : undefined;
}

export function shouldSwitchTreeSession(currentSessionName: string, targetSessionName: string): boolean {
  return currentSessionName !== targetSessionName;
}

export function useMainPaneModel({
  activePaneId,
  activePaneRect,
  agentActions,
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
  interactiveAgent,
  keybindingConfig,
  layoutProfiles,
  muxotronFocusActive,
  onInteractiveScrollSequence,
  onTreeAgentSelect,
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
  termRows,
  tmuxSessionState,
  toolbarActivateRef,
  toolbarFocusedIndex,
  toolbarItemCountRef,
  uiActions,
  uiChromeState,
  warningCount,
  width,
}: UseMainPaneModelOptions): MainPaneModelApi {
  const handleTreeNavigate = useCallback(
    (sessionName: string, windowId: string, paneId: string) => {
      const selectTargetPane = async () => {
        const client = refs.clientRef.current;
        if (!client) return;
        await client.selectWindow(windowId).catch(() => {});
        await client.selectPane(paneId).catch(() => {});
      };

      if (shouldSwitchTreeSession(tmuxSessionState.currentSessionName, sessionName)) {
        uiActions.handleSessionSelect(sessionName).then(() => {
          void selectTargetPane();
        });
        return;
      }

      void selectTargetPane();
    },
    [refs.clientRef, tmuxSessionState.currentSessionName, uiActions.handleSessionSelect],
  );

  const bufferZoomBinding = formatBufferZoomBinding(keybindingConfig);
  const mainMenuBindingLabel = formatMainMenuBinding(keybindingConfig);

  const mainPaneProps = useMemo(
    () =>
      buildAppPaneProps({
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
        dimInactivePanesEnabled: dimEnabled,
        dimInactivePanesOpacity: optionsWorkflow.config.dimInactivePanesOpacity ?? 40,
        effectiveUIMode,
        handlers: {
          handleTerminalReady,
        },
        height,
        historyWorkflow,
        infoCount,
        interactiveAgent,
        layoutProfiles,
        mainMenuBindingLabel,
        muxotronFocusActive,
        onInteractiveScrollSequence,
        onMuxotronDismiss: () => refs.handleMuxotronDismissRef.current(),
        onSidebarViewChange: handleSidebarViewChange,
        onTreeAgentSelect,
        onTreeNavigate: handleTreeNavigate,
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
        termHeight: height,
        termRows,
        tmuxSessionState: { ...tmuxSessionState, windows: displayWindows },
        toolbarTimer: {
          activateRef: toolbarActivateRef,
          focusedIndex: toolbarFocusedIndex,
          itemCountRef: toolbarItemCountRef,
        },
        uiActions,
        uiChromeState,
        warningCount,
        width,
      }),
    [
      activePaneId,
      activePaneRect,
      agentActions.handleAgentsDialogSelect,
      agentActions.handleGoToPane,
      agentActions.handleOpenAgentsDialog,
      agentActions.handlePermissionRespond,
      agentDialogState.agentSessions,
      agentDialogState.agentsDialogOpen,
      agentDialogState.hookSnifferEvents,
      agentLatchBindingLabel,
      reviewLatched,
      agentTerminalNode,
      capturedPaneLines,
      codingAgentActivity.hasConnectedAgent,
      codingAgentActivity.lastOutputAt,
      codingAgentActivity.lastOutputTickAt,
      codingAgentLastOutputByPaneRef,
      bufferZoomBinding,
      mainMenuBindingLabel,
      dimEnabled,
      displayWindows,
      effectiveUIMode,
      handleSidebarViewChange,
      handleTerminalReady,
      handleTreeNavigate,
      height,
      historyWorkflow.historyConsent,
      historyWorkflow.historyReady,
      infoCount,
      interactiveAgent,
      layoutProfiles.handleDeleteProfile,
      layoutProfiles.handleLayoutProfileClick,
      layoutProfiles.handleLayoutSave,
      layoutProfiles.handleLayoutSelect,
      layoutProfiles.handleRenameProfile,
      layoutProfiles.handleSaveCommands,
      layoutProfiles.handleSetFavorite,
      layoutProfiles.layoutDropdownOpen,
      layoutProfiles.layoutProfiles,
      muxotronFocusActive,
      onInteractiveScrollSequence,
      onTreeAgentSelect,
      optionsWorkflow.config,
      optionsWorkflow.configAgentAlertAnimGlow,
      optionsWorkflow.configAgentAlertAnimConfusables,
      optionsWorkflow.configAgentAlertAnimEqualizer,
      optionsWorkflow.configAgentAlertAnimScribble,
      optionsWorkflow.configMuxotronEnabled,
      optionsWorkflow.configActiveWindowIdDisplayEnabled,
      optionsWorkflow.configThemeBuiltin,
      optionsWorkflow.configThemeMode,
      optionsWorkflow.optionsDialogOpen,
      optionsWorkflow.optionsDialogRow,
      optionsWorkflow.optionsDialogTab,
      paneTabsApi.handleClosePaneTab,
      paneTabsApi.handleSwitchPaneTab,
      paneTabsApi.paneTabGroups,
      selectedSession,
      sidebarFocused,
      sidebarFocusedIndex,
      uiChromeState.sidebarOpen,
      uiChromeState.sidebarView,
      uiChromeState.sidebarWidth,
      sidebarItemCountRef,
      sidebarViewActivateRef,
      sidebarViewZoomRef,
      tabActions.handleCloseWindow,
      tabActions.handleMoveWindowToSession,
      tabActions.handleTabClick,
      tabActions.handleTabRename,
      tabActions.handleTabReorder,
      termCols,
      termRows,
      tmuxSessionState.activeIndex,
      tmuxSessionState.connected,
      tmuxSessionState.currentSessionName,
      tmuxSessionState.keyBindings,
      tmuxSessionState.sessions,
      tmuxSessionState.statusBarInfo,
      toolbarActivateRef,
      toolbarFocusedIndex,
      uiChromeState.toolbarOpen,
      toolbarItemCountRef,
      uiActions.handleClosePane,
      uiActions.handleCreateSession,
      uiActions.handleDeleteSession,
      uiActions.handleDetach,
      uiActions.handleGetSessionInfo,
      uiActions.handleNewWindow,
      uiActions.handleRedraw,
      uiActions.handleRenameSession,
      uiActions.handleSessionClick,
      uiActions.handleSessionSelect,
      uiActions.handleSetSessionColor,
      uiActions.handleSplitHorizontal,
      uiActions.handleSplitVertical,
      uiActions.handleTextInputActive,
      uiChromeState.dropdownOpen,
      warningCount,
      width,
    ],
  );

  return {
    handleTreeNavigate,
    mainPaneProps,
  };
}
