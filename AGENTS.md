# Agents & AI Assistant Notes

Notes for AI assistants working on this codebase.

## Code organization

**Rule**: Prefer modules with one clear responsibility and one primary reason to change. If a file is simultaneously handling transport, parsing, state management, UI coordination, and policy decisions, it is too broad and should be split.

**Rule**: Keep orchestrator files thin. Managers, hooks, and controllers may coordinate multiple subsystems, but protocol parsing, data normalization, persistence, and boundary-specific policy should live in dedicated helpers or sibling modules.

**Rule**: Extract trust-boundary logic into explicit boundary modules. Parsing and normalizing untrusted input from sockets, tmux, remotes, config files, or pane output should happen in focused files near the ingress point rather than being inlined throughout higher-level application code.

**Rule**: When local and remote paths share a concept but differ in transport, separate the shared model from the transport-specific implementation. For example, event parsing, remote transport, permission routing, and UI/session updates should each have their own seam instead of being interleaved in one large file.

**Rule**: Prefer small reusable primitives for repeated low-level patterns, especially around parsing, buffering, escaping, bounds enforcement, and sanitization. Do not duplicate subtle boundary logic across multiple sockets, streams, or parsers.

**Rule**: Do not turn `util/` into a dumping ground. Only place code there when it is genuinely cross-cutting, domain-agnostic, and likely to be reused by multiple subsystems. Otherwise keep helpers next to the domain that owns them.

**Rule**: File placement should follow ownership and trust boundaries, not convenience. tmux protocol code belongs with tmux, remote transport code with remote, agent event ingestion with agents, and UI-only transformations with app/components.

**Rule**: When a refactor extracts a new seam, also improve testability at that seam. New parsers, transports, mappers, and bounded-buffer helpers should usually gain direct unit tests rather than only being covered indirectly through larger integration flows.

**Rule**: Prefer additive extraction over invasive rewrites. When shrinking an oversized module, first carve out cohesive units with stable interfaces, then simplify the original orchestrator around those units. Avoid broad churn that mixes behavioral changes with structural cleanup unless necessary.

**Rule**: Shared abstractions must stay concrete and justified. Do not introduce generic factories, base classes, or indirection layers unless at least two real call sites already benefit and the abstraction reduces complexity instead of hiding it.

**Rule**: Keep generic infrastructure layers free of feature-specific methods. The tmux control client, event emitter, config system, and similar shared modules must expose domain-neutral primitives. If a feature needs to query tmux, compose the query from existing generic methods or add a new generic method that other features could also use. Feature-specific orchestration belongs in the feature's own hook or workflow module, not in the shared layer it consumes.

## Color handling

Honeymux must work on the Linux console (outside X/Wayland), which only supports 16 colors. The theme system uses 24-bit hex colors that get mapped to the nearest 16-color equivalent by the terminal. This causes visually distinct colors (like `theme.bgFocused` vs `theme.bgSurface`) to collapse to the same value.

**Rule**: Always set colors according to theme reference values, never by hard-coded hex/RGB, unless instructed otherwise.

**Rule**: Never rely solely on background color to indicate focus or selection state. Always pair it with a text-based indicator (prefix character like `›`, foreground color change, or both). This applies to all dropdown menus, list items, and interactive UI elements. Examples of correct focus indication: (i) focused dropdown items get a `▸` prefix and `theme.textBright` foreground; unfocused items use blank prefix, (ii) only the focused item shows `▸` — don't also mark the "active/current" item with a separate arrow, as that creates two competing indicators, (iii) button focus uses both color and a `▸` prefix (see e.g. options dialog).

## Dialogs

**Rule**: All confirmation dialogs for destructive operations should focus the cursor on the negative answer (e.g. cancel) by default, to help mitigate inadvertent positive responses.

## Display width

**Rule**: Treat rendered text layout in terminal cell width, not code-unit count. CJK/fullwidth characters may occupy 2 cells, combining marks may occupy 0, and mixed-width strings must still align correctly.

**Rule**: Any truncation, padding, centering, hit-testing, overlay placement, drag geometry, fixed-column layout, or absolute-position calculation that depends on rendered text width must use the repo's width-aware text helpers rather than raw `.length`, `slice()`, `padStart()`, or `padEnd()`.

**Rule**: This applies to both interactive and passive UI surfaces: tab bars, pane tabs, trees, dropdowns, overflow menus, overlays, headers, and dialogs. Do not assume passive displays are exempt from width-aware handling.

**Rule**: Strip non-printing control characters before measuring or rendering display text. Width calculations must operate on the same sanitized text that will actually be shown.

**Rule**: When exact Unicode behavior is uncertain, prefer conservative earlier truncation or extra spacing over overlap, clipping, broken borders, or incorrect hit zones.

**Rule**: Any layout change touching rendered text width should add or update regression tests with mixed ASCII and CJK/wide labels.

## General

**Rule**: All communication with tmux is strongly preferred through the built-in control client. Do not spawn ad-hoc tmux clients unless absolutely necessary.

**Rule**: Prefer keeping tmux-related Honeymux state in tmux itself. When higher-level Honeymux metadata needs to persist with a tmux session, prefer a session-scoped serialized user-option blob over external files or scattered per-pane/per-window options, unless there is a clear reason not to.

**Rule**: Anticipate failures user may run into and plan acordingly, e.g. configuration or environmental or troubles that can be easily mitigated by fast-failure and actionable error messages.

**Rule**: The official name of this software is "Honeymux" but its invoked using binary name "hmx" which may be used as a shorthand marker, e.g. for temp files or other ephemeral data.

## Keyboard and mouse handling

Users have a wide spectrum of tastes with respect to key bindings. Also, as a new UX layer sitting between the user's terminal emulator and multiplexer, we must respect that the applications running beneath us have their own key binding needs.

**Rule**: All software functions must be accessible via the keyboard. All menus, tool bars, slider controls, and other UI elements must be navigatable via the tab key and arrow keys.

**Rule**: Never assume US or English-speaking keyboard layout.

**Rule**: Out of the box, this software will only bind a single hotkey (currently ctrl+g) to access the interactive menu. All other functions are unmapped by default; we let users choose their own mappings. The user must be able to forward this single hotkey to their terminal by pressing it twice.

**Rule**: When any pop-up dialog or overlay comes into focus, it must be dismissed upon any of the following inputs: (1) the esc key (exception: terminal views), (2) the same key that launched it, (3) a mouse click outside of it.

**Rule**: Any overlay that needs click-outside dismissal must keep the mouse coordinate mapper aware it is open (e.g. by holding `dropdownInputRef.current` non-null, or setting an appropriate open-state ref) so that mouse events are routed to OpenTUI rather than forwarded to the PTY. If `textInputActive` is also set (e.g. a rename textarea is focused), wire a `textInputEscapeHandlerRef` handler that closes the overlay, and use a `useEffect` to maintain `textInputActive` for the overlay's lifetime — otherwise pressing Escape will clear the input-routing flags without actually dismissing the overlay.

**Rule**: Always dim the tmux terminal view area while keyboard focus is set to a different region (sidebar, toolbar, mux-o-tron).

## Query dialogs and search

**Rule**: Dialogs that browse potentially large result sets must be driven by a query API that returns a bounded snapshot plus metadata such as `results`, `total`, `hasMore`, and any query error. Do not preload or render thousands of rows just to make search or navigation possible.

**Rule**: Keep query text, search options, paging/window state, and the current result snapshot owned by one workflow/controller layer. Input handlers, selection logic, and render code must consume that shared snapshot rather than issuing independent ad-hoc queries.

**Rule**: Paging navigation must preserve bounded windows. Arrow-wrap behavior, jump-to-oldest/newest behavior, and `Page Up` / `Page Down` behavior must move between pages or windows without expanding the dialog to the full result set.

**Rule**: Position labels and selection logic in paged dialogs must use absolute result positions rather than page-local indexes so focus and status remain coherent across page changes.

**Rule**: Search should default to the least surprising mode. Plain text search should be case-insensitive unless there is an explicit product decision otherwise; advanced modes such as case-sensitive search and regex search should be explicit opt-in toggles.

**Rule**: Regex-enabled search UIs must validate patterns and surface regex errors directly in the dialog status or empty-state area. Invalid patterns must not silently degrade into “no results”.

**Rule**: Search-hit highlighting must not compete with focus/selection indication, especially on 16-color terminals. Prefer foreground and text attributes such as underline over heavy background fills when both states need to coexist.

**Rule**: Any new query-dialog search or paging behavior should gain direct regression coverage for page boundaries, wrap behavior, absolute position labeling, and error states.

## Security and privacy

Treat all data passing through the terminal as sensitive. Developers often copy auth tokens and other hazardous materials around.

**Rule**: If ever handling known sensitive data, make all efforts to wipe it from memory and/or disk after use.

**Rule**: Never perform file operations outside of ~/.config/honeymux/ or ~/.local/state/honeymux/ without prior user consent.

**Rule**: Treat all pane-derived and remote-derived text as untrusted input. This includes pane output, `pane_current_command`, tab names, remote server names, tmux metadata, terminal probe responses, and values loaded from user-editable config files.

**Rule**: Never embed untrusted text directly into tmux format strings, status strings, or control commands. Use the repo's tmux escaping/quoting helpers and preserve literal semantics across tmux's own mini-language.

**Rule**: Do not treat escaping helpers as interchangeable across grammars. tmux control-mode command args, tmux format strings, shell quoting, SSH argv construction, JSON encoding, and terminal escape streams all have different rules. Match the helper to the parser that will consume the value.

**Rule**: Never build shell or SSH commands by concatenating untrusted operands into a single string. Prefer argv arrays, insert `--` before untrusted SSH destinations when supported, and reject destinations that could be parsed as options or contain whitespace/control characters.

**Rule**: When data crosses a trust boundary, enforce policy before provenance is lost. If remote-derived, pane-derived, or user-editable data will be merged into a more-trusted stream, sanitize or reject it at the boundary rather than after it has been re-emitted as ordinary local output.

**Rule**: Any tmux-derived, pane-derived, remote-derived, or config-derived text rendered back into the UI must strip non-printing control characters first. Display labels must not contain raw newlines, tabs, ESC, DEL, or other control bytes that can distort layout or be reinterpreted by terminal/UI layers.

**Rule**: Never silently weaken security-sensitive transport defaults for convenience. In particular, do not auto-accept SSH host keys, auto-enable agent forwarding, or expand remote clipboard/terminal privileges unless there is an explicit product decision and, where appropriate, an explicit user opt-in.

**Rule**: Treat Honeymux as a trust boundary between pane output and the outer terminal emulator. Do not forward host-affecting escape sequences (clipboard, notification, title, file/open, etc.) unless there is an explicit product decision, a config policy when appropriate, and a clear understanding that pane output may be attacker-controlled even when the foreground program itself looks familiar.

**Rule**: Agent hook socket routing must not trust per-process environment overrides. Local hooks should use fixed private runtime socket paths; remote hook socket paths should come from tmux-owned state such as a user option, not a shell environment variable.

**Rule**: For remote panes bridged into a local tmux pane, tmux is the authoritative escape-sequence policy boundary. Do not flag remote-pane OSC handling as a Honeymux vulnerability merely because it matches tmux policy; only direct outer-terminal writes and other non-tmux paths require Honeymux-side passthrough enforcement.

**Rule**: Stateful parsers for PTY output, tmux control mode, or escape-sequence streams must have explicit bounds on buffered state. Unterminated or oversized inputs must fail closed, discard safely, and resynchronize; they must never accumulate unbounded memory while waiting for a terminator.

**Rule**: Local IPC endpoints (Unix sockets, lock sockets, token files, temp directories) must be created with owner-only permissions when possible, and any fallback path under `/tmp` must be permission-hardened immediately after creation. Do not rely on ambient umask or directory defaults for security.

**Rule**: User-owned ephemeral runtime artifacts should live under Honeymux's private runtime directory, using `XDG_RUNTIME_DIR/honeymux` when available and a private state-directory fallback otherwise. Do not place sockets, lock files, temp directories, or debug/runtime scratch files in shared `/tmp` during normal operation.

## Terminal dimensions

The basic UI controls (tabs, mux-o-tron, session selector, profile selector, sidebar, toolbar, etc.) must work with terminal windows as small as 80x24 (80 columns, 24 rows). Other UI elements, such as the various dialogs (agents, conversations, main menu, options, etc) must also work and auto-adjust to the limited space. When the terminal is shrunk to a smaller size than this, the user should be informed.

**Rule**: All UI elements must be tolerable of terminal resizing to arbitrary dimensions above and equal to the 80x24 minimum.

**Rule**: Treat width and height constraints in terminal cells, not JavaScript string length. A label that is 10 code units wide is not necessarily 10 terminal columns wide.

**Rule**: Never add new content to the UI without first checking whether it would violate these constraints.

## Terminal probing

We aim to work with as wide a variety of terminal emulators as possible, including server thick apps, smartphone apps, xterms, and Linux/BSD consoles, with a wide range of capabilities.

**Rule**: Never assume a particular terminal capability is available without first probing.

**Rule**: Never implement arbitrary blocking timeouts at startup; use basic CPR queries to synchronize instead.

## Text encoding

This software requires a UTF-8 compatible terminal for proper display and that is OK. :)

## Text input

**Rule**: All leading and trailing whitespace must be removed from text input on submission.

## User experience

**Rule**: All UI interactions must trigger some type of visual feedback.

**Rule**: Avoid any order of operation that may cause inadvertent flashing or flickering effects; always fully prepare all content, layouts, and styling prior to rendering and/or making visible.

**Rule**: Item lists, such as in drop-down selectors, should be ordered asciibetically by default, unless instructed otherwise.

**Rule**: Make judicious use of margins and padding during UI design tasks to improve aesthetics and prevent crowding.

## Workflow

**Rule**: ESLint enforces alphabetical ordering via `eslint-plugin-perfectionist` on a wide range of constructs. The sort is case-sensitive with uppercase before lowercase (`A < a < B < b < …`), using `en-US` locale comparison. Affected constructs include: imports and named import specifiers, exports, interface and object-type properties, object literals, JSX props, destructured bindings, union and intersection types, enums, switch cases, class members (properties and methods), and top-level module statements (including exported function declarations). When adding new entries to any sorted list, insert them in the correct position up front rather than appending and relying on the linter to catch it.

**Rule**: After each code change, run `bun run typecheck`, `bun run format`, and `bun run lint` to catch errors early.
