import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import type { CodingAgentPaneActivity, CodingAgentPaneOutputSample } from "../../agents/pane-activity.ts";
import type { AgentProviderRegistry } from "../../agents/provider.ts";
import type { AgentSession, HookSnifferEntry } from "../../agents/types.ts";
import type { StatusBarInfo } from "../../app/hooks/use-app-state-groups.ts";
import type { DimPaneRect } from "../../app/hooks/use-dim-inactive-panes.ts";
import type { PaneTabGroup } from "../../app/pane-tabs/types.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { LayoutProfile, TmuxKeyBindings, TmuxSession, TmuxWindow } from "../../tmux/types.ts";
import type { UIMode } from "../../util/config.ts";

export interface TmuxPaneAgentProps {
  /** Pane ID of the currently focused pane — used to suppress muxotronEnabled for agents visible in-pane. */
  activePaneId?: null | string;
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimCycleCount?: number;
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  /** Human-readable label for the agentLatch binding (e.g. "right shift"). */
  agentLatchBindingLabel?: string;
  /** Ref installed by the agents dialog for dialog-local next navigation. */
  agentNavNextRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref installed by the agents dialog for dialog-local prev navigation. */
  agentNavPrevRef?: React.MutableRefObject<(() => void) | null>;
  agentSessions?: AgentSession[];
  agentSessionsForDialog?: AgentSession[];
  /**
   * Target column count for the interactive focused muxotron PTY. Must
   * match the honeymux-attached tmux client width so the grouped overlay
   * session doesn't trigger a dimension mismatch (tmux dot-grid).
   */
  agentTermCols?: number;
  /** Target row count for the interactive focused muxotron PTY. */
  agentTermRows?: number;
  /** Pre-built interactive PTY terminal node injected into the focused muxotron content area. */
  agentTerminalNode?: import("react").ReactNode;
  agentsDialogOpen?: boolean;
  /** Captured pane content lines for non-unanswered agents (ANSI-stripped). */
  capturedPaneLines?: null | string[];
  codingAgentActivity?: CodingAgentPaneActivity;
  /** Ref snapshot of per-pane activity timestamps, read by the agent tree spinner at paint time. */
  codingAgentLastOutputByPaneRef?: React.RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
  configAgentsPreview?: null | string;

  hookSnifferEvents?: HookSnifferEntry[];
  infoCount?: number;
  /** When non-null, the focused muxotron is bridging this agent's PTY interactively. */
  interactiveAgent?: AgentSession | null;
  muxotronEnabled?: boolean;

  /** True when muxotronEnabled is expanded to full width in adaptive mode. */
  muxotronExpanded?: boolean;
  muxotronFocusActive?: boolean;
  onAgentsDialogClose?: () => void;
  onAgentsDialogSelect?: (session: AgentSession) => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  onGoToPane?: (session: AgentSession) => void;
  onGoto?: () => void;
  onMuxotronClick?: () => void;
  /** Navigate to next agent in sidebar tree (tree-selection mode). */
  onNextAgent?: () => void;
  onNotificationsClick?: () => void;
  onPermissionRespond?: (sessionId: string, toolUseId: string, decision: "allow" | "deny") => void;
  /** Navigate to previous agent in sidebar tree (tree-selection mode). */
  onPrevAgent?: () => void;
  /** Toggle the review latch (preview ↔ interactive) for the selected agent. */
  onReviewLatchToggle?: () => void;
  /** Called when an agent is selected from the tree view (sidebar or dialog). */
  onTreeAgentSelect?: (session: AgentSession) => void;
  registryRef?: React.MutableRefObject<AgentProviderRegistry | null>;
  /** True while the focused muxotron is review-latched to the selected agent's PTY. */
  reviewLatched?: boolean;
  /** Agent selected from the tree view — forces muxotronEnabled expansion for this session. */
  selectedSession?: AgentSession | null;
  termHeight?: number;
  warningCount?: number;
}

export interface TmuxPaneCoreProps {
  activeIndex: number;
  connected: boolean;
  focused?: boolean;
  height: number;
  onCloseWindow?: (index: number) => void;
  onMoveWindowToSession?: (index: number, targetSession: string) => void;
  onNewWindow?: () => void;
  onSessionClick?: () => void;
  onTabClick: (index: number) => void;
  onTabDragChange?: (dragging: boolean) => void;
  onTabRename?: (index: number, newName: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTerminalReady: (terminal: GhosttyTerminalRenderable) => void;
  sessionName: string;
  tabDragEndRef?: React.MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef?: React.MutableRefObject<((x: number) => void) | null>;
  width: number;
  windows: TmuxWindow[];
}

export interface TmuxPaneHistoryProps {
  consentPending?: boolean;
  historyReady?: boolean;
  onConversations?: () => void;
}

export interface TmuxPaneLayoutProps {
  layoutDropdownOpen?: boolean;
  layoutProfiles?: LayoutProfile[];
  onLayoutDelete?: (name: string) => void;
  onLayoutDropdownClose?: () => void;
  onLayoutProfileClick?: () => void;
  onLayoutRename?: (oldName: string, newName: string) => void;
  onLayoutSave?: (name: string) => Promise<LayoutProfile | undefined>;
  onLayoutSaveCommands?: (profileName: string, commands: string[][]) => void;
  onLayoutSelect?: (profile: LayoutProfile) => void;
  onLayoutSetFavorite?: (name: string) => void;
}

export interface TmuxPaneProps {
  agent: TmuxPaneAgentProps;
  core: TmuxPaneCoreProps;
  history: TmuxPaneHistoryProps;
  layout: TmuxPaneLayoutProps;
  rootOverlayNode?: React.ReactNode;
  sessionDropdown: TmuxPaneSessionDropdownProps;
  shared: TmuxPaneSharedProps;
  toolbar: TmuxPaneToolbarProps;
}

export interface TmuxPaneSessionDropdownProps {
  configOpen?: boolean;
  currentSession?: string;
  dropdownOpen?: boolean;
  onCreateSession?: (name: string) => void;
  onDeleteSession?: (name: string) => void;
  onDropdownClose?: () => void;
  onGetSessionInfo?: (name: string) => Promise<{ paneTabsEnabled: number; panes: number; windows: number }>;
  onRenameSession?: (oldName: string, newName: string) => void;
  onSessionSelect?: (name: string) => void;
  onSetSessionColor?: (sessionName: string, color: null | string) => void;
  onTextInputActive?: (active: boolean) => void;
  sessions?: TmuxSession[];
}

export interface TmuxPaneSharedProps {
  activeWindowIdDisplayEnabled?: boolean;
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  keyBindings?: TmuxKeyBindings | null;
  overflowOpenRef?: React.MutableRefObject<boolean>;
  ptyDragActiveRef?: React.MutableRefObject<((active: boolean) => void) | null>;
  showHintRef?: React.MutableRefObject<((text: string) => void) | null>;
  statusBarInfo?: StatusBarInfo | null;
  tabRightClickRef?: React.MutableRefObject<((x: number) => void) | null>;
  textInputEscapeHandlerRef?: React.MutableRefObject<(() => void) | null>;
  uiMode?: UIMode;
}

export interface TmuxPaneToolbarProps {
  activePaneRect?: DimPaneRect | null;
  bufferZoomBinding?: string;
  dimInactivePanesEnabled?: boolean;
  dimInactivePanesOpacity?: number;
  mainMenuBindingLabel?: string;
  /** True when the mux-o-tron has keyboard focus in muxotron-focus mode (dim terminal). */
  muxotronFocusActive?: boolean;
  onBufferZoom: () => void;
  onClosePane?: () => void;
  onDetach?: () => void;
  onMobileToggle?: () => void;
  /** Called when user clicks the dimmed terminal area to dismiss muxotron focus. */
  onMuxotronDismiss?: () => void;
  onOpenMainMenu?: () => void;
  onSidebarToggle?: () => void;
  onSidebarViewChange?: (view: "agents" | "hook-sniffer" | "server") => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onToolbarToggle?: () => void;
  sidebarClientRef?: React.MutableRefObject<TmuxControlClient | null>;
  sidebarCurrentSessionName?: string;
  sidebarFocused?: boolean;
  sidebarFocusedIndex?: number;
  sidebarItemCountRef?: React.MutableRefObject<number>;
  sidebarOnTreeNavigate?: (sessionName: string, windowId: string, paneId: string) => void;
  sidebarOnTreeSwitchPaneTab?: (slotKey: string, tabIndex: number) => void;
  sidebarOpen?: boolean;
  sidebarPaneTabGroups?: Map<string, PaneTabGroup>;
  sidebarView?: "agents" | "hook-sniffer" | "server";
  sidebarViewActivateRef?: React.MutableRefObject<((index: number) => void) | null>;
  sidebarViewZoomRef?: React.MutableRefObject<((index: number) => void) | null>;
  sidebarWidth?: number;
  tmuxKeyBindingHints?: boolean;
  toolbarActivateRef?: React.MutableRefObject<((index: number) => void) | null>;
  toolbarFocused?: boolean;
  toolbarFocusedIndex?: number;
  toolbarItemCountRef?: React.MutableRefObject<number>;
  toolbarOpen?: boolean;
}
