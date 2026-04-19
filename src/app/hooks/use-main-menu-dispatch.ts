import type { Dispatch, SetStateAction } from "react";

import type { MainMenuTab } from "../../components/main-menu-dialog.tsx";
import type { KeyAction, KeybindingConfig } from "../../util/keybindings.ts";
import type { DialogInputDispatchDeps } from "../dialogs/dialog-input-dispatch.ts";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AgentActionsApi } from "./use-agent-actions.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { AgentDialogState, MainMenuSelectedCol, UiChromeState } from "./use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "./use-history-workflow.ts";
import type { LayoutProfilesApi } from "./use-layout-profiles.ts";
import type { OptionsWorkflowApi } from "./use-options-workflow.ts";
import type { TabActionsApi } from "./use-tab-actions.ts";

import {
  AGENT_ROWS,
  getActionForSlot,
  getEffectiveFuncRows,
  getEffectiveNavRows,
} from "../../components/main-menu-dialog.tsx";
import { buildSequenceMap, saveKeybindings } from "../../util/keybindings.ts";
import { dispatchDialogInput } from "../dialogs/dialog-input-dispatch.ts";

interface UseMainMenuDispatchOptions {
  agentActions: AgentActionsApi;
  agentDialogState: AgentDialogState;
  guardedOptionsWorkflow: OptionsWorkflowApi;
  handleToggleZoomSticky: (action: "zoomAgentsView" | "zoomServerView") => void;
  historyWorkflow: HistoryWorkflowApi;
  layoutProfiles: LayoutProfilesApi;
  notificationsReview: DialogInputDispatchDeps["notificationsReview"];
  paneTabsApi: PaneTabsApi;
  paneTabsDialogs: DialogInputDispatchDeps["paneTabsEnabled"];
  paneTabsEnabled: boolean;
  runtimeRefs: AppRuntimeRefs;
  screenshots: DialogInputDispatchDeps["screenshots"];
  setKeybindingConfig: Dispatch<SetStateAction<KeybindingConfig>>;
  setSequenceMap: Dispatch<SetStateAction<Map<string, KeyAction>>>;
  sshError: DialogInputDispatchDeps["sshError"];
  tabActions: TabActionsApi;
  uiChromeState: UiChromeState;
}

export function createUpdatedKeybindings(
  previousConfig: KeybindingConfig,
  action: KeyAction,
  rawSequence: string,
): { keybindingConfig: KeybindingConfig; sequenceMap: Map<string, KeyAction> } {
  const keybindingConfig = { ...previousConfig, [action]: rawSequence };
  return {
    keybindingConfig,
    sequenceMap: buildSequenceMap(keybindingConfig),
  };
}

export function getMainMenuRowCount(mainMenuTab: MainMenuTab, paneTabsEnabled: boolean): number {
  if (mainMenuTab === "functions") return getEffectiveFuncRows(paneTabsEnabled);
  if (mainMenuTab === "agents") return AGENT_ROWS;
  if (mainMenuTab === "navigation") return getEffectiveNavRows(paneTabsEnabled);
  return 0;
}

export function useMainMenuDispatch({
  agentActions,
  agentDialogState,
  guardedOptionsWorkflow,
  handleToggleZoomSticky,
  historyWorkflow,
  layoutProfiles,
  notificationsReview,
  paneTabsApi,
  paneTabsDialogs,
  paneTabsEnabled,
  runtimeRefs,
  screenshots,
  setKeybindingConfig,
  setSequenceMap,
  sshError,
  tabActions,
  uiChromeState,
}: UseMainMenuDispatchOptions): void {
  const handleMainMenuAction = (action: KeyAction) => {
    if (action === "toolbar") {
      uiChromeState.setToolbarOpen(!uiChromeState.toolbarOpen);
      return;
    }
    if (action === "sidebar") {
      runtimeRefs.handleSidebarToggleRef.current();
      return;
    }

    uiChromeState.setMainMenuDialogOpen(false);
    switch (action) {
      case "activateMenu":
        runtimeRefs.handleActivateMenuRef.current();
        break;
      case "agentLatch":
        runtimeRefs.handleAgentLatchRef.current?.();
        break;
      case "agentPermApprove":
        runtimeRefs.handleQuickApproveRef.current?.();
        break;
      case "agentPermDeny":
        runtimeRefs.handleQuickDenyRef.current?.();
        break;
      case "agentPermDismiss":
        runtimeRefs.handleDismissRef.current?.();
        break;
      case "agentPermGoto":
      case "agentReviewGoto":
        runtimeRefs.handleGotoAgentRef.current?.();
        break;
      case "agentReviewNext":
        runtimeRefs.handleAgentNextRef.current?.();
        break;
      case "agentReviewPrev":
        runtimeRefs.handleAgentPrevRef.current?.();
        break;
      case "agents":
        agentActions.handleOpenAgentsDialog();
        break;
      case "bufferZoom":
        runtimeRefs.handleBufferZoomRef.current?.();
        break;
      case "conversations":
        historyWorkflow.handleOpenConversationsRef.current();
        break;
      case "favoriteProfile":
        layoutProfiles.handleApplyFavoriteProfile();
        break;
      case "mainMenu":
        break;
      case "mobile":
        runtimeRefs.handleMobileToggleRef.current?.();
        break;
      case "newPaneTab":
        paneTabsApi.handleNewPaneTab();
        break;
      case "nextPaneTab":
        paneTabsApi.handleNextPaneTab();
        break;
      case "nextSession":
        runtimeRefs.handleSessionNextRef.current?.();
        break;
      case "nextWindow":
        tabActions.handleTabNext();
        break;
      case "notifications":
        runtimeRefs.handleNotificationsClickRef.current?.();
        break;
      case "options":
        runtimeRefs.handleOptionsClickRef.current?.({ fromMainMenu: true });
        break;
      case "prevPaneTab":
        paneTabsApi.handlePrevPaneTab();
        break;
      case "prevSession":
        runtimeRefs.handleSessionPrevRef.current?.();
        break;
      case "prevWindow":
        tabActions.handleTabPrev();
        break;
      case "profiles":
        layoutProfiles.handleLayoutProfileClick();
        break;
      case "quickTerminal":
        runtimeRefs.handleOpenQuickTerminalRef.current?.();
        break;
      case "redraw":
        runtimeRefs.showHintRef.current?.("redraw");
        runtimeRefs.handleRedrawRef.current?.();
        break;
      case "review":
        runtimeRefs.handleReviewAgentRef.current?.();
        break;
      case "screenshot":
        runtimeRefs.handleScreenshotRef.current?.();
        break;
      case "sessions":
        runtimeRefs.handleSessionClickRef.current?.();
        break;
      case "sidebarFocus":
        runtimeRefs.handleSidebarFocusRef.current?.();
        break;
      case "toolbarFocus":
        runtimeRefs.handleToolbarFocusRef.current?.();
        break;
    }
  };

  const handleMainMenuBindingChange = (action: KeyAction, rawSequence: string) => {
    setKeybindingConfig((previousConfig) => {
      const { keybindingConfig, sequenceMap } = createUpdatedKeybindings(previousConfig, action, rawSequence);
      setSequenceMap(sequenceMap);
      runtimeRefs.sequenceMapRef.current = sequenceMap;
      saveKeybindings(keybindingConfig);
      return keybindingConfig;
    });
  };

  runtimeRefs.dialogInputRef.current = (data: string) => {
    dispatchDialogInput(data, {
      agentActions,
      agentDialogState,
      historyWorkflow,
      mainMenu: {
        getMainMenuActionForSlot: (row, col) =>
          getMainMenuActionForSlot(uiChromeState.mainMenuTab, paneTabsEnabled, row, col),
        onMainMenuAction: handleMainMenuAction,
        onMainMenuBindingChange: handleMainMenuBindingChange,
        onToggleZoomSticky: handleToggleZoomSticky,
        paneTabsEnabled,
        rowCount: getMainMenuRowCount(uiChromeState.mainMenuTab, paneTabsEnabled),
        writeToPty: (ptyData: string) => runtimeRefs.writeFnRef.current(ptyData),
      },
      notificationsReview,
      optionsWorkflow: guardedOptionsWorkflow,
      paneTabsEnabled: paneTabsDialogs,
      runtimeRefs,
      screenshots,
      sshError,
      uiChromeState,
    });
  };
}

function getMainMenuActionForSlot(
  mainMenuTab: MainMenuTab,
  paneTabsEnabled: boolean,
  row: number,
  col: MainMenuSelectedCol,
): KeyAction | null {
  return getActionForSlot(mainMenuTab, row, col, paneTabsEnabled);
}
