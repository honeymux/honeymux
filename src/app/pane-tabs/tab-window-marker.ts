/**
 * A pane-tab group parks each inactive tab's pane in its own detached tmux
 * window. Those "staging" windows must be hidden from Honeymux's own window
 * lists (tab bar, server tree, counts) while still being real tmux windows.
 *
 * The discriminator is the `@hmx-tab-window` window user-option rather than the
 * window name: that lets us rename a staging window to its tab label so tmux's
 * native `choose-tree` (e.g. `prefix + w`) shows the label instead of an
 * internal placeholder, without those relabeled windows leaking back into
 * Honeymux's lists.
 *
 * `STAGING_PLACEHOLDER_NAME` is the transient name a staging window carries
 * between creation and the label sync; it doubles as a name-based fast-path so
 * a freshly created staging window is hidden in the same tick it appears, before
 * the option has been observed.
 */
export const STAGING_PLACEHOLDER_NAME = "__hmx_tab";
export const TAB_WINDOW_OPTION = "@hmx-tab-window";

export function isManagedTabWindow(window: { name: string; tabWindow?: boolean }): boolean {
  return window.tabWindow === true || window.name === STAGING_PLACEHOLDER_NAME;
}
