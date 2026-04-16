import type { MouseEvent } from "@opentui/core";

import type { AgentActionsApi } from "../app/hooks/use-agent-actions.ts";
import type { AppRuntimeRefs } from "../app/hooks/use-app-runtime-refs.ts";
import type { AgentDialogState, TmuxSessionState, UiChromeState } from "../app/hooks/use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "../app/hooks/use-history-workflow.ts";
import type { OptionsWorkflowApi } from "../app/hooks/use-options-workflow.ts";
import type { PaneTabsApi } from "../app/pane-tabs/use-pane-tabs.ts";
import type { UIMode } from "../util/config.ts";
import type { KeyAction } from "../util/keybindings.ts";
import type { KeybindingConfig } from "../util/keybindings.ts";

import { formatBinding } from "../util/keybindings.ts";
import { AgentInstallDialog } from "./agent-install-dialog.tsx";
import { AgentsZoomOverlay } from "./agents-zoom-overlay.tsx";
import { ConversationsDialog } from "./conversations-dialog.tsx";
import { HistoryConsentDialog } from "./history-consent-dialog.tsx";
import { InfoItemDialog, infoItemDialogHeight } from "./info-item-dialog.tsx";
import { MainMenuDialog } from "./main-menu-dialog.tsx";
import { NotificationsReviewFrame } from "./notifications-review-frame.tsx";
import { OptionsDialog } from "./options-dialog.tsx";
import { QuickTerminalOverlay } from "./quick-terminal-overlay.tsx";
import { SshErrorDialog, wrapText } from "./ssh-error-dialog.tsx";
import { TooNarrowOverlay } from "./too-narrow-overlay.tsx";
import { TreeZoomOverlay } from "./tree-zoom-overlay.tsx";

interface AppOverlaysNotificationsReview {
  index: number;
  onClose: () => void;
  onDismissInfo: (id: string) => void;
  open: boolean;
  queue: { id?: string; kind: string; message?: string | string[] }[];
  total: number;
}

interface AppOverlaysProps {
  agentActions: AgentActionsApi;
  agentDialogState: AgentDialogState;
  hasFavoriteProfile: boolean;
  height: number;
  historyWorkflow: HistoryWorkflowApi;
  keybindingConfig: KeybindingConfig;
  notificationsReview: AppOverlaysNotificationsReview;
  optionsWorkflow: OptionsWorkflowApi;
  paneTabsApi: PaneTabsApi;
  refs: AppRuntimeRefs;
  sshError: AppOverlaysSshError;
  tmuxSessionState: TmuxSessionState;
  tooNarrow: boolean;
  tooShort: boolean;
  uiChromeState: UiChromeState;
  width: number;
  zoomState: AppOverlaysZoomState;
}

interface AppOverlaysSshError {
  error: null | string;
  errorAt: number;
  /** Close dialog and permanently remove this SSH warning. */
  onDismiss: () => void;
  server: null | string;
}

interface AppOverlaysZoomState {
  action: KeyAction | null;
  active: boolean;
  agentsStickyKey: boolean;
  effectiveUIMode: UIMode;
  onToggleSticky: (action: "zoomAgentsView" | "zoomServerView") => void;
  onTreeNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  panesStickyKey: boolean;
}

export function AppOverlays({
  agentActions,
  agentDialogState,
  hasFavoriteProfile,
  height,
  historyWorkflow,
  keybindingConfig,
  notificationsReview,
  optionsWorkflow,
  paneTabsApi,
  refs,
  sshError,
  tmuxSessionState,
  tooNarrow,
  tooShort,
  uiChromeState,
  width,
  zoomState,
}: AppOverlaysProps) {
  const {
    clientRef,
    dialogInputRef,
    dialogMenuToggleRef,
    dropdownInputRef,
    qtResizeDragEndRef,
    qtResizeDragMoveRef,
    qtResizeDraggingRef,
    qtResizeSizeRef,
    registryRef,
    textInputActive,
    textInputEscapeHandlerRef,
    writeFnRef,
  } = refs;
  const {
    handleAgentsDialogSelect: onAgentSessionSelect,
    handleClaudeInstall: onClaudeInstall,
    handleClaudeNever: onClaudeNever,
    handleClaudeSkip: onClaudeSkip,
    handleCodexInstall: onCodexInstall,
    handleCodexNever: onCodexNever,
    handleCodexSkip: onCodexSkip,
    handleConversationsSelect: onConversationsSelect,
    handleGeminiInstall: onGeminiInstall,
    handleGeminiNever: onGeminiNever,
    handleGeminiSkip: onGeminiSkip,
    handleOpenCodeInstall: onOpenCodeInstall,
    handleOpenCodeNever: onOpenCodeNever,
    handleOpenCodeSkip: onOpenCodeSkip,
    handleQuickTerminalClose: onQuickTerminalClose,
    handleQuickTerminalPinToWindow: onQuickTerminalPinToWindow,
  } = agentActions;
  const {
    agentSessions,
    claudeDialogPending,
    codexDialogPending,
    dialogSelected,
    geminiDialogPending,
    openCodeDialogPending,
    quickTerminalMenuCloseRef,
    quickTerminalOpen,
  } = agentDialogState;
  const {
    closeConversationsDialog: onConversationsClose,
    closeConversationsMenu,
    consentDialogSelected,
    conversationsCursor,
    conversationsDialogOpen,
    conversationsMenuIndex,
    conversationsMenuOpen,
    conversationsPageOffset,
    conversationsQuery,
    conversationsResultIndex,
    conversationsResults,
    conversationsSearchCaseSensitive,
    conversationsSearchRegex,
    handleConsentAllow: onConsentAllow,
    handleConsentDeny: onConsentDeny,
    historyConsentDialogOpen,
    setConversationsResultIndex,
    toggleConversationsMenu,
    toggleConversationsSearchCaseSensitive,
    toggleConversationsSearchRegex,
  } = historyWorkflow;
  const {
    config,
    configPaneTabsEnabled,
    configQuickTerminalSize,
    optionsDialogOpen,
    setConfigQuickTerminalSize: onSetConfigQuickTerminalSize,
  } = optionsWorkflow;
  const {
    mainMenuCaptureError,
    mainMenuCapturing,
    mainMenuDialogOpen,
    mainMenuSelectedCol,
    mainMenuSelectedRow,
    mainMenuTab,
    setMainMenuDialogOpen,
    setMainMenuTab: onMainMenuTabChange,
    toolbarOpen,
  } = uiChromeState;
  const { currentSessionName } = tmuxSessionState;
  const { handleSwitchPaneTab: onTreeSwitchPaneTab, paneTabGroups } = paneTabsApi;
  const {
    action: zoomAction,
    active: muxotronFocusActive,
    agentsStickyKey: zoomAgentsViewStickyKey,
    effectiveUIMode,
    onToggleSticky: onToggleZoomSticky,
    onTreeNavigate,
    panesStickyKey: zoomServerViewStickyKey,
  } = zoomState;
  const {
    index: notificationsReviewIndex,
    onClose: onNotificationsReviewClose,
    onDismissInfo,
    open: notificationsReviewOpen,
    queue: notificationsReviewQueue,
    total: notificationsReviewTotal,
  } = notificationsReview;
  const onMainMenuClose = () => setMainMenuDialogOpen(false);
  const onConversationsMenuSelect = (index: number) => {
    if (index === 0) {
      toggleConversationsSearchCaseSensitive();
      return;
    }
    if (index === 1) {
      toggleConversationsSearchRegex();
    }
  };
  const zoomTopOffset = effectiveUIMode === "raw" || effectiveUIMode === "marquee-bottom" ? 0 : 3;
  return (
    <>
      {quickTerminalOpen && (
        <QuickTerminalOverlay
          clientRef={clientRef}
          closeKeyLabel={
            keybindingConfig.quickTerminal ? formatBinding(keybindingConfig.quickTerminal).toLowerCase() : "ctrl+g"
          }
          height={height}
          menuCloseRef={quickTerminalMenuCloseRef}
          menuToggleRef={dialogMenuToggleRef}
          onClose={onQuickTerminalClose}
          onPinToWindow={onQuickTerminalPinToWindow}
          onSizeChange={onSetConfigQuickTerminalSize}
          policyOsc52Passthrough={config.policyLocalOsc52Passthrough}
          policyOtherOscPassthrough={config.policyLocalOtherOscPassthrough}
          qtResizeDragEndRef={qtResizeDragEndRef}
          qtResizeDragMoveRef={qtResizeDragMoveRef}
          qtResizeDraggingRef={qtResizeDraggingRef}
          qtResizeSizeRef={qtResizeSizeRef}
          quickTerminalSize={configQuickTerminalSize}
          width={width}
          writeFnRef={writeFnRef}
        />
      )}
      {(() => {
        // Build the currently-visible notification dialog
        let itemDialog = null;
        let innerHeight = 12;
        let isInfoItem = false;

        // Check if current review item is an info
        const currentQueueItem = notificationsReviewOpen ? notificationsReviewQueue[notificationsReviewIndex] : null;
        if (currentQueueItem?.kind === "info" && notificationsReviewOpen) {
          isInfoItem = true;
          const msg = currentQueueItem.message ?? "";
          innerHeight = infoItemDialogHeight(msg);
          itemDialog = (
            <InfoItemDialog
              message={msg}
              noBackdrop={true}
              onDismiss={() => {
                if (currentQueueItem.id) onDismissInfo(currentQueueItem.id);
              }}
            />
          );
        } else if (sshError.server !== null && sshError.error !== null) {
          itemDialog = (
            <SshErrorDialog
              error={sshError.error}
              errorAt={sshError.errorAt}
              noBackdrop={notificationsReviewOpen}
              onDismiss={sshError.onDismiss}
              serverName={sshError.server}
            />
          );
          // Match the SSH dialog's boxHeight (8 contentRows + errorLines + 2 border)
          innerHeight = 10 + wrapText(sshError.error, 54).length;
        } else if (claudeDialogPending) {
          itemDialog = (
            <AgentInstallDialog
              agentName="Claude Code"
              docsUrl="https://code.claude.com/docs/en/hooks"
              noBackdrop={notificationsReviewOpen}
              onInstall={onClaudeInstall}
              onNever={onClaudeNever}
              onSkip={onClaudeSkip}
              selected={dialogSelected}
            />
          );
        } else if (openCodeDialogPending) {
          itemDialog = (
            <AgentInstallDialog
              agentName="OpenCode"
              docsUrl="https://opencode.ai/docs/plugins/"
              installLabel="plugin"
              noBackdrop={notificationsReviewOpen}
              onInstall={onOpenCodeInstall}
              onNever={onOpenCodeNever}
              onSkip={onOpenCodeSkip}
              selected={dialogSelected}
            />
          );
        } else if (geminiDialogPending) {
          itemDialog = (
            <AgentInstallDialog
              agentName="Gemini CLI"
              docsUrl="https://geminicli.com/docs/hooks/"
              noBackdrop={notificationsReviewOpen}
              onInstall={onGeminiInstall}
              onNever={onGeminiNever}
              onSkip={onGeminiSkip}
              selected={dialogSelected}
            />
          );
        } else if (codexDialogPending) {
          itemDialog = (
            <AgentInstallDialog
              agentName="Codex CLI"
              docsUrl="https://developers.openai.com/codex/hooks"
              noBackdrop={notificationsReviewOpen}
              onInstall={onCodexInstall}
              onNever={onCodexNever}
              onSkip={onCodexSkip}
              selected={dialogSelected}
            />
          );
        }

        if (!itemDialog) return null;

        // Wrap in review frame when in notifications review mode
        if (notificationsReviewOpen) {
          return (
            <>
              {/* Review backdrop */}
              <box
                height="100%"
                left={0}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onNotificationsReviewClose();
                }}
                position="absolute"
                top={0}
                width="100%"
                zIndex={18}
              />
              <NotificationsReviewFrame
                currentIndex={notificationsReviewIndex}
                innerHeight={innerHeight}
                innerWidth={58}
                isInfo={isInfoItem}
                totalCount={notificationsReviewTotal}
              >
                {itemDialog}
              </NotificationsReviewFrame>
            </>
          );
        }

        return itemDialog;
      })()}
      {optionsDialogOpen && (
        <OptionsDialog
          chrome={{
            dropdownInputRef,
            termHeight: height,
            termWidth: width,
            textInputActive,
            textInputEscapeHandlerRef,
            tmuxPrefixLabel: tmuxSessionState.keyBindings?.prefix ?? null,
          }}
          workflow={optionsWorkflow}
        />
      )}
      {mainMenuDialogOpen && (
        <MainMenuDialog
          captureError={mainMenuCaptureError}
          capturing={mainMenuCapturing}
          hasFavoriteProfile={hasFavoriteProfile}
          keybindings={keybindingConfig}
          mainMenuTab={mainMenuTab}
          onClose={onMainMenuClose}
          onTabChange={onMainMenuTabChange}
          onToggleZoomSticky={onToggleZoomSticky}
          paneTabsEnabled={configPaneTabsEnabled}
          selectedCol={mainMenuSelectedCol}
          selectedRow={mainMenuSelectedRow}
          termHeight={height}
          termWidth={width}
          toolbarOpen={toolbarOpen}
          zoomAgentsViewStickyKey={zoomAgentsViewStickyKey}
          zoomServerViewStickyKey={zoomServerViewStickyKey}
        />
      )}
      {historyConsentDialogOpen && (
        <HistoryConsentDialog onAllow={onConsentAllow} onDeny={onConsentDeny} selected={consentDialogSelected} />
      )}
      {conversationsDialogOpen && (
        <ConversationsDialog
          caseSensitiveSearch={conversationsSearchCaseSensitive}
          closeMenu={closeConversationsMenu}
          cursor={conversationsCursor}
          focusedIndex={conversationsResultIndex}
          hasMoreResults={conversationsResults.hasMore}
          menuFocusedIndex={conversationsMenuIndex}
          menuOpen={conversationsMenuOpen}
          menuToggleRef={dialogMenuToggleRef}
          onClose={onConversationsClose}
          onFocusIndex={setConversationsResultIndex}
          onMenuItemSelect={onConversationsMenuSelect}
          onNavigateDown={() => dialogInputRef.current("\x1b[B")}
          onNavigateUp={() => dialogInputRef.current("\x1b[A")}
          onSelect={onConversationsSelect}
          onToggleMenu={toggleConversationsMenu}
          query={conversationsQuery}
          regexSearch={conversationsSearchRegex}
          resultOffset={conversationsPageOffset}
          results={conversationsResults.results}
          searchError={conversationsResults.error}
          termHeight={height}
          termWidth={width}
          totalResults={conversationsResults.total}
        />
      )}
      {tooNarrow && <TooNarrowOverlay height={height} reason={tooShort ? "short" : "narrow"} width={width} />}
      {muxotronFocusActive && zoomAction === "zoomServerView" && (
        <TreeZoomOverlay
          clientRef={clientRef}
          currentSessionName={currentSessionName}
          height={height}
          onNavigate={onTreeNavigate}
          onSwitchPaneTab={onTreeSwitchPaneTab}
          paneTabGroups={paneTabGroups}
          topOffset={zoomTopOffset}
          width={width}
        />
      )}
      {muxotronFocusActive && zoomAction === "zoomAgentsView" && (
        <AgentsZoomOverlay
          agentSessions={agentSessions}
          height={height}
          onSessionSelect={onAgentSessionSelect}
          registryRef={registryRef}
          topOffset={zoomTopOffset}
          width={width}
        />
      )}
    </>
  );
}
