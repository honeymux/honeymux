# Changelog

## Unreleased

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
