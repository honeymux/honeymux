import { useCallback, useEffect, useState } from "react";

import type { UIMode } from "../../util/config.ts";
import type { TmuxPaneCoreProps, TmuxPaneSharedProps } from "./types.ts";

import { getMaxExpandedMuxotronWidth } from "../../util/muxotron-size.ts";
import { stringWidth } from "../../util/text.ts";
import { computeOverflow } from "../tab-bar.tsx";

export interface PaneOverflowModel {
  handleOverflowClose: () => void;
  handleOverflowSelect: (index: number) => void;
  hasOverflow: boolean;
  overflowItemWidth: number;
  overflowOpen: boolean;
  overflowStartX: number;
  toggleOverflowOpen: () => void;
  visibleCount: number;
}

interface UsePaneOverflowOptions {
  activeIndex: number;
  activeWindowIdDisplayEnabled?: boolean;
  dropdownInputRef: TmuxPaneSharedProps["dropdownInputRef"];
  expandedMuxotronWidth?: number;
  leftReserve?: number;
  muxotronEnabled?: boolean;
  muxotronExpanded?: boolean;
  onNewWindow: TmuxPaneCoreProps["onNewWindow"];
  onTabClick: TmuxPaneCoreProps["onTabClick"];
  overflowOpenRef: TmuxPaneSharedProps["overflowOpenRef"];
  tabDragging: boolean;
  uiMode?: UIMode;
  width: number;
  windows: TmuxPaneCoreProps["windows"];
}

export function closeOverflowDropdown(
  dropdownInputRef: TmuxPaneSharedProps["dropdownInputRef"],
  setOverflowOpen: (open: boolean) => void,
): void {
  if (dropdownInputRef) dropdownInputRef.current = null;
  setOverflowOpen(false);
}

// Fixed 20-column name area (prefix + name padded to 24), then right-aligned ID column
export function computeOverflowItemWidth(overflowWindows: TmuxPaneCoreProps["windows"]): number {
  if (overflowWindows.length === 0) return 0;
  const maxIdLen = Math.max(...overflowWindows.map((w) => stringWidth(w.id)));
  // " ▸ " (3) + name padded to 20 + " " (1) + id + " " (1)
  return 3 + 20 + 1 + maxIdLen + 1;
}

export function selectOverflowTab({
  dropdownInputRef,
  index,
  onTabClick,
  setOverflowOpen,
}: {
  dropdownInputRef: TmuxPaneSharedProps["dropdownInputRef"];
  index: number;
  onTabClick: TmuxPaneCoreProps["onTabClick"];
  setOverflowOpen: (open: boolean) => void;
}): void {
  closeOverflowDropdown(dropdownInputRef, setOverflowOpen);
  onTabClick(index);
}

export function usePaneOverflow({
  activeIndex,
  activeWindowIdDisplayEnabled,
  dropdownInputRef,
  expandedMuxotronWidth,
  leftReserve,
  muxotronEnabled,
  muxotronExpanded,
  onNewWindow,
  onTabClick,
  overflowOpenRef,
  tabDragging,
  uiMode,
  width,
  windows,
}: UsePaneOverflowOptions): PaneOverflowModel {
  const [overflowOpen, setOverflowOpen] = useState(false);

  // When expanded, use the actual expanded muxotron width so that only
  // tabs overlapping the muxotron are collapsed into the overflow dropdown.
  // Fall back to the max-expanded cap (conservative) when the actual width
  // hasn't been reported yet, to avoid the tab bar using the collapsed width
  // which leaves too much room for tabs that the expanded muxotron will cover.
  const maxExpanded = getMaxExpandedMuxotronWidth(width, windows.length, leftReserve ?? 0);
  const muxotronEnabledWidthOverride = muxotronExpanded
    ? expandedMuxotronWidth && expandedMuxotronWidth > 0
      ? expandedMuxotronWidth
      : maxExpanded
    : undefined;
  const { overflowStartX, visibleCount } = computeOverflow(
    windows,
    width,
    !!onNewWindow,
    tabDragging,
    uiMode ?? "adaptive",
    muxotronEnabled,
    leftReserve,
    muxotronEnabledWidthOverride,
    activeIndex,
    activeWindowIdDisplayEnabled,
  );
  const overflowWindows = visibleCount < windows.length ? windows.slice(visibleCount) : [];
  const hasOverflow = overflowWindows.length > 0;

  useEffect(() => {
    if (!hasOverflow) setOverflowOpen(false);
  }, [hasOverflow]);

  if (overflowOpenRef) overflowOpenRef.current = overflowOpen;

  const overflowItemWidth = computeOverflowItemWidth(overflowWindows);

  const handleOverflowSelect = useCallback(
    (index: number) => {
      selectOverflowTab({
        dropdownInputRef,
        index,
        onTabClick,
        setOverflowOpen,
      });
    },
    [dropdownInputRef, onTabClick],
  );

  const handleOverflowClose = useCallback(() => {
    closeOverflowDropdown(dropdownInputRef, setOverflowOpen);
  }, [dropdownInputRef]);

  const toggleOverflowOpen = useCallback(() => {
    setOverflowOpen((prev) => !prev);
  }, []);

  return {
    handleOverflowClose,
    handleOverflowSelect,
    hasOverflow,
    overflowItemWidth,
    overflowOpen,
    overflowStartX,
    toggleOverflowOpen,
    visibleCount,
  };
}
