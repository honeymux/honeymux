/**
 * Terminal UTF-8 encoding detection.
 *
 * Two-layer check:
 * 1. isLocaleUtf8() — fast env-var check (LANG / LC_CTYPE / LC_ALL)
 * 2. Runtime probe via the consolidated terminal probe (terminal-probe.ts)
 */

/** Result of the runtime UTF-8 probe, or null if the probe wasn't run. */
export let terminalIsUtf8: boolean | null = null;

/** Quick check: does the locale advertise UTF-8? */
export function isLocaleUtf8(): boolean {
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  return /utf-?8/i.test(locale);
}

/** Set the UTF-8 probe result from the terminal probe. */
export function setTerminalIsUtf8(value: boolean | null): void {
  terminalIsUtf8 = value;
}
