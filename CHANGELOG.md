# Changelog

## Unreleased

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
