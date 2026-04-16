/** Center text within a fixed display width, truncating first if needed. */
export function centerToWidth(text: string, targetWidth: number): string {
  const fitted = truncateToWidth(text, targetWidth);
  const width = stringWidth(fitted);
  if (width >= targetWidth) return fitted;
  const leftPad = Math.floor((targetWidth - width) / 2);
  const rightPad = targetWidth - width - leftPad;
  return " ".repeat(leftPad) + fitted + " ".repeat(rightPad);
}

/**
 * Terminal display width of a single character (code point).
 * Returns 2 for fullwidth / wide characters, 0 for zero-width, 1 otherwise.
 */
export function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  // Zero-width
  if (code === 0 || (code >= 0x0300 && code <= 0x036f)) return 0; // combining diacritics
  if (code >= 0xfe00 && code <= 0xfe0f) return 0; // variation selectors
  if (code >= 0x200b && code <= 0x200f) return 0; // zero-width spaces/joiners
  if (code === 0xfeff) return 0; // BOM / zero-width no-break space
  // Fullwidth / wide
  if (code >= 0x1100 && code <= 0x115f) return 2; // Hangul Jamo
  if (code >= 0x2e80 && code <= 0x303e) return 2; // CJK Radicals, Kangxi, Ideographic
  if (code >= 0x3040 && code <= 0x33bf) return 2; // Hiragana, Katakana, CJK
  if (code >= 0x3400 && code <= 0x4dbf) return 2; // CJK Extension A
  if (code >= 0x4e00 && code <= 0xa4cf) return 2; // CJK Unified + Yi
  if (code >= 0xac00 && code <= 0xd7af) return 2; // Hangul Syllables
  if (code >= 0xf900 && code <= 0xfaff) return 2; // CJK Compatibility Ideographs
  if (code >= 0xfe30 && code <= 0xfe6f) return 2; // CJK Compatibility Forms
  if (code >= 0xff01 && code <= 0xff60) return 2; // Fullwidth ASCII
  if (code >= 0xffe0 && code <= 0xffe6) return 2; // Fullwidth symbols
  if (code >= 0x20000 && code <= 0x2fa1f) return 2; // CJK extensions B-F + compat supplement
  if (code >= 0x30000 && code <= 0x323af) return 2; // CJK extension G-I
  // Emoji that render as 2 columns in modern terminals
  if (code >= 0x1f000 && code <= 0x1f02f) return 2; // Mahjong, Dominos
  if (code >= 0x1f0a0 && code <= 0x1f0ff) return 2; // Playing cards
  if (code >= 0x1f100 && code <= 0x1f1ff) return 2; // Enclosed Alphanumerics
  if (code >= 0x1f200 && code <= 0x1f2ff) return 2; // Enclosed Ideographic
  if (code >= 0x1f300 && code <= 0x1fbff) return 2; // Misc Symbols, Emoticons, etc.
  // Everything else is single-width (including Dingbats U+2700-27BF, Misc Symbols U+2600-26FF)
  return 1;
}

/** Truncate if needed, then pad on the right to exactly targetWidth columns. */
export function fitToWidth(text: string, targetWidth: number): string {
  return padEndToWidth(truncateToWidth(text, targetWidth), targetWidth);
}

/** Mid-string truncation: shows start and end with "…" in the middle. */
export function midTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return text.slice(0, maxLen);
  const available = maxLen - 1;
  const headLen = Math.ceil(available / 2);
  const tailLen = Math.floor(available / 2);
  return text.slice(0, headLen) + "…" + text.slice(text.length - tailLen);
}

/** Mid-truncate a file path by removing middle segments. */
export function midTruncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const sep = "/";
  const parts = path.split(sep);
  if (parts.length <= 3) return midTruncate(path, maxLen);
  // Try keeping progressively fewer segments from both ends
  for (let keep = parts.length - 1; keep >= 2; keep--) {
    const left = Math.ceil(keep / 2);
    const right = keep - left;
    const candidate = [...parts.slice(0, left), "…", ...parts.slice(parts.length - right)].join(sep);
    if (candidate.length <= maxLen) return candidate;
  }
  const minimal = parts[0] + sep + "…" + sep + parts[parts.length - 1];
  if (minimal.length <= maxLen) return minimal;
  return midTruncate(path, maxLen);
}

/** Overlay insert onto base at the requested display column. */
export function overlayAtColumn(base: string, left: number, insert: string): string {
  if (left < 0) return base;
  const baseCells = toDisplayCells(base);
  const insertCells = toDisplayCells(insert);
  for (let i = 0; i < insertCells.length && left + i < baseCells.length; i++) {
    baseCells[left + i] = insertCells[i]!;
  }
  return baseCells.join("");
}

/** Pad a string with spaces until it reaches the requested display width. */
export function padEndToWidth(text: string, targetWidth: number): string {
  const width = stringWidth(text);
  if (width >= targetWidth) return text;
  return text + " ".repeat(targetWidth - width);
}

/** Pad a string on the left until it reaches the requested display width. */
export function padStartToWidth(text: string, targetWidth: number): string {
  const width = stringWidth(text);
  if (width >= targetWidth) return text;
  return " ".repeat(targetWidth - width) + text;
}

/** Split a string at a display column boundary. */
export function splitAtColumn(text: string, column: number): [string, string] {
  const cells = toDisplayCells(text);
  return [cells.slice(0, column).join(""), cells.slice(column).join("")];
}

/** Terminal display width of a string. */
export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += charWidth(ch);
  }
  return w;
}

/** Drop ASCII/C1 control bytes so labels cannot disturb terminal layout. */
export function stripNonPrintingControlChars(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** Truncate a name to maxLen columns, using " …" suffix if too long. */
export function truncateName(name: string, maxLen: number): string {
  return truncateToWidthWithSuffix(name, maxLen, " …");
}

/** Truncate text so its display width never exceeds maxWidth. */
export function truncateToWidth(text: string, maxWidth: number): string {
  return truncateToWidthWithSuffix(text, maxWidth, "…");
}

function takePrefixByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  let out = "";
  for (const ch of text) {
    const chWidth = charWidth(ch);
    if (width + chWidth > maxWidth) break;
    out += ch;
    width += chWidth;
  }
  return out;
}

function toDisplayCells(text: string): string[] {
  const cells: string[] = [];
  for (const ch of text) {
    const width = charWidth(ch);
    if (width <= 0) {
      if (cells.length > 0) cells[cells.length - 1] += ch;
      continue;
    }
    cells.push(ch);
    for (let i = 1; i < width; i++) cells.push("");
  }
  return cells;
}

function truncateToWidthWithSuffix(text: string, maxWidth: number, suffix: string): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(text) <= maxWidth) return text;

  const suffixWidth = stringWidth(suffix);
  if (suffixWidth >= maxWidth) return takePrefixByWidth(suffix, maxWidth);

  const prefix = takePrefixByWidth(text, maxWidth - suffixWidth);
  return prefix + suffix;
}

const HOME = process.env.HOME ?? "";

/** Sanitize a display path and shorten an absolute path by replacing $HOME with ~. */
export function shortenPath(path: string): string {
  const safePath = stripNonPrintingControlChars(stripAnsiEscapes(path));
  if (HOME && safePath.startsWith(HOME)) return "~" + safePath.slice(HOME.length);
  return safePath;
}

/** Strip ANSI escape sequences (CSI and OSC) from text. */
export function stripAnsiEscapes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}
