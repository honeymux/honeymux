export interface PaneTab {
  label: string;
  paneId: string;
  /** If set, the user explicitly named this tab (overrides auto-naming). */
  userLabel?: string;
}

export interface PaneTabGroup {
  activeIndex: number;
  /**
   * If set, the user explicitly named the host tmux window while pane tabs
   * owned it. Keep this separate from pane-tab labels so clearing a window
   * rename can fall back to the active pane-tab label.
   */
  explicitWindowName?: string;
  /**
   * Whether the visible window should return to tmux automatic naming after
   * the pane-tab group is dissolved back into an ordinary window.
   */
  restoreAutomaticRename?: boolean;
  slotHeight: number;
  slotKey: string;
  slotWidth: number;
  tabs: PaneTab[];
  windowId: string;
}
