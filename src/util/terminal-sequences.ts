// xterm modifyOtherKeys mode 2 provides distinct sequences for modifier
// combos like Ctrl+Shift+A on terminals without kitty keyboard support.
export const MODIFY_OTHER_KEYS_ENABLE = "\x1b[>4;2m";
export const MODIFY_OTHER_KEYS_DISABLE = "\x1b[>4;0m";

export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_EXIT = "\x1b[?1049l";
export const CLEAR_SCREEN_AND_SCROLLBACK = "\x1b[H\x1b[2J\x1b[3J";
