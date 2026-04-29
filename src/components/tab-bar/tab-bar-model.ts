import type { TmuxWindow } from "../../tmux/types.ts";
import type { UIMode } from "../../util/config.ts";

import { getMaxExpandedMuxotronWidth, getMuxotronWidth } from "../../util/muxotron-size.ts";
import { overlayAtColumn, stringWidth, stripNonPrintingControlChars, truncateName } from "../../util/text.ts";
import { computeDragDisplayState } from "./drag.ts";
import { buildTabLines, computeOverflow, computeTabDisplayNames, tabBoundsFromIndex, tabWidth } from "./layout.ts";

const MAX_SESSION_DISPLAY = 10;

export interface BuildTabBarModelOptions {
  activeIndex: number;
  activeWindowIdDisplayEnabled?: boolean;
  dragFrom: null | number;
  dragOver: null | number;
  dragX: null | number;
  expandedMuxotronWidth?: number;
  hasLayoutProfileClick: boolean;
  hasNewWindow: boolean;
  hasSidebarToggle: boolean;
  hasToolbarToggle: boolean;
  muxotronEnabledProp?: boolean;
  muxotronExpanded?: boolean;
  ptyDragging: boolean;
  sessionName?: string;
  uiMode: UIMode;
  width: number;
  windows: TmuxWindow[];
}

export interface TabBarActiveIdOverlay {
  id: string;
  left: number;
}

export interface TabBarModel {
  activeHiddenInOverflow: boolean;
  activeIdOverlay: TabBarActiveIdOverlay | null;
  badgeLabel: null | string;
  badgeReserve: number;
  badgeWidth: number;
  bot: string;
  displayActiveIndex: number;
  displayNames: string[];
  displayWindows: TmuxWindow[];
  hasOverflow: boolean;
  hintGap: number;
  maxExpandedWidth: number;
  mid: string;
  midSegments: [string, string, string] | null;
  muxotronEnabled: boolean;
  muxotronLeft: number;
  muxotronRight: number;
  muxotronWidth: number;
  overflowIndicatorWidth: number;
  overflowLabel: string;
  overflowStartX: number;
  overflowWindows: TmuxWindow[];
  plusStartX: number;
  showId: boolean;
  sidebarReserve: number;
  tabsEndX: number;
  toolbarIconReserve: number;
  toolbarReserve: number;
  top: string;
  visibleCount: number;
  visibleWindows: TmuxWindow[];
  windowDisplayNames: string[];
}

export function buildTabBarModel({
  activeIndex,
  activeWindowIdDisplayEnabled,
  dragFrom,
  dragOver,
  dragX,
  expandedMuxotronWidth = 0,
  hasLayoutProfileClick,
  hasNewWindow,
  hasSidebarToggle,
  hasToolbarToggle,
  muxotronEnabledProp,
  muxotronExpanded,
  ptyDragging,
  sessionName,
  uiMode,
  width,
  windows,
}: BuildTabBarModelOptions): TabBarModel {
  const displayName = sessionName ? truncateName(stripNonPrintingControlChars(sessionName), MAX_SESSION_DISPLAY) : null;
  const badgeLabel = displayName ? ` ${displayName} ▾ ` : null;
  const badgeWidth = badgeLabel != null ? stringWidth(badgeLabel) : 0;

  const sidebarReserve = hasSidebarToggle ? 2 : 0;
  const toolbarIconReserve = hasToolbarToggle ? 3 : 0;
  const profileReserve = hasLayoutProfileClick ? 3 : 0;
  const toolbarReserve = toolbarIconReserve + profileReserve;
  const badgeReserve = computeTabBarBadgeReserve({ hasLayoutProfileClick, hasToolbarToggle, ptyDragging, sessionName });

  const muxotronEnabled = muxotronEnabledProp !== false;
  const muxotronWidth = getMuxotronWidth(width, uiMode, muxotronEnabled, false);
  const muxotronRight = Math.floor((width - muxotronWidth) / 2) + muxotronWidth;
  const badgeLeft = width - toolbarReserve - 1 - badgeWidth;

  const isDragging = dragFrom !== null && dragX !== null;
  const badgeRightReserve = badgeWidth > 0 ? badgeWidth + toolbarReserve + 4 : toolbarReserve;
  const maxExpandedWidth = getMaxExpandedMuxotronWidth(width, windows.length, sidebarReserve, badgeRightReserve);
  const muxotronWidthOverride =
    muxotronExpanded && expandedMuxotronWidth <= 0
      ? maxExpandedWidth
      : muxotronExpanded
        ? expandedMuxotronWidth
        : undefined;
  const showId = activeWindowIdDisplayEnabled ?? false;
  const { overflowStartX: rawOverflowStartX, visibleCount } = computeOverflow(
    windows,
    width,
    hasNewWindow,
    isDragging,
    uiMode,
    muxotronEnabled,
    sidebarReserve,
    muxotronWidthOverride,
    activeIndex,
    showId,
    badgeReserve,
  );

  const visibleWindows = visibleCount < windows.length ? windows.slice(0, visibleCount) : windows;
  const overflowWindows = visibleCount < windows.length ? windows.slice(visibleCount) : [];
  const hasOverflow = overflowWindows.length > 0;
  const visibleActiveIndex = hasOverflow && activeIndex >= visibleCount ? -1 : activeIndex;
  const activeHiddenInOverflow = activeIndex >= visibleCount;

  const { displayActiveIndex, displaySlotIndex, displayWindows } = computeDragDisplayState({
    activeIndex,
    dragFrom,
    dragOver,
    hasOverflow,
    visibleActiveIndex,
    visibleWindows,
    windows,
  });

  const effectiveMuxotronWidth = muxotronWidthOverride ?? getMuxotronWidth(width, uiMode, muxotronEnabled, false);
  // When the muxotron is hidden, the tab area extends past the screen center
  // to where the session badge starts. Otherwise it ends at the muxotron's left edge.
  const tabAreaRightEdge =
    effectiveMuxotronWidth > 0 ? Math.floor((width - effectiveMuxotronWidth) / 2) : Math.max(0, width - badgeReserve);
  const tabAreaWidth = tabAreaRightEdge - sidebarReserve;
  const overflowLabel = `+${overflowWindows.length}`;
  const overflowIndicatorWidth = stringWidth(overflowLabel) + 4;
  const plusCost = hasNewWindow && !hasOverflow ? 5 : 0;
  const overflowCost = hasOverflow ? overflowIndicatorWidth + 3 + (hasNewWindow ? 5 : 0) : 0;
  const displayNames = computeTabDisplayNames(
    displayWindows,
    tabAreaWidth - plusCost - overflowCost - 2,
    displayActiveIndex,
    showId,
  );
  const windowDisplayNames = windows.map((window) => {
    const displayIndex = displayWindows.findIndex((candidate) => candidate === window);
    return displayIndex >= 0
      ? (displayNames[displayIndex] ?? stripNonPrintingControlChars(window.name))
      : stripNonPrintingControlChars(window.name);
  });

  const overflowStartX = computeRenderedOverflowStartX(
    hasOverflow,
    rawOverflowStartX,
    sidebarReserve,
    displayWindows,
    displayActiveIndex,
    showId,
    displayNames,
  );

  const {
    bot: rawBot,
    mid: rawMid,
    midSegments: rawMidSegments,
    plusStartX: basePlusStartX,
    top: rawTop,
  } = buildTabLines(
    displayWindows,
    displayActiveIndex,
    width,
    badgeReserve,
    ptyDragging ? 0 : badgeWidth,
    hasNewWindow && !hasOverflow,
    sidebarReserve,
    showId,
    displayNames,
  );

  const { bot, mid, top } = composeDragOverlay({
    activeIndex,
    displayActiveIndex,
    displayNames,
    displaySlotIndex,
    displayWindows,
    dragFrom,
    dragX,
    rawBot,
    rawMid,
    rawTop,
    showId,
    sidebarReserve,
    width,
    windows,
  });

  const plusStartX =
    hasOverflow && hasNewWindow && overflowStartX >= 0 ? overflowStartX + overflowIndicatorWidth + 1 : basePlusStartX;

  // Compute tabsEndX — rightmost extent of the tab area (tabs + overflow + plus)
  const muxotronLeft = muxotronRight - muxotronWidth;
  let tabsEndX: number;
  if (plusStartX >= 0) {
    tabsEndX = plusStartX + 3; // PLUS_GLYPH " ✚ " is 3 columns
  } else if (hasOverflow && overflowStartX >= 0) {
    tabsEndX = overflowStartX + overflowIndicatorWidth;
  } else {
    tabsEndX = sidebarReserve;
    for (let i = 0; i < displayWindows.length; i++) {
      if (i > 0) tabsEndX += 1;
      tabsEndX += tabWidth(displayWindows[i]!, i === displayActiveIndex, showId, displayNames[i]);
    }
  }

  const hintGap = badgeLeft - muxotronRight;

  return {
    activeHiddenInOverflow,
    activeIdOverlay: buildActiveIdOverlay(displayWindows, displayActiveIndex, sidebarReserve, showId, displayNames),
    badgeLabel,
    badgeReserve,
    badgeWidth,
    bot,
    displayActiveIndex,
    displayNames,
    displayWindows,
    hasOverflow,
    hintGap,
    maxExpandedWidth,
    mid,
    // midSegments are invalidated by drag overlay (which modifies the mid string)
    midSegments: dragFrom !== null && dragX !== null ? null : rawMidSegments,
    muxotronEnabled,
    muxotronLeft,
    muxotronRight,
    muxotronWidth,
    overflowIndicatorWidth,
    overflowLabel,
    overflowStartX,
    overflowWindows,
    plusStartX,
    showId,
    sidebarReserve,
    tabsEndX,
    toolbarIconReserve,
    toolbarReserve,
    top,
    visibleCount,
    visibleWindows,
    windowDisplayNames,
  };
}

/**
 * Width reserved on the right for the session badge + toolbar icons. Used as
 * the right edge of the tab area when the muxotron is hidden so tabs can
 * extend across the screen instead of being capped at the centered slot.
 */
export function computeTabBarBadgeReserve(opts: {
  hasLayoutProfileClick: boolean;
  hasToolbarToggle: boolean;
  ptyDragging: boolean;
  sessionName?: string;
}): number {
  const { hasLayoutProfileClick, hasToolbarToggle, ptyDragging, sessionName } = opts;
  const displayName = sessionName ? truncateName(stripNonPrintingControlChars(sessionName), MAX_SESSION_DISPLAY) : null;
  const badgeLabel = displayName ? ` ${displayName} ▾ ` : null;
  const badgeWidth = badgeLabel != null ? stringWidth(badgeLabel) : 0;
  const toolbarIconReserve = hasToolbarToggle ? 3 : 0;
  const profileReserve = hasLayoutProfileClick ? 3 : 0;
  const toolbarReserve = toolbarIconReserve + profileReserve;
  return (badgeWidth > 0 && !ptyDragging ? badgeWidth + 2 : 0) + toolbarReserve;
}

function buildActiveIdOverlay(
  displayWindows: TmuxWindow[],
  displayActiveIndex: number,
  sidebarReserve: number,
  showId: boolean,
  displayNames: string[],
): TabBarActiveIdOverlay | null {
  if (!showId || displayActiveIndex < 0 || displayActiveIndex >= displayWindows.length) return null;

  const activeWindow = displayWindows[displayActiveIndex];
  if (!activeWindow) return null;

  const bounds = tabBoundsFromIndex(
    displayWindows,
    displayActiveIndex,
    sidebarReserve,
    displayActiveIndex,
    showId,
    displayNames,
  );
  if (!bounds) return null;

  const nameLength = stringWidth(displayNames[displayActiveIndex] ?? stripNonPrintingControlChars(activeWindow.name));
  return {
    id: activeWindow.id,
    left: bounds.left + 1 + 1 + nameLength + 1,
  };
}

function composeDragOverlay({
  activeIndex,
  displayActiveIndex,
  displayNames,
  displaySlotIndex,
  displayWindows,
  dragFrom,
  dragX,
  rawBot,
  rawMid,
  rawTop,
  showId,
  sidebarReserve,
  width,
  windows,
}: {
  activeIndex: number;
  displayActiveIndex: number;
  displayNames: string[];
  displaySlotIndex: number;
  displayWindows: TmuxWindow[];
  dragFrom: null | number;
  dragX: null | number;
  rawBot: string;
  rawMid: string;
  rawTop: string;
  showId: boolean;
  sidebarReserve: number;
  width: number;
  windows: TmuxWindow[];
}): { bot: string; mid: string; top: string } {
  let top = rawTop;
  let mid = rawMid;
  let bot = rawBot;

  if (dragFrom === null || dragX === null || dragFrom < 0 || dragFrom >= windows.length) {
    return { bot, mid, top };
  }

  const draggedWindow = windows[dragFrom];
  if (!draggedWindow) return { bot, mid, top };

  const isDraggedActive = dragFrom === activeIndex;
  const dragDisplayIdx = displayWindows.findIndex((window) => window === draggedWindow);
  const dragName =
    dragDisplayIdx >= 0
      ? (displayNames[dragDisplayIdx] ?? stripNonPrintingControlChars(draggedWindow.name))
      : stripNonPrintingControlChars(draggedWindow.name);
  const dragTabName = isDraggedActive && showId ? ` ${dragName} ${draggedWindow.id} ` : ` ${dragName} `;
  const dragWidth = stringWidth(dragTabName);
  const floatWidth = dragWidth + 2;
  const floatLeft = Math.max(0, Math.min(dragX - Math.floor(floatWidth / 2), width - floatWidth));

  const slotIndex = displaySlotIndex >= 0 ? displaySlotIndex : dragFrom;
  const slotWindow = displayWindows[slotIndex];
  if (!slotWindow) return { bot, mid, top };

  let slotX = sidebarReserve;
  for (let i = 0; i < slotIndex; i++) {
    const window = displayWindows[i];
    if (!window) continue;
    if (i > 0) slotX += 1;
    slotX += tabWidth(window, i === displayActiveIndex, showId, displayNames[i]);
  }
  if (slotIndex > 0) slotX += 1;

  const slotWidth = tabWidth(slotWindow, slotIndex === displayActiveIndex, showId, displayNames[slotIndex]);

  top = overlayAtColumn(top, slotX, " ".repeat(slotWidth));
  mid = overlayAtColumn(mid, slotX, " ".repeat(slotWidth));
  bot = overlayAtColumn(bot, slotX, "─".repeat(slotWidth));

  top = overlayAtColumn(top, floatLeft, "╭" + "─".repeat(dragWidth) + "╮");
  mid = overlayAtColumn(mid, floatLeft, "│" + dragTabName + "│");
  bot = overlayAtColumn(bot, floatLeft, "╰" + "─".repeat(dragWidth) + "╯");

  return { bot, mid, top };
}

function computeRenderedOverflowStartX(
  hasOverflow: boolean,
  rawOverflowStartX: number,
  sidebarReserve: number,
  displayWindows: TmuxWindow[],
  displayActiveIndex: number,
  showId: boolean,
  displayNames: string[],
): number {
  if (!hasOverflow || rawOverflowStartX < 0) return rawOverflowStartX;

  let x = sidebarReserve;
  for (let i = 0; i < displayWindows.length; i++) {
    const window = displayWindows[i];
    if (!window) continue;
    if (i > 0) x += 1;
    x += tabWidth(window, i === displayActiveIndex, showId, displayNames[i]);
  }
  return x + 1;
}
