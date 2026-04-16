export interface PromptClickRegion {
  cols: number;
  cursorX: number;
  cursorY: number;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
}

/**
 * Compute the cursor delta for a click inside the active wrapped prompt input.
 *
 * Coordinates are pane-local and 0-based.
 */
export function computePromptClickDelta(region: PromptClickRegion, targetX: number, targetY: number): null | number {
  const cursorOffset = computeOffset(region, region.cursorX, region.cursorY);
  const targetOffset = computeOffset(region, targetX, targetY);
  if (cursorOffset === null || targetOffset === null) return null;
  return targetOffset - cursorOffset;
}

function computeOffset(region: PromptClickRegion, rawX: number, y: number): null | number {
  const { cols, cursorX, cursorY, endX, endY, startX, startY } = region;

  if (cols <= 0) return null;
  if (endY < startY) return null;
  if (endY === startY && endX < startX) return null;
  if (cursorY < startY) return null;
  if (cursorY === startY && cursorX < startX) return null;
  if (y < startY || y > endY) return null;

  if (startY === endY) {
    const x = Math.min(Math.max(rawX, startX), endX);
    return x - startX;
  }

  if (y === startY) {
    const x = Math.min(Math.max(rawX, startX), cols - 1);
    return x - startX;
  }

  const wrappedOffset = cols - startX;
  if (y === endY) {
    const x = Math.min(Math.max(rawX, 0), endX);
    return wrappedOffset + (y - startY - 1) * cols + x;
  }

  const x = Math.min(Math.max(rawX, 0), cols - 1);
  return wrappedOffset + (y - startY - 1) * cols + x;
}
