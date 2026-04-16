import type { PaneTab } from "./types.ts";

import { theme } from "../../themes/theme.ts";
import { escapeTmuxFormatLiteral } from "../../tmux/escape.ts";
import { stringWidth, stripNonPrintingControlChars, truncateToWidth } from "../../util/text.ts";

/** Border characters for each pane-border-lines style. */
const BORDER_CHARS: Record<string, { h: string; left: string; right: string }> = {
  dotted: { h: "┄", left: "┤", right: "├" },
  double: { h: "═", left: "╡", right: "╞" },
  heavy: { h: "━", left: "┫", right: "┣" },
  number: { h: "─", left: "┤", right: "├" },
  simple: { h: "-", left: "|", right: "|" },
  single: { h: "─", left: "┤", right: "├" },
};

const DEFAULT_BORDER = BORDER_CHARS["single"]!;
const MENU_GLYPH = "≡";
const MENU_GLYPH_COLS = 1;
const OVERFLOW_WIDTH = 8;
/** Per-tab chrome columns: "┤ " + " ├─" */
const TAB_CHROME = 5;
/** Labels at or below this length are never truncated by the water-fill. */
const PROTECTED_LABEL_LEN = 8;

/** tmux prepends 2 border chars before the format string. */
export const BORDER_PREFIX = 2;

/** Reserved columns for the menu button area: " ≡ ─". */
export const MENU_BUTTON_WIDTH = 1 + MENU_GLYPH_COLS + 1 + 1;

/** Available width for tab labels in the border row. */
export function borderMaxWidth(slotWidth: number): number {
  return Math.max(0, slotWidth - BORDER_PREFIX);
}

// ── Truncation helpers ────────────────────────────────────────────────

/** Build a tmux pane-border-format string showing tab labels. */
export function buildBorderFormat(tabs: PaneTab[], activeIndex: number, borderLines: string, maxWidth = 0): string {
  const chars = BORDER_CHARS[borderLines] ?? DEFAULT_BORDER;
  const { h, left, right } = chars;
  const visibleCount = computePaneTabVisible(tabs, maxWidth);
  const hasOverflow = visibleCount < tabs.length;

  let displayTabs = tabs;
  let displayActiveIndex = activeIndex;
  if (hasOverflow && activeIndex >= visibleCount) {
    displayTabs = [...tabs];
    const temp = displayTabs[visibleCount - 1]!;
    displayTabs[visibleCount - 1] = displayTabs[activeIndex]!;
    displayTabs[activeIndex] = temp;
    displayActiveIndex = visibleCount - 1;
  }

  const overflowCount = hasOverflow ? tabs.length - visibleCount : 0;
  const overflowCost = hasOverflow ? TAB_CHROME + stringWidth(`+${overflowCount}`) : 0;
  const available = maxWidth > 0 ? maxWidth - MENU_BUTTON_WIDTH : Infinity;

  const visibleLabels = displayTabs.slice(0, visibleCount).map((t) => stripNonPrintingControlChars(t.label));
  const displayLabels = Number.isFinite(available)
    ? computeDisplayLabels(visibleLabels, available, overflowCost)
    : visibleLabels;

  const parts: string[] = [];
  for (let i = 0; i < visibleCount; i++) {
    const displayLabel = escapeTmuxFormatLiteral(displayLabels[i]!);
    const style =
      i === displayActiveIndex
        ? `#{?pane_active,#[fg=${theme.accent}],#[fg=${theme.textDim}]}`
        : `#[fg=${theme.textDim}]`;
    parts.push(`${style}${left} ${displayLabel} ${right}#[default]${h}`);
  }

  if (hasOverflow) {
    parts.push(`#[fg=${theme.textDim}]${left} +${overflowCount} ${right}#[default]${h}`);
  }

  parts.push(`#[align=right]#{?pane_active,#[fg=${theme.textDim}] ${MENU_GLYPH} ,${h.repeat(3)}}#[default]${h}`);
  return parts.join("");
}

/** Build a border format with the drag target highlighted in reverse video. */
export function buildDragBorderFormat(
  tabs: PaneTab[],
  activeIndex: number,
  dragSlotIndex: number,
  borderLines: string,
  maxWidth = 0,
): string {
  const chars = BORDER_CHARS[borderLines] ?? DEFAULT_BORDER;
  const { h, left, right } = chars;
  const visibleCount = maxWidth > 0 ? computePaneTabVisible(tabs, maxWidth) : tabs.length;
  const count = Math.min(visibleCount, tabs.length);
  const hasOverflow = count < tabs.length;

  const overflowCount = hasOverflow ? tabs.length - count : 0;
  const overflowCost = hasOverflow ? TAB_CHROME + stringWidth(`+${overflowCount}`) : 0;
  const available = maxWidth > 0 ? maxWidth - MENU_BUTTON_WIDTH : Infinity;

  const visibleLabels = tabs.slice(0, count).map((t) => stripNonPrintingControlChars(t.label));
  const displayLabels = Number.isFinite(available)
    ? computeDisplayLabels(visibleLabels, available, overflowCost)
    : visibleLabels;

  const parts: string[] = [];

  for (let i = 0; i < count; i++) {
    const isActive = i === activeIndex;
    const displayLabel = escapeTmuxFormatLiteral(displayLabels[i]!);
    if (i === dragSlotIndex) {
      parts.push(`#[fg=${theme.accent},reverse]${left} ${displayLabel} ${right}#[default]${h}`);
    } else {
      const style = isActive
        ? `#{?pane_active,#[fg=${theme.accent}],#[fg=${theme.textDim}]}`
        : `#[fg=${theme.textDim}]`;
      parts.push(`${style}${left} ${displayLabel} ${right}#[default]${h}`);
    }
  }

  if (hasOverflow) {
    parts.push(`#[fg=${theme.textDim}]${left} +${overflowCount} ${right}#[default]${h}`);
  }

  parts.push(`#[align=right]#{?pane_active,#[fg=${theme.textDim}] ${MENU_GLYPH} ,${h.repeat(3)}}#[default]${h}`);
  return parts.join("");
}

// ── Visible-count & layout ────────────────────────────────────────────

/** Compute the drop index for a within-group tab reorder drag. */
export function computePaneTabDropIndex(tabs: PaneTab[], from: number, xOffset: number): number {
  const adjusted = xOffset - BORDER_PREFIX;
  const source = tabs[from];
  if (!source) return from;

  const halfWidth = Math.floor(paneTabWidth(source.label) / 2);
  let position = 0;
  let passed = 0;

  for (let i = 0; i < tabs.length; i++) {
    const tabWidth = paneTabWidth(tabs[i]!.label);
    if (i !== from) {
      const midpoint = position + Math.floor(tabWidth / 2);
      const edge = i > from ? adjusted + halfWidth : adjusted - halfWidth;
      if (edge >= midpoint) passed++;
    }
    position += tabWidth;
  }

  return passed;
}

/** Compute insertion index for a cross-group tab drop. */
export function computePaneTabInsertIndex(tabs: PaneTab[], xOffset: number): number {
  const adjusted = xOffset - BORDER_PREFIX;
  if (adjusted < 0) return 0;

  let position = 0;
  for (let i = 0; i < tabs.length; i++) {
    const tabWidth = paneTabWidth(tabs[i]!.label);
    const midpoint = position + Math.floor(tabWidth / 2);
    if (adjusted < midpoint) return i;
    position += tabWidth;
  }

  return tabs.length;
}

/** Compute how many tabs fit in the available width, reserving overflow space. */
export function computePaneTabVisible(tabs: PaneTab[], maxWidth: number): number {
  if (maxWidth <= 0) return tabs.length;

  // Reserve space for the right-aligned menu button so tabs don't overlap it.
  const available = maxWidth - MENU_BUTTON_WIDTH;

  // All tabs fit at full label width?
  let rawTotal = 0;
  for (const tab of tabs) rawTotal += TAB_CHROME + stringWidth(stripNonPrintingControlChars(tab.label));
  if (rawTotal <= available) return tabs.length;

  // All tabs fit at their minimum (truncated) widths?
  let minTotal = 0;
  for (const tab of tabs) minTotal += minTabWidth(tab.label);
  if (minTotal <= available) return tabs.length;

  // Need overflow: greedily add tabs (in order) until adding the next
  // would exceed available space even at minimum widths.
  let used = 0;
  for (let n = 0; n < tabs.length; n++) {
    const added = used + minTabWidth(tabs[n]!.label);
    if (added + OVERFLOW_WIDTH > available) return Math.max(1, n);
    used = added;
  }
  return tabs.length;
}

/**
 * Hit-test a pane border x-offset.
 * Returns a tab index, -1 (miss), -2 (overflow), or -3 (menu button).
 */
export function hitTestPaneTab(tabs: PaneTab[], xOffset: number, maxWidth = 0, activeIndex = -1): number {
  const adjusted = xOffset - BORDER_PREFIX;
  if (adjusted < 0) return -1;

  const visibleCount = maxWidth > 0 ? computePaneTabVisible(tabs, maxWidth) : tabs.length;
  const hasOverflow = visibleCount < tabs.length;

  if (maxWidth > 0 && adjusted >= maxWidth - MENU_BUTTON_WIDTH && adjusted <= maxWidth - BORDER_PREFIX) {
    return -3;
  }

  const swapped = hasOverflow && activeIndex >= 0 && activeIndex >= visibleCount;

  // Compute display labels matching what buildBorderFormat renders.
  let displayTabs = tabs;
  if (swapped) {
    displayTabs = [...tabs];
    const temp = displayTabs[visibleCount - 1]!;
    displayTabs[visibleCount - 1] = displayTabs[activeIndex]!;
    displayTabs[activeIndex] = temp;
  }

  const overflowCount = hasOverflow ? tabs.length - visibleCount : 0;
  const overflowCost = hasOverflow ? TAB_CHROME + stringWidth(`+${overflowCount}`) : 0;
  const available = maxWidth > 0 ? maxWidth - MENU_BUTTON_WIDTH : Infinity;
  const visibleLabels = displayTabs.slice(0, visibleCount).map((t) => stripNonPrintingControlChars(t.label));
  const displayLabels = Number.isFinite(available)
    ? computeDisplayLabels(visibleLabels, available, overflowCost)
    : visibleLabels;

  let column = 0;
  for (let i = 0; i < visibleCount; i++) {
    const originalIndex = swapped && i === visibleCount - 1 ? activeIndex : i;
    const width = TAB_CHROME + stringWidth(displayLabels[i]!);
    if (adjusted >= column && adjusted < column + width) {
      return originalIndex;
    }
    column += width;
  }

  if (hasOverflow) {
    const overflowWidth = TAB_CHROME + stringWidth(`+${tabs.length - visibleCount}`);
    if (adjusted >= column && adjusted < column + overflowWidth) {
      return -2;
    }
  }

  return -1;
}

// ── Border format builders ────────────────────────────────────────────

/** Width of a single tab in terminal columns: "┤ label ├─" */
export function paneTabWidth(label: string): number {
  label = stripNonPrintingControlChars(label);
  return TAB_CHROME + stringWidth(label);
}

/**
 * Compute display labels for a set of visible tabs within available space.
 * Returns the (possibly truncated) labels using water-fill distribution.
 */
function computeDisplayLabels(labels: string[], available: number, overflowCost: number): string[] {
  if (labels.length === 0) return [];
  const totalChrome = labels.length * TAB_CHROME + overflowCost;
  const budget = available - totalChrome;
  const totalRaw = labels.reduce((s, l) => s + stringWidth(l), 0);
  if (totalRaw <= budget) return [...labels];
  return waterFillTruncate(labels, Math.max(0, budget));
}

/** Minimum width a tab occupies when truncated as far as allowed. */
function minTabWidth(label: string): number {
  label = stripNonPrintingControlChars(label);
  return TAB_CHROME + Math.min(stringWidth(label), PROTECTED_LABEL_LEN);
}

/** Truncate a label so its display width never exceeds maxLen. */
function truncateLabel(label: string, maxLen: number): string {
  return truncateToWidth(label, maxLen);
}

/**
 * Distribute `budget` columns across `labels` using a water-fill algorithm.
 * Short labels keep their full width; the remaining budget is shared evenly
 * among longer labels.
 */
function waterFillTruncate(labels: string[], budget: number): string[] {
  const count = labels.length;
  if (count === 0) return [];
  if (budget <= 0) return labels.map(() => "");

  const totalRaw = labels.reduce((s, l) => s + stringWidth(l), 0);
  if (totalRaw <= budget) return [...labels];

  // Water-fill: shortest labels allocated first.  No label is truncated
  // below PROTECTED_LABEL_LEN (short labels that already fit within that
  // limit naturally keep their full length).
  const sorted = labels.map((l, i) => ({ i, len: stringWidth(l) })).sort((a, b) => a.len - b.len);
  const maxLens = new Array<number>(count);
  let rem = budget;
  let left = count;

  for (const { i, len } of sorted) {
    const share = Math.max(PROTECTED_LABEL_LEN, Math.floor(rem / left));
    const take = Math.min(len, share);
    maxLens[i] = take;
    rem -= take;
    left--;
  }

  return labels.map((l, i) => truncateLabel(l, maxLens[i]!));
}
