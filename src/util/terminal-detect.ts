/**
 * Terminal emulator identity.
 *
 * Populated at startup by the consolidated terminal probe
 * (see terminal-probe.ts).
 */

/**
 * Detected outer terminal emulator name, or null if unknown.
 *
 * This is the raw XTVERSION-derived value and may include a version
 * suffix — e.g. "iTerm2 3.6.9", "WezTerm 20240203", "kitty(0.45.0)".
 * For matching against a known terminal name use {@link terminalBaseName}
 * instead.
 */
export let terminalName: null | string = null;

/** Set the terminal name from probe results. */
export function setTerminalName(name: null | string): void {
  terminalName = name;
}

/**
 * Return the terminal emulator base name without any trailing version
 * suffix.  Strips everything from the first whitespace or opening
 * bracket/brace/paren that precedes a digit.  Examples:
 *
 *   "iTerm2 3.6.9"        → "iTerm2"
 *   "WezTerm 20240203"    → "WezTerm"
 *   "kitty(0.45.0)"       → "kitty"
 *   "foo[1.2]"            → "foo"
 *   "Ghostty"             → "Ghostty"
 *   null                  → null
 */
export function terminalBaseName(): null | string {
  if (!terminalName) return null;
  return terminalName.replace(/[\s({[]\d.*$/, "");
}
