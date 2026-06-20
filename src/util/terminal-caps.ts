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

/**
 * Decide the value `$COLORTERM` should hold so OpenTUI emits 24-bit truecolor.
 *
 * OpenTUI (>= 0.2.12) chooses 256-color output unless `$COLORTERM` is
 * "truecolor"/"24bit" (or it auto-detects a few specific terminals). Honeymux
 * instead emits 24-bit color unconditionally and relies on the terminal to
 * down-map to its actual depth (Linux console -> 16 colors, etc.) — see the
 * color-handling notes in CLAUDE.md. Without this, a truecolor terminal whose
 * environment lacks COLORTERM (SSH does not forward it) silently degrades to
 * 256-color: every cell quantizes to the nearest palette entry, and with a
 * non-default host palette (e.g. via the base-palette override) white maps to
 * palette index 15 and renders as the wrong hue.
 *
 * Returns "truecolor" when COLORTERM is unset, or `undefined` to leave an
 * explicit existing value untouched.
 */
export function resolveColortermEnv(currentColorterm: string | undefined): string | undefined {
  return currentColorterm ? undefined : "truecolor";
}

/** Populate capabilities from probe results. */
export function setTermCaps(probed: ReadonlyMap<string, string>): void {
  caps.clear();
  for (const [k, v] of probed) caps.set(k, v);
}
