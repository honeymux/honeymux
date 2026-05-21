# Changelog

## Unreleased

## v0.108.1 - 2026-05-21

- Allow window tab drag-and-drop reordering during tab overflow
- Ensure prompt column for remote claude and codex sessions is populated in the agents view
- Fix issue causing delayed terminal dimension updates to remote panes after sidebar resize
- Fix issue with terminal cursor state restoration after exiting buffer zoom
- Fix regression causing unexpected session switch on Quick Terminal close
- Fix remote pane mirror reconciliation following tmux client restart and cross-window pane moves
- Highlight all agent tree columns in the zoomed sidebar view to match recent non-zoomed view change
- Upgrade opentui to 0.2.15
- Use agent brand colors consistently when styling agent tree rows during active permission requests

## v0.108.0 - 2026-05-17

- Add support for `tmux switch-client -t session:window` 
- Auto-revert panes to local login shell on remote shell exit
- Fix IME composition text not reaching tmux on Kitty-protocol terminals (thanks @zenyr)
- Improve agent liveness check to detect remote agents that exit forcibly
- Prevent remote tmux server instance name collisions
- Refactor remote stitching architecture to new reconciler-based approach
- Switch agent hook forwarding from Unix sockets to authenticated TCP (thanks @tfriedel)
- Upgrade opentui to 0.2.12


## v0.107.0 - 2026-05-12

- Auto-refresh remote hook scripts on connect (thanks @tfriedel)
- Avoid writing Warp version number into keybindings file overrides dict
- Change default tmuxKeyBindingHints setting to false
- Fix buffer zoom entry in Warp terminal
- Fix delay seen in mux-o-tron render updates on pane/window switch
- Fix issue preventing Codex permission prompts from resolving when auto-review enabled
- Highlight all agent tree columns in the sidebar for the currently focused agent
- Make permission-resolution keystrokes more reliable across agent types
- Optimize process detection approach on macOS
- Prevent root row from being selected when sidebar first gains focus
- Program libghostty-vt with outer terminal color palette (thanks @tfriedel)
- Resolve agent pids for hook calls server-side
- Restore terminal cursor after buffer zoom view exit via Main Menu
- Show latch release key in button strip when responding to permission requests
- Update Codex config write for hooks feature name change
- Update Codex config write to auto-trust hmx hooks
- Use correct terminal bg color for outer emulators that don't repsond to OSC 11 (e.g. Warp)

## v0.106.0 - 2026-05-07

- Auto-resize the session dropdown badge to accomodate longer names without string truncation
- Defer mux-o-tron expansion while the window tab context menu is active
- Disable inactive pane dimming when a pane is zoomed via tmux
- Fix bug that caused unintended mux-o-tron expansion when the requesting agent was still in focus in a multi-tab pane
- Fix minor display bug by always rendering dropdown menus with the initial index set to the focus index
- Fix minor display padding issue with dropdown text input fields
- Fix too-wide right-click hit zone in single tab pane borders
- Highlight all server tree columns in the sidebar for the currently focused pane
- Refactor remote mirror handling to prevent the remote layout from diverging from the local layout

## v0.105.0 - 2026-05-04

- Add "default" option to both cursor alert shape and blink settings
- Add grey ramp to color picker and apply contrast logic to session label
- Change default agent alert animation to scribble with a 3 cycle count
- Change default session color to light grey
- Don't tear down remote tmux mirror on session-group winlink churn
- Ignore activate menu hotkey presses when the foreground dialog doesn't have a dropdown menu
- On window creation, always position the new tab at the far right
- Promote pane tabs feature out of experimental and enable by default
- Return to session list when canceling a new session or rename session operation
- Show sidebar and toolbar on fresh install
- Suppress agent hooks upgrade prompt when the current install is already up to date
- Unify the open-state indicator for the menu dropdown in all dialogs

## v0.104.0 - 2026-05-01

- Change the default theme from dracula to spacemacs
- Fix focus/input mismatch during cross-session jumps to remote-backed panes
- Fix issue that caused a newline to be gratuitously added to the Codex config.toml on every hmx startup
- Fix keystroke loss during search query entry in conversations dialog
- Fix regression causing high latency of cursor positioning during window switch
- In the sidebar tmux server view, highlight the full path to the currently active pane
- Keep Mux-o-Tron and session dropdown visible during pane drags
- Pass mouse clicks to tmux before handling click-to-move cursor positioning
- Preserve soft line wraps in buffer zoom view
- Reduce verbosity of event log for remote-backed pane interactions
- Refactor remote input path to give the local tmux server priority
- Upgrade ghostty-opentui to v1.4.12
- Upgrade opentui to v0.2.1

## v0.103.2 - 2026-04-29

- Fix screenshots feature by bundling the required fonts into distribution binaries

## v0.103.1 - 2026-04-29

- Accept --version flag as an alias for -V
- Drop an outdated/unnecessary custom ghostty-opentui patch
- Fix Unicode character input (CJK, accented letters, emoji) in tmux panes (thanks @zenyr)
- Fix double-rendering overlay issue and expand mux-o-tron mouse click hit zone in marquee UI modes
- Fix layout math to allow more room for window tabs when the mux-o-tron is disabled
- Fix rapid terminal cursor flashing when Codex is thinking
- Fix screenshots feature by embedding the takumi NAPI binding into distribution binaries

## v0.103.0 - 2026-04-27

- Add support for Codex PermissionRequest hooks
- Align hmx grapheme cluster width handling with tmux
- Allow drop position selection when dragging a tab into a single-tab taget pane
- Avoid destroying tmux sessions when hmx crashes or detaches unexpectedly
- Expand key binding support to function row keys and other bare named keys
- Fix bracketed paste boundary characters (001~ etc) leaking into remote panes
- Forward mouse events to the Quick Terminal when it's in focus
- Hide remote mirror sessions entries in the session dropdown menu
- Honor tmux extended-keys settings during input forwarding to pty
- Inherit the active pane's current working directory when creating new panes and windows
- Preserve pane tab names when dragging a renamed tab into a single-tab target pane
- Reap ssh control-mode processes on hmx exit
- Show zoom key sticky toggles as "-" in the Main Menu when kitty keyboard protocol unavailable
- Update hook scripts to skip connection when the agent is not running underneath hmx
- Update the Quick Terminal resize handle and menu icon glyphs for consistency
- Upgrade ghostty-opentui to bring in fix for multi-codepoint grapheme cluster handling
- Use BEL terminators for OSC output to resolve stray backslash char issue in SecureCRT
- Widen the mouse hit zone in the Mux-o-Tron for agents dialog access

## v0.102.3 - 2026-04-24

- Fix race condition preventing the hmx process from exiting on tmux client detach key
