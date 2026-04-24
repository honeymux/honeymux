const CONTROL_MODE_ARG_RE = /[\0\r\n]/;
const FORMAT_CONTROL_CHAR_RE = /[\0-\x1f\x7f]/g;

/**
 * Encode an arbitrary byte string as a tmux double-quoted argument carrying
 * its full content via escape sequences, so it survives transport on a single
 * line of tmux's control-mode command channel.
 *
 * tmux's command parser interprets these escapes inside double-quoted args
 * (cmd-parse.y `yylex_token_escape`, documented in tmux.1):
 *
 *   - `\NNN` (three octal digits, max `\377`) → byte NNN
 *   - `\\`  → literal `\`
 *   - `\"`  → literal `"`
 *   - `\$`  → literal `$` (otherwise env-var expansion)
 *   - `\~`  → literal `~` (otherwise tilde expansion at token start)
 *
 * Strategy: emit printable ASCII verbatim; emit one of the four parser-special
 * chars above as `\<ch>`; emit every other byte as a 3-digit octal escape.
 * The resulting wire form contains no real LF, so the line-terminated control
 * protocol can carry the value followed by exactly one terminating newline.
 *
 * Null bytes (`\0`) are stripped silently. tmux's `set-buffer` (and other
 * arg-data consumers) measure the value via `strlen()`, so an embedded `\000`
 * would truncate the buffer. Bracketed-paste content from a terminal does not
 * normally contain nulls; if it ever did, dropping them is preferable to
 * silently chopping the rest of the paste.
 *
 * Available since tmux 3.0 (yacc parser, May 2019). Honeymux already requires
 * tmux ≥ 3.3.
 */
export function encodeTmuxDoubleQuotedString(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  let out = '"';
  for (const b of bytes) {
    if (b === 0) continue;
    if (b === 0x22 || b === 0x24 || b === 0x5c || b === 0x7e) {
      out += "\\" + String.fromCharCode(b);
    } else if (b >= 0x20 && b < 0x7f) {
      out += String.fromCharCode(b);
    } else {
      const hi = (b >> 6) & 0x7;
      const mid = (b >> 3) & 0x7;
      const lo = b & 0x7;
      out += "\\" + hi + mid + lo;
    }
  }
  out += '"';
  return out;
}

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
