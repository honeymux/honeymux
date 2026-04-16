import type { MutableRefObject, ReactNode } from "react";

import type { CodingAgentPaneActivity } from "../../agents/pane-activity.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { TmuxSession, TmuxWindow } from "../../tmux/types.ts";
import type { UIMode } from "../../util/config.ts";

import { theme } from "../../themes/theme.ts";
import { TabBar } from "../tab-bar.tsx";

interface TmuxPaneNormalModeProps {
  activeIndex: number;
  activePaneId?: null | string;
  activeWindowIdDisplayEnabled?: boolean;
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimCycleCount?: number;
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  agentLatchBindingLabel?: string;
  agentSessions?: AgentSession[];
  agentTermCols?: number;
  agentTermRows?: number;
  agentTerminalNode?: ReactNode;
  agentsDialogOpen?: boolean;
  badgeColor?: string;
  capturedPaneLines?: null | string[];
  children?: ReactNode;
  codingAgentActivity?: CodingAgentPaneActivity;
  configAgentsPreview?: null | string;
  contentNode: ReactNode;
  dropdownInputRef?: MutableRefObject<((data: string) => boolean) | null>;
  expandedMuxotronWidth?: number;
  height: number;
  hotkeyHint: null | string;
  infoCount?: number;
  interactiveAgent?: AgentSession | null;
  isFocused: boolean;
  layoutDropdownOpen?: boolean;
  mainMenuBindingLabel?: string;
  muxotronEnabled?: boolean;
  muxotronExpanded?: boolean;
  muxotronFocusActive?: boolean;
  onApprove?: () => void;
  onCloseWindow?: (index: number) => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  onDragChange: (dragging: boolean) => void;
  onExpandedWidthChange?: (width: number) => void;
  onGoto?: () => void;
  onLayoutProfileClick?: () => void;
  onMoveWindowToSession?: (index: number, targetSession: string) => void;
  onMuxotronClick?: () => void;
  onNewWindow?: () => void;
  onNextAgent?: () => void;
  onNotificationsClick?: () => void;
  onOpenMainMenu?: () => void;
  onOverflowToggle: () => void;
  onPrevAgent?: () => void;
  onReviewLatchToggle?: () => void;
  onSessionClick?: () => void;
  onSidebarToggle?: () => void;
  onTabClick: (index: number) => void;
  onTabRename?: (index: number, newName: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTextInputActive?: (active: boolean) => void;
  onToolbarToggle?: () => void;
  ptyDragging?: boolean;
  reviewLatched?: boolean;
  selectedSession?: import("../../agents/types.ts").AgentSession | null;
  sessionName: string;
  sessions?: TmuxSession[];
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  tabDragEndRef?: MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef?: MutableRefObject<((x: number) => void) | null>;
  tabDragging: boolean;
  tabRightClickRef?: MutableRefObject<((x: number) => void) | null>;
  termHeight?: number;
  textInputEscapeHandlerRef?: MutableRefObject<(() => void) | null>;
  tmuxKeyBindingHint?: null | string;
  toolbarOpen?: boolean;
  uiMode?: UIMode;
  warningCount?: number;
  width: number;
  windows: TmuxWindow[];
}

export function TmuxPaneNormalMode({
  activeIndex,
  activePaneId,
  activeWindowIdDisplayEnabled,
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
  badgeColor,
  capturedPaneLines,
  children,
  codingAgentActivity,
  configAgentsPreview,
  contentNode,
  dropdownInputRef,
  expandedMuxotronWidth,
  height,
  hotkeyHint,
  infoCount,
  interactiveAgent,
  isFocused,
  layoutDropdownOpen,
  mainMenuBindingLabel,
  muxotronEnabled,
  muxotronExpanded,
  muxotronFocusActive,
  onApprove,
  onCloseWindow,
  onDeny,
  onDismiss,
  onDragChange,
  onExpandedWidthChange,
  onGoto,
  onLayoutProfileClick,
  onMoveWindowToSession,
  onMuxotronClick,
  onNewWindow,
  onNextAgent,
  onNotificationsClick,
  onOpenMainMenu,
  onOverflowToggle,
  onPrevAgent,
  onReviewLatchToggle,
  onSessionClick,
  onSidebarToggle,
  onTabClick,
  onTabRename,
  onTabReorder,
  onTextInputActive,
  onToolbarToggle,
  ptyDragging,
  reviewLatched,
  selectedSession,
  sessionName,
  sessions,
  sidebarOpen,
  sidebarWidth,
  tabDragEndRef,
  tabDragMoveRef,
  tabDragging,
  tabRightClickRef,
  termHeight,
  textInputEscapeHandlerRef,
  tmuxKeyBindingHint,
  toolbarOpen,
  uiMode,
  warningCount,
  width,
  windows,
}: TmuxPaneNormalModeProps) {
  return (
    <box flexDirection="column" height={height} selectable={tabDragging ? false : undefined} width={width}>
      <TabBar
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
        badgeColor={badgeColor}
        capturedPaneLines={capturedPaneLines}
        codingAgentActivity={codingAgentActivity}
        color={isFocused ? undefined : theme.border}
        configAgentsPreview={configAgentsPreview}
        dropdownInputRef={dropdownInputRef}
        expandedMuxotronWidth={expandedMuxotronWidth}
        hint={hotkeyHint}
        infoCount={infoCount}
        interactiveAgent={interactiveAgent}
        layoutDropdownOpen={layoutDropdownOpen}
        mainMenuBindingLabel={mainMenuBindingLabel}
        muxotronEnabled={muxotronEnabled}
        muxotronExpanded={muxotronExpanded}
        muxotronFocusActive={muxotronFocusActive}
        onApprove={onApprove}
        onCloseWindow={onCloseWindow}
        onDeny={onDeny}
        onDismiss={onDismiss}
        onDragChange={onDragChange}
        onExpandedWidthChange={onExpandedWidthChange}
        onGoto={onGoto}
        onLayoutProfileClick={onLayoutProfileClick}
        onMoveWindowToSession={onMoveWindowToSession}
        onMuxotronClick={onMuxotronClick}
        onNewWindow={onNewWindow}
        onNextAgent={onNextAgent}
        onNotificationsClick={onNotificationsClick}
        onOpenMainMenu={onOpenMainMenu}
        onOverflowOpen={onOverflowToggle}
        onPrevAgent={onPrevAgent}
        onReviewLatchToggle={onReviewLatchToggle}
        onSessionClick={onSessionClick}
        onSidebarToggle={onSidebarToggle}
        onTabClick={onTabClick}
        onTabRename={onTabRename}
        onTabReorder={onTabReorder}
        onTextInputActive={onTextInputActive}
        onToolbarToggle={onToolbarToggle}
        ptyDragging={ptyDragging}
        reviewLatched={reviewLatched}
        selectedSession={selectedSession}
        sessionName={sessionName}
        sessions={sessions}
        sidebarOpen={sidebarOpen}
        tabDragEndRef={tabDragEndRef}
        tabDragMoveRef={tabDragMoveRef}
        tabRightClickRef={tabRightClickRef}
        termHeight={termHeight}
        textInputEscapeHandlerRef={textInputEscapeHandlerRef}
        tmuxKeyBindingHint={tmuxKeyBindingHint}
        toolbarOpen={toolbarOpen}
        toolbarToggleChar="⚒"
        uiMode={uiMode}
        warningCount={warningCount}
        width={width}
        windows={windows}
      />
      <box
        flexDirection="column"
        flexGrow={1}
        paddingLeft={sidebarOpen && sidebarWidth ? sidebarWidth + 1 : 0}
        width="100%"
      >
        {contentNode}
      </box>
      {children}
    </box>
  );
}
