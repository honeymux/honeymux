import { hostname } from "node:os";

import type { TmuxControlClient } from "../tmux/control-client.ts";

/**
 * Derives the tmux server name used for the per-remote mirror tmux server.
 *
 * Each local hmx instance gets its own mirror tmux server on every remote it
 * bridges to. Naming the remote socket after the local tmux server's
 * `#{start_time}` (plus a short hostname for human readability) avoids
 * collisions when:
 *   - the user runs hmx natively on the same remote (that one stays "honeymux")
 *   - the user bridges to the same remote from another local machine
 *   - the user restarts their local tmux server (the old remote mirror is
 *     correctly orphaned rather than silently reattached)
 *
 * Final form: `honeymux-<host>-<start_time>`. Missing components collapse
 * out; `honeymux-bridge` is the universal fallback when nothing usable is
 * available.
 */

const FALLBACK_NAME = "honeymux-bridge";
const MAX_HOST_LEN = 24;
const SAFE_CHAR_RE = /[^A-Za-z0-9._-]/g;

export interface MirrorServerNameDeps {
  getHostname: () => string;
  getStartTime: () => Promise<null | string>;
}

export async function deriveMirrorTmuxServerName(deps: MirrorServerNameDeps): Promise<string> {
  const host = sanitizeHostname(deps.getHostname());
  const startTime = await deps.getStartTime();

  const parts = ["honeymux"];
  if (host) parts.push(host);
  if (startTime) parts.push(startTime);

  return parts.length === 1 ? FALLBACK_NAME : parts.join("-");
}

export async function queryLocalTmuxStartTime(client: TmuxControlClient): Promise<null | string> {
  try {
    const out = await client.runCommandArgs(["display-message", "-p", "#{start_time}"]);
    const trimmed = out.trim();
    return /^\d+$/.test(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

export async function resolveMirrorTmuxServerName(client: TmuxControlClient): Promise<string> {
  return deriveMirrorTmuxServerName({
    getHostname: () => hostname(),
    getStartTime: () => queryLocalTmuxStartTime(client),
  });
}

function sanitizeHostname(raw: string): string {
  const firstSegment = (raw.split(".")[0] ?? "").trim();
  return firstSegment.replace(SAFE_CHAR_RE, "").slice(0, MAX_HOST_LEN);
}
