import type { TmuxWindow } from "../../tmux/types.ts";
import type { UIMode } from "../../util/config.ts";

import { getMuxotronWidth } from "../../util/muxotron-size.ts";
import { stringWidth, stripNonPrintingControlChars, truncateToWidth } from "../../util/text.ts";

/** Labels at or below this length are never truncated by the water-fill. */
const PROTECTED_TAB_NAME_LEN = 8;
/** Tab chrome: "│ " + " │" = 4 columns. */
const TAB_NAME_CHROME = 4;

export function buildTabLines(
  windows: TmuxWindow[],
  activeIndex: number,
  totalWidth: number,
  badgeReserve = 0,
  badgeWidth = 0,
  showPlus = false,
  leftReserve = 0,
  activeWindowIdDisplayEnabled = false,
  displayNames?: string[],
): { bot: string; mid: string; midSegments: [string, string, string] | null; plusStartX: number; top: string } {
  let plusStartX = -1;

  if (windows.length === 0) {
    if (showPlus) {
      plusStartX = leftReserve + 1;
    }
    const remaining = totalWidth - 1;
    let bot: string;
    if (badgeWidth > 0 && remaining > badgeReserve) {
      const dashes = remaining - badgeReserve;
      bot = "─".repeat(dashes) + " ".repeat(badgeReserve) + "─";
    } else {
      bot = "─".repeat(totalWidth);
    }
    return {
      bot,
      mid: " ".repeat(totalWidth),
      midSegments: null,
      plusStartX,
      top: " ".repeat(totalWidth),
    };
  }

  let top = " ".repeat(leftReserve);
  let mid = " ".repeat(leftReserve);
  let bot = "─".repeat(leftReserve);
  // Track exact character index of the ID within mid for dim rendering
  let idCharStart = -1;
  let idCharEnd = -1;

  for (let i = 0; i < windows.length; i++) {
    const isActive = i === activeIndex;
    const displayName = displayNames?.[i] ?? displayWindowName(windows[i]!.name);
    const idStr = isActive && activeWindowIdDisplayEnabled ? windows[i]!.id : "";
    const name = idStr ? ` ${displayName} ${idStr} ` : ` ${displayName} `;
    const w = stringWidth(name);

    if (i > 0) {
      top += " ";
      mid += " ";
      bot += "─";
    }

    top += "╭" + "─".repeat(w) + "╮";
    if (idStr) {
      mid += "│" + ` ${displayName} `;
      idCharStart = mid.length;
      mid += idStr;
      idCharEnd = mid.length;
      mid += " │";
    } else {
      mid += "│" + name + "│";
    }

    if (isActive) {
      bot += (i === 0 ? "┴" : "┘") + " ".repeat(w) + "└";
    } else {
      bot += "┴" + "─".repeat(w) + "┴";
    }
  }

  if (showPlus) {
    plusStartX = stringWidth(mid) + 1;
  }

  const usedWidth = stringWidth(bot);
  const remaining = totalWidth - usedWidth - 1;

  if (remaining > 0) {
    if (badgeWidth > 0 && remaining > badgeReserve) {
      const dashes = remaining - badgeReserve;
      top += " ".repeat(remaining);
      mid += " ".repeat(remaining);
      bot += "─".repeat(dashes) + " ".repeat(badgeReserve);
    } else {
      top += " ".repeat(remaining);
      mid += " ".repeat(remaining);
      bot += "─".repeat(remaining);
    }
  }

  top += " ";
  mid += " ";
  bot += "─";

  const midSegments: [string, string, string] | null =
    idCharStart >= 0
      ? [mid.substring(0, idCharStart), mid.substring(idCharStart, idCharEnd), mid.substring(idCharEnd)]
      : null;

  return { bot, mid, midSegments, plusStartX, top };
}

// ── Truncation helpers ────────────────────────────────────────────────

/**
 * Compute how many tabs fit before the center muxotronEnabled, and where the overflow
 * indicator should be placed.
 */
export function computeOverflow(
  windows: TmuxWindow[],
  width: number,
  hasNewWindow: boolean,
  isDragging: boolean,
  uiMode: UIMode = "adaptive",
  muxotronEnabled = true,
  leftReserve = 0,
  muxotronEnabledWidthOverride?: number,
  activeIndex = -1,
  activeWindowIdDisplayEnabled = false,
  rightReserve = 0,
): { overflowStartX: number; visibleCount: number } {
  // When an explicit muxotronEnabled width is provided (e.g. the actual expanded width),
  // use it instead of the default collapsed width.
  const muxotronEnabledW = muxotronEnabledWidthOverride ?? getMuxotronWidth(width, uiMode, muxotronEnabled);
  // When the muxotron is hidden the tab area extends to where the session badge
  // begins; otherwise the muxotron sits centered and the tab area ends at its left edge.
  const muxotronEnabledLeft =
    muxotronEnabledW > 0 ? Math.floor((width - muxotronEnabledW) / 2) : Math.max(0, width - rightReserve);

  let visibleCount = windows.length;
  let overflowStartX = -1;

  if (!isDragging && windows.length > 1) {
    // Check if all tabs fit at full name length.
    let totalTabsW = 0;
    for (let i = 0; i < windows.length; i++) {
      if (i > 0) totalTabsW += 1;
      totalTabsW += tabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled);
    }
    const plusW = hasNewWindow ? 4 : 0;
    const plusGap = hasNewWindow ? 1 : 0;
    const effectiveMuxotronLeft = muxotronEnabledLeft - leftReserve;

    if (totalTabsW + plusGap + plusW + 2 > effectiveMuxotronLeft) {
      // Check if all tabs fit at their minimum (truncated) widths.
      let minTotalW = 0;
      for (let i = 0; i < windows.length; i++) {
        if (i > 0) minTotalW += 1;
        minTotalW += minTabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled);
      }

      if (minTotalW + plusGap + plusW + 2 <= effectiveMuxotronLeft) {
        // All tabs fit with truncation — no overflow needed.
        // visibleCount stays at windows.length, overflowStartX stays -1.
      } else {
        // Need overflow.
        // Reserve space for the "+N" indicator: │ +N │ = width("+N") + 4
        const maxOverflowLabel = muxotronEnabledWidthOverride != null ? `+${windows.length}` : `+${windows.length - 1}`;
        const indicatorW = stringWidth(maxOverflowLabel) + 4;
        const overflowReserve = indicatorW + 3 + (hasNewWindow ? 5 : 0);
        const maxTabsW = effectiveMuxotronLeft - overflowReserve;

        // Greedily add tabs using their minimum widths.
        let x = 0;
        visibleCount = 0;
        for (let i = 0; i < windows.length; i++) {
          if (i > 0) x += 1;
          const tw = minTabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled);
          if (x + tw > maxTabsW) break;
          x += tw;
          visibleCount++;
        }
        if (muxotronEnabledWidthOverride == null) visibleCount = Math.max(1, visibleCount);

        overflowStartX = leftReserve;
        for (let i = 0; i < visibleCount; i++) {
          if (i > 0) overflowStartX += 1;
          overflowStartX += minTabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled);
        }
        overflowStartX += 1;
      }
    }
  }

  return { overflowStartX, visibleCount };
}

/**
 * Compute dynamically-truncated display names for a set of window tabs.
 * `available` is the total pixel/column budget for all tabs including chrome
 * and gaps.  The active tab's ID suffix (when showId=true) is accounted for
 * before distributing name space via water-fill.
 */
export function computeTabDisplayNames(
  windows: TmuxWindow[],
  available: number,
  activeIndex = -1,
  showId = false,
): string[] {
  if (windows.length === 0) return [];

  // Fixed overhead: chrome per tab + gaps between tabs + active ID suffix
  let fixedCost = 0;
  for (let i = 0; i < windows.length; i++) {
    if (i > 0) fixedCost += 1; // gap
    fixedCost += TAB_NAME_CHROME;
    if (i === activeIndex && showId) fixedCost += 1 + stringWidth(windows[i]!.id);
  }

  const nameBudget = available - fixedCost;
  const names = windows.map((w) => displayWindowName(w.name));
  return waterFillTruncate(names, nameBudget);
}

// ── Width helpers ─────────────────────────────────────────────────────

export function tabBoundsFromIndex(
  windows: TmuxWindow[],
  index: number,
  leftReserve = 0,
  activeIndex = -1,
  activeWindowIdDisplayEnabled = false,
  displayNames?: string[],
): { left: number; width: number } | null {
  if (index < 0 || index >= windows.length) return null;
  let left = leftReserve;
  for (let i = 0; i < windows.length; i++) {
    if (i > 0) left += 1;
    const w = tabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled, displayNames?.[i]);
    if (i === index) {
      return { left, width: w };
    }
    left += w;
  }
  return null;
}

export function tabIndexFromX(
  windows: TmuxWindow[],
  x: number,
  leftReserve = 0,
  activeIndex = -1,
  activeWindowIdDisplayEnabled = false,
  displayNames?: string[],
): number {
  let pos = leftReserve;
  for (let i = 0; i < windows.length; i++) {
    if (i > 0) pos += 1;
    const tw = tabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled, displayNames?.[i]);
    if (x >= pos && x < pos + tw) {
      return i;
    }
    pos += tw;
  }
  return -1;
}

/** Width of a single tab including its border chars: │ name [id] │ */
export function tabWidth(w: TmuxWindow, isActive: boolean, showId = false, displayName?: string): number {
  const nameLen = displayName != null ? stringWidth(displayName) : stringWidth(displayWindowName(w.name));
  const base = nameLen + TAB_NAME_CHROME;
  return isActive && showId ? base + stringWidth(w.id) + 1 : base;
}

// ── Display names ─────────────────────────────────────────────────────

function displayWindowName(name: string): string {
  return stripNonPrintingControlChars(name);
}

// ── Overflow ──────────────────────────────────────────────────────────

/** Minimum display length for a name after truncation. */
function minNameLen(name: string): number {
  return Math.min(stringWidth(displayWindowName(name)), PROTECTED_TAB_NAME_LEN);
}

// ── Tab line rendering ────────────────────────────────────────────────

/** Minimum width of a tab when its name is truncated to the floor. */
function minTabWidth(w: TmuxWindow, isActive: boolean, showId: boolean): number {
  const base = minNameLen(w.name) + TAB_NAME_CHROME;
  return isActive && showId ? base + stringWidth(w.id) + 1 : base;
}

// ── Hit testing ───────────────────────────────────────────────────────

/** Truncate a label so its display width never exceeds maxLen. */
function truncateLabel(label: string, maxLen: number): string {
  return truncateToWidth(label, maxLen);
}

/**
 * Distribute `budget` columns across `names` using a water-fill algorithm.
 * No name is truncated below PROTECTED_TAB_NAME_LEN display columns.
 */
function waterFillTruncate(names: string[], budget: number): string[] {
  const count = names.length;
  if (count === 0) return [];
  if (budget <= 0) return names.map(() => "");

  const totalRaw = names.reduce((s, n) => s + stringWidth(n), 0);
  if (totalRaw <= budget) return [...names];

  const sorted = names.map((n, i) => ({ i, len: stringWidth(n) })).sort((a, b) => a.len - b.len);
  const maxLens = new Array<number>(count);
  let rem = budget;
  let left = count;

  for (const { i, len } of sorted) {
    const share = Math.max(PROTECTED_TAB_NAME_LEN, Math.floor(rem / left));
    const take = Math.min(len, share);
    maxLens[i] = take;
    rem -= take;
    left--;
  }

  return names.map((n, i) => truncateLabel(n, maxLens[i]!));
}
