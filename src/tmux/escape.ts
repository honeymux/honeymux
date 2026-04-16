const CONTROL_MODE_ARG_RE = /[\0\r\n]/;
const FORMAT_CONTROL_CHAR_RE = /[\0-\x1f\x7f]/g;

/**
 * Escape untrusted text before embedding it into a tmux format string.
 *
 * tmux treats `#` as the start of format expansion (`#{...}` / `#(...)`).
 * Doubling it (`##`) renders a literal `#` instead.
 */
export function escapeTmuxFormatLiteral(value: string): string {
  if (!value) return value;
  return value.replace(FORMAT_CONTROL_CHAR_RE, " ").replace(/#/g, "##");
}

/**
 * Quote a single argument for tmux's control-mode command parser.
 *
 * This is for the shell-like command grammar used by `tmux -C`, not tmux's
 * `#{...}` format language.
 */
export function quoteTmuxArg(label: string, value: string): string {
  assertSafeControlModeArg(label, value);
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function assertSafeControlModeArg(label: string, value: string): void {
  if (value.length === 0) throw new Error(`${label} cannot be empty`);
  if (CONTROL_MODE_ARG_RE.test(value)) {
    throw new Error(`${label} contains invalid control characters`);
  }
}
