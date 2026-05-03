type InputOwner =
  | "dialog"
  | "dialogCapture"
  | "dropdown"
  | "mobile"
  | "pty"
  | "quickTerminal"
  | "sidebar"
  | "textInput"
  | "toolbar";

interface InputOwnerState {
  dialogCapturing: boolean;
  dialogOpen: boolean;
  dropdownOpen: boolean;
  mobileMode: boolean;
  quickTerminalOpen: boolean;
  /** True when the review session is latched — keys must reach the agent PTY. */
  reviewLatched: boolean;
  sidebarFocused: boolean;
  textInputActive: boolean;
  toolbarFocused: boolean;
}

export function allowsGlobalModifierBindings(owner: InputOwner): boolean {
  return owner === "pty" || owner === "quickTerminal";
}

export function resolveInputOwner(state: InputOwnerState): InputOwner {
  if (state.quickTerminalOpen) return "quickTerminal";
  if (state.textInputActive) return "textInput";
  if (state.dialogOpen && state.dialogCapturing) return "dialogCapture";
  if (state.dialogOpen) return "dialog";
  // When the agent overlay is latched, keystrokes must reach the PTY — skip
  // the chrome-focus (toolbar/sidebar) and dropdown owners that would
  // otherwise intercept them. The user's focus in the chrome is preserved
  // but temporarily superseded while latched.
  if (!state.reviewLatched) {
    if (state.toolbarFocused) return "toolbar";
    if (state.sidebarFocused) return "sidebar";
    if (state.dropdownOpen) return "dropdown";
  }
  if (state.mobileMode) return "mobile";
  return "pty";
}
