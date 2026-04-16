# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities via public GitHub issues, discussions, or pull requests.

Instead, email: **security@honeymux.com**

Please include:

- A clear description of the issue and potential impact
- Affected version(s) or commit(s)
- Reproduction steps or proof of concept (if possible)

Reports will be acknowledged within 48-72 hours with a target fix or mitigation timeframe of 30 days.

## Scope

In scope:

- Vulnerabilities in Honeymux itself, including bugs in its PTY discipline, terminal escape-sequence handling, tmux control-mode integration, and parser/buffer logic.
- Trust-boundary failures between pane output, tmux, the outer terminal, local IPC, config-derived data, and remote-backed panes. Examples include unsafe passthrough of host-affecting escape sequences, injection into tmux commands or format strings, shell/SSH argument injection, or improper handling of untrusted pane/remote text.
- Security issues in Honeymux's remote/local bridging model, such as flaws that let remote-derived state, metadata, or events unexpectedly affect the local machine or local UI/session state.
- Vulnerabilities in Honeymux-owned local IPC and runtime artifacts, including Unix socket exposure, unsafe file or directory permissions, insecure temporary/runtime paths, token leakage, and related local privilege boundary mistakes.
- Boundedness and fail-closed issues in Honeymux stateful parsers and stream handlers, including cases where malformed or unterminated input can trigger unbounded memory growth, desynchronization, or policy bypass.
- Security flaws in Honeymux's own integration layer for supported coding agents, such as insecure hook discovery, hook socket routing, permissions, or exposure of agent data across local/remote boundaries.

Out of scope:

- Vulnerabilities that exist solely in third-party software such as tmux, OpenTUI, libghostty, ghostty-opentui, terminal emulators, SSH implementations, or the coding-agent tools themselves, unless Honeymux introduces the bug, bypasses an expected boundary, or materially worsens exploitability.
- The internal security of external coding-agent hook mechanisms or approval systems. For example, a vulnerability in Claude Code, Codex, Gemini, or OpenCode's own hook implementation is out of scope; a Honeymux bug in how it discovers, routes, exposes, or isolates those hooks is in scope.
- Security of user-managed infrastructure or environments outside Honeymux, including compromised remote hosts, insecure SSH server configuration, shell startup files, or programs running inside panes, unless Honeymux weakens transport defaults or breaks the intended trust boundary.
- Escape-sequence behavior that is already mediated by tmux for a remote pane and does not bypass Honeymux's own policy boundary. In particular, if tmux is the component deciding how a remote pane's OSC or similar output is handled, that is not by itself a Honeymux vulnerability.
- Vulnerabilities that require modifying the Honeymux source tree, local install, or runtime files as the same user and do not cross a meaningful privilege, trust, or containment boundary.

If you are unsure whether an issue is in scope, please report it anyway and include your reasoning.

## Supported Versions

Honeymux is pre-1.0 software, currently maintained with a single incremental train of development. Security fixes will be applied to the main branch alongside all other bug fixes and feature updates.
