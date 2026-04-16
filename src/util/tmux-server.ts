/**
 * Per-instance tmux server isolation.
 *
 * Each honeymux instance runs its own tmux server via `tmux -L <name>`.
 * This module stores the server name and provides a helper that prepends
 * the `-L` flag to every tmux invocation.
 */

let _serverName = "honeymux";

/** Get the current tmux server name. */
export function getTmuxServer(): string {
  return _serverName;
}

/** Set the tmux server name. Must be called once at startup before any tmux commands. */
export function setTmuxServer(name: string): void {
  _serverName = name;
}

/** Detected tmux version string (e.g. "tmux 3.4"), or null if unknown. */
export let tmuxVersion: null | string = null;

/** Set the tmux version from startup probe. */
export function setTmuxVersion(v: null | string): void {
  tmuxVersion = v;
}

/** Build a tmux command array with the `-L` flag for this instance's server. */
export function tmuxCmd(...args: string[]): string[] {
  return ["tmux", "-L", _serverName, ...args];
}
