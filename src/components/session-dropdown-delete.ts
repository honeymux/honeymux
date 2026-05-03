import { isDismissKey } from "../util/keybindings.ts";

export type SessionDeleteConfirmFocus = 0 | 1;
type SessionDeleteConfirmAction = "close" | "delete" | "none";

export const SESSION_DELETE_CONFIRM_YES = 0;
const SESSION_DELETE_CONFIRM_NO = 1;
export const SESSION_DELETE_CONFIRM_DEFAULT_FOCUS = SESSION_DELETE_CONFIRM_NO;

export function handleSessionDeleteConfirmInput(
  data: string,
  focused: SessionDeleteConfirmFocus,
): { action: SessionDeleteConfirmAction; focused: SessionDeleteConfirmFocus } {
  if (data === "\x1b[C" || data === "\x1b[D" || data === "\t") {
    return {
      action: "none",
      focused: focused === SESSION_DELETE_CONFIRM_YES ? SESSION_DELETE_CONFIRM_NO : SESSION_DELETE_CONFIRM_YES,
    };
  }

  if (data === "\r" || data === "\n") {
    return {
      action: focused === SESSION_DELETE_CONFIRM_YES ? "delete" : "close",
      focused,
    };
  }

  if (isDismissKey(data)) {
    return { action: "close", focused };
  }

  return { action: "none", focused };
}
