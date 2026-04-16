import { memo, useState } from "react";

import type { TmuxPaneProps } from "./tmux-pane/types.ts";

import { rgbToHex, terminalBgRgb, theme } from "../themes/theme.ts";
import { AgentsDialog } from "./agents-dialog.tsx";
import { TerminalView } from "./terminal-view.tsx";
import { computeReservedRightChromeMask } from "./tmux-pane/chrome-mask.ts";
import { TmuxPaneMinimalMode } from "./tmux-pane/minimal-mode.tsx";
import { TmuxPaneNormalMode } from "./tmux-pane/normal-mode.tsx";
import { TmuxPaneOverlayLayer } from "./tmux-pane/overlay-layer.tsx";
import { useTmuxPaneViewModel } from "./tmux-pane/use-tmux-pane-view-model.ts";

export type {
  TmuxPaneAgentProps,
  TmuxPaneCoreProps,
  TmuxPaneHistoryProps,
  TmuxPaneLayoutProps,
  TmuxPaneProps,
  TmuxPaneSessionDropdownProps,
  TmuxPaneSharedProps,
  TmuxPaneToolbarProps,
} from "./tmux-pane/types.ts";

export const TmuxPane = memo(function TmuxPane({
  agent,
  core,
  layout,
  rootOverlayNode,
  sessionDropdown,
  shared,
  toolbar,
}: TmuxPaneProps) {
  const {
    activeIndex,
    connected,
    height,
    onMoveWindowToSession,
    onSessionClick,
    onTabRename,
    onTabReorder,
    onTerminalReady,
    sessionName,
    tabDragEndRef,
    tabDragMoveRef,
    width,
    windows,
  } = core;

  const { currentSession, onTextInputActive, sessions } = sessionDropdown;

  const {
    mainMenuBindingLabel,
    onOpenMainMenu,
    onSidebarToggle,
    onToolbarToggle,
    sidebarOpen,
    sidebarWidth,
    toolbarOpen,
  } = toolbar;

  const { layoutDropdownOpen, onLayoutProfileClick } = layout;

  const {
    activePaneId,
    agentAlertAnimConfusables,
    agentAlertAnimCycleCount,
    agentAlertAnimDelay,
    agentAlertAnimEqualizer,
    agentAlertAnimGlow,
    agentAlertAnimScribble,
    agentLatchBindingLabel,
    agentSessions,
    agentTermCols,
    agentTermRows,
    agentTerminalNode,
    agentsDialogOpen,
    capturedPaneLines,
    codingAgentActivity,
    configAgentsPreview,
    infoCount,
    interactiveAgent,
    muxotronEnabled,
    muxotronExpanded,
    muxotronFocusActive,
    onApprove,
    onDeny,
    onDismiss,
    onGoto,
    onMuxotronClick,
    onNextAgent,
    onNotificationsClick,
    onPrevAgent,
    onReviewLatchToggle,
    reviewLatched,
    selectedSession,
    termHeight,
    warningCount,
  } = agent;

  const { activeWindowIdDisplayEnabled, tabRightClickRef, textInputEscapeHandlerRef, uiMode } = shared;

  // Resolve current session's color for the badge
  const currentSessionColor = sessions?.find((s) => s.name === (currentSession ?? sessionName))?.color;

  // Shared expanded muxotronEnabled width: set by Muxotron, used by both TabBar
  // and the view model's overflow computation for consistent results.
  const [expandedMuxotronWidth, setExpandedMuxotronWidth] = useState(0);

  const viewModel = useTmuxPaneViewModel({
    agent,
    core,
    expandedMuxotronWidth,
    shared,
    toolbar,
  });

  const terminalNode = viewModel.terminalMetrics.tooSmall ? (
    <text content=" Window too small" fg={theme.textSecondary} />
  ) : connected ? (
    <TerminalView
      cols={viewModel.terminalMetrics.cols}
      onReady={onTerminalReady}
      rows={viewModel.terminalMetrics.rows}
    />
  ) : (
    <text content="" />
  );

  const contentNode = terminalNode;

  const agentsDialogNode = viewModel.agentsDialogProps ? <AgentsDialog {...viewModel.agentsDialogProps} /> : null;

  const overlayLayer = (
    <TmuxPaneOverlayLayer
      agent={agent}
      core={core}
      layout={layout}
      rootOverlayNode={rootOverlayNode}
      runtime={{
        agentsDialogNode,
        onBufferZoom: toolbar.onBufferZoom,
        overflow: {
          hasOverflow: viewModel.hasOverflow,
          itemWidth: viewModel.overflowItemWidth,
          onClose: viewModel.handleOverflowClose,
          onSelect: viewModel.handleOverflowSelect,
          open: viewModel.overflowOpen,
          startX: viewModel.overflowStartX,
          visibleCount: viewModel.visibleCount,
        },
      }}
      sessionDropdown={sessionDropdown}
      shared={shared}
      toolbar={toolbar}
    />
  );

  const reservedRightChromeMask = computeReservedRightChromeMask({
    sidebarOpen,
    sidebarWidth,
    terminalCols: viewModel.terminalMetrics.cols,
    terminalRows: viewModel.terminalMetrics.rows,
    uiMode: viewModel.uiMode,
    width,
  });
  const terminalBg = rgbToHex(terminalBgRgb);

  const chromeMaskNode = reservedRightChromeMask ? (
    <box
      backgroundColor={terminalBg}
      height={reservedRightChromeMask.height}
      left={reservedRightChromeMask.left}
      position="absolute"
      top={reservedRightChromeMask.top}
      width={reservedRightChromeMask.width}
      zIndex={6}
    />
  ) : null;

  if (uiMode === "raw") {
    const rawPadLeft = sidebarOpen && sidebarWidth ? sidebarWidth + 1 : 0;
    return (
      <box height={height} width={width}>
        <box flexGrow={1} paddingLeft={rawPadLeft}>
          {terminalNode}
        </box>
        {chromeMaskNode}
        {rootOverlayNode}
        {agentsDialogNode}
        {overlayLayer}
      </box>
    );
  }

  if (uiMode === "marquee-top" || uiMode === "marquee-bottom") {
    return (
      <TmuxPaneMinimalMode
        activePaneId={activePaneId}
        agentAlertAnimConfusables={agentAlertAnimConfusables}
        agentAlertAnimGlow={agentAlertAnimGlow}
        agentSessions={agentSessions}
        agentsDialogNode={agentsDialogNode}
        agentsDialogOpen={agentsDialogOpen}
        codingAgentActivity={codingAgentActivity}
        configAgentsPreview={configAgentsPreview}
        height={height}
        infoCount={infoCount}
        onMuxotronClick={onMuxotronClick}
        onNotificationsClick={onNotificationsClick}
        overlayLayer={
          <>
            {chromeMaskNode}
            {overlayLayer}
          </>
        }
        rootOverlayNode={rootOverlayNode}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        terminalNode={terminalNode}
        uiMode={uiMode}
        warningCount={warningCount}
        width={width}
      />
    );
  }

  return (
    <TmuxPaneNormalMode
      activeIndex={activeIndex}
      activePaneId={activePaneId}
      activeWindowIdDisplayEnabled={activeWindowIdDisplayEnabled}
      agentAlertAnimConfusables={agentAlertAnimConfusables}
      agentAlertAnimCycleCount={agentAlertAnimCycleCount}
      agentAlertAnimDelay={agentAlertAnimDelay}
      agentAlertAnimEqualizer={agentAlertAnimEqualizer}
      agentAlertAnimGlow={agentAlertAnimGlow}
      agentAlertAnimScribble={agentAlertAnimScribble}
      agentLatchBindingLabel={agentLatchBindingLabel}
      agentSessions={agentSessions}
      agentTermCols={agentTermCols}
      agentTermRows={agentTermRows}
      agentTerminalNode={agentTerminalNode}
      agentsDialogOpen={agentsDialogOpen}
      badgeColor={currentSessionColor}
      capturedPaneLines={capturedPaneLines}
      codingAgentActivity={codingAgentActivity}
      configAgentsPreview={configAgentsPreview}
      contentNode={contentNode}
      dropdownInputRef={shared.dropdownInputRef}
      expandedMuxotronWidth={expandedMuxotronWidth}
      height={height}
      hotkeyHint={viewModel.hotkeyHint}
      infoCount={infoCount}
      interactiveAgent={interactiveAgent}
      isFocused={viewModel.isFocused}
      layoutDropdownOpen={layoutDropdownOpen}
      mainMenuBindingLabel={mainMenuBindingLabel}
      muxotronEnabled={muxotronEnabled}
      muxotronExpanded={muxotronExpanded}
      muxotronFocusActive={muxotronFocusActive}
      onApprove={onApprove}
      onCloseWindow={viewModel.handleCloseWindowWithHint}
      onDeny={onDeny}
      onDismiss={onDismiss}
      onDragChange={viewModel.handleDragChange}
      onExpandedWidthChange={setExpandedMuxotronWidth}
      onGoto={onGoto}
      onLayoutProfileClick={onLayoutProfileClick}
      onMoveWindowToSession={onMoveWindowToSession}
      onMuxotronClick={onMuxotronClick}
      onNewWindow={viewModel.handleNewWindowWithHint}
      onNextAgent={onNextAgent}
      onNotificationsClick={onNotificationsClick}
      onOpenMainMenu={onOpenMainMenu}
      onOverflowToggle={viewModel.toggleOverflowOpen}
      onPrevAgent={onPrevAgent}
      onReviewLatchToggle={onReviewLatchToggle}
      onSessionClick={onSessionClick}
      onSidebarToggle={onSidebarToggle}
      onTabClick={viewModel.handleTabClickWithHint}
      onTabRename={onTabRename}
      onTabReorder={onTabReorder}
      onTextInputActive={onTextInputActive}
      onToolbarToggle={onToolbarToggle}
      ptyDragging={viewModel.ptyDragging}
      reviewLatched={reviewLatched}
      selectedSession={selectedSession}
      sessionName={sessionName}
      sessions={sessions}
      sidebarOpen={sidebarOpen}
      sidebarWidth={sidebarWidth}
      tabDragEndRef={tabDragEndRef}
      tabDragMoveRef={tabDragMoveRef}
      tabDragging={viewModel.tabDragging}
      tabRightClickRef={tabRightClickRef}
      termHeight={termHeight}
      textInputEscapeHandlerRef={textInputEscapeHandlerRef}
      tmuxKeyBindingHint={viewModel.tmuxKeyBindingHint}
      toolbarOpen={toolbarOpen}
      uiMode={uiMode}
      warningCount={warningCount}
      width={width}
      windows={windows}
    >
      {chromeMaskNode}
      {overlayLayer}
    </TmuxPaneNormalMode>
  );
});

TmuxPane.displayName = "TmuxPane";
