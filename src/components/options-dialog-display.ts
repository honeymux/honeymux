import {
  centerToWidth,
  charWidth,
  fitToWidth,
  padEndToWidth,
  splitAtColumn,
  stringWidth,
  stripNonPrintingControlChars,
  truncateToWidth,
} from "../util/text.ts";

export function centerOptionsText(text: string, width: number): string {
  return centerToWidth(sanitizeOptionsText(text), width);
}

export function fitOptionsText(text: string, width: number): string {
  return fitToWidth(sanitizeOptionsText(text), width);
}

export function renderCursorViewport(
  text: string,
  cursor: number,
  width: number,
  options: { leadingEllipsis?: boolean } = {},
): string {
  if (width <= 0) return "";
  if (width === 1) return "\u2588";

  const safe = sanitizeOptionsText(text);
  const safeCursorColumn = Math.min(cursorColumn(text, cursor), stringWidth(safe));
  const [beforeAll, afterAll] = splitAtColumn(safe, safeCursorColumn);
  const textBudget = width - 1;
  const clippedLeft = stringWidth(beforeAll) > textBudget;

  let before = takeSuffixByWidth(beforeAll, textBudget);
  if (options.leadingEllipsis && clippedLeft && textBudget > 1) {
    before = "…" + takeSuffixByWidth(beforeAll, textBudget - 1);
  }

  const afterBudget = Math.max(0, textBudget - stringWidth(before));
  const after = takePrefixByWidth(afterAll, afterBudget);
  return padEndToWidth(`${before}\u2588${after}`, width);
}

export function rightTruncateOptionsText(text: string, width: number): string {
  const safe = sanitizeOptionsText(text);
  if (width <= 0) return "";
  if (stringWidth(safe) <= width) return safe;
  if (width === 1) return "…";
  return "…" + takeSuffixByWidth(safe, width - 1);
}

export function sanitizeOptionsText(text: string): string {
  return stripNonPrintingControlChars(text);
}

export function wrapOptionsText(text: string, width: number): string[] {
  const safe = sanitizeOptionsText(text).trim();
  if (!safe || width <= 0) return [];

  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (stringWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = stringWidth(word) <= width ? word : truncateToWidth(word, width);
  }

  if (current) lines.push(current);
  return lines;
}

function cursorColumn(text: string, cursor: number): number {
  const safePrefix = sanitizeOptionsText(text.slice(0, Math.max(0, cursor)));
  return stringWidth(safePrefix);
}

function takePrefixByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  let out = "";
  for (const ch of text) {
    const nextWidth = charWidth(ch);
    if (width + nextWidth > maxWidth) break;
    out += ch;
    width += nextWidth;
  }
  return out;
}

function takeSuffixByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  const kept: string[] = [];
  let width = 0;
  for (const ch of Array.from(text).reverse()) {
    const nextWidth = charWidth(ch);
    if (width + nextWidth > maxWidth) break;
    kept.push(ch);
    width += nextWidth;
  }
  return kept.reverse().join("");
}
