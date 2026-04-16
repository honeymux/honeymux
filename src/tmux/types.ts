export interface LayoutProfile {
  commands?: string[][]; // Per-pane commands (argv arrays), indexed by pane position
  favorite?: boolean; // At most one profile should be marked favorite
  layout: string; // Raw tmux layout string
  name: string; // User-chosen display name (unique key)
  paneCount: number; // Number of panes in the layout
  savedAt: number; // Date.now() timestamp
}

/**
 * Resolved tmux key bindings for UI hint display.
 * Maps action names to their display strings (e.g. "^b %").
 */
export interface TmuxKeyBindings {
  closePane: string; // kill-pane
  detach: string; // detach-client
  killWindow: string; // kill-window
  newWindow: string; // new-window
  prefix: string; // e.g. "ctrl-b"
  selectWindow: string[]; // select-window -t :=0 through :=9
  splitHorizontal: string; // split-window (no -h)
  splitVertical: string; // split-window -h
}

export interface TmuxPaneTtyMapping {
  paneId: string;
  sessionName: string;
  tty: string;
  windowId: string;
}

export interface TmuxSession {
  attached: boolean;
  color?: string; // hex color from @hmx-color user option
  id: string; // e.g. "$1"
  name: string;
}

export interface TmuxWindow {
  active: boolean;
  id: string; // e.g. "@1"
  index: number;
  layout: string; // e.g. "bb62,120x38,0,0{60x38,0,0,1,59x38,61,0,2}"
  name: string;
  paneId: string; // e.g. "%1"
}
