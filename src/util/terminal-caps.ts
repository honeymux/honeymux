/**
 * Terminal capability detection.
 *
 * Populated at startup by the consolidated terminal probe
 * (see terminal-probe.ts) which queries via XTGETTCAP (DCS +q).
 *
 *   import { hasCap } from "../util/terminal-caps.ts";
 *   if (hasCap("Ms")) // OSC 52 clipboard supported
 */

const caps = new Map<string, string>();

// ── Public API ────────────────────────────────────────────────────────────

/** Whether the terminal advertises a given capability. */
export function hasCap(name: string): boolean {
  return caps.has(name);
}

/** Populate capabilities from probe results. */
export function setTermCaps(probed: ReadonlyMap<string, string>): void {
  caps.clear();
  for (const [k, v] of probed) caps.set(k, v);
}
