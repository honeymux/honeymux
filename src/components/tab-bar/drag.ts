import type { TmuxWindow } from "../../tmux/types.ts";

import { stripNonPrintingControlChars } from "../../util/text.ts";
import { tabWidth } from "./layout.ts";

interface ComputeDragDisplayStateOptions {
  activeIndex: number;
  dragFrom: null | number;
  dragOver: null | number;
  hasOverflow: boolean;
  visibleActiveIndex: number;
  visibleWindows: TmuxWindow[];
  windows: TmuxWindow[];
}

interface DragDisplayState {
  displayActiveIndex: number;
  displaySlotIndex: number;
  displayWindows: TmuxWindow[];
}

export function computeDragDisplayState({
  activeIndex,
  dragFrom,
  dragOver,
  hasOverflow,
  visibleActiveIndex,
  visibleWindows,
  windows,
}: ComputeDragDisplayStateOptions): DragDisplayState {
  let displayWindows = hasOverflow ? visibleWindows : windows;
  let displayActiveIndex = hasOverflow ? visibleActiveIndex : activeIndex;
  let displaySlotIndex = -1;

  if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
    const reordered = [...windows];
    const [moved] = reordered.splice(dragFrom, 1);
    reordered.splice(dragOver, 0, moved!);
    displayWindows = reordered;
    displaySlotIndex = dragOver;
    const activeWin = windows[activeIndex];
    if (activeWin) {
      displayActiveIndex = reordered.indexOf(activeWin);
    }
  } else if (dragFrom !== null) {
    displaySlotIndex = dragFrom;
  }

  return {
    displayActiveIndex,
    displaySlotIndex,
    displayWindows,
  };
}

export function computeDropIndexForDrag(
  windows: TmuxWindow[],
  from: number,
  x: number,
  leftReserve = 0,
  activeIndex = -1,
  activeWindowIdDisplayEnabled = false,
  displayNames?: string[],
): number {
  const source = windows[from];
  if (!source) return from;

  const sourceDisplayName = displayNames?.[from] ?? stripNonPrintingControlChars(source.name);
  const halfW = Math.floor(tabWidth(source, from === activeIndex, activeWindowIdDisplayEnabled, sourceDisplayName) / 2);
  let pos = leftReserve;
  let passed = 0;

  for (let i = 0; i < windows.length; i++) {
    if (i > 0) pos += 1;
    const displayName = displayNames?.[i] ?? stripNonPrintingControlChars(windows[i]!.name);
    const tabW = tabWidth(windows[i]!, i === activeIndex, activeWindowIdDisplayEnabled, displayName);
    if (i !== from) {
      const mid = pos + Math.floor(tabW / 2);
      const edge = i > from ? x + halfW : x - halfW;
      if (edge >= mid) passed++;
    }
    pos += tabW;
  }

  return passed;
}
