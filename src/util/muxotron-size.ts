import type { UIMode } from "./config.ts";

import { isMarqueeMode } from "./config.ts";

/** Collapsed muxotronEnabled width (adaptive mode, no expansion). */
export const COLLAPSED_MUXOTRON_WIDTH = 27;
export const COLLAPSED_MUXOTRON_WIDTH_NARROW = 12;

/**
 * Maximum expanded-muxotronEnabled width that still leaves room for the overflow tab
 * on the left and the session badge on the right.
 *
 * Because the muxotronEnabled is centered, the binding constraint is whichever side
 * needs more space: maxWidth = termWidth − 2 × max(leftSpace, rightSpace).
 */
export function getMaxExpandedMuxotronWidth(
  termWidth: number,
  windowCount: number,
  leftReserve: number,
  rightReserve = 0,
): number {
  const overflowLabel = `+${windowCount}`;
  const overflowTabW = overflowLabel.length + 4; // │ +N │
  // Left of centered muxotronEnabled must fit: leftReserve + 1 (gap) + overflowTab + 1 (pad)
  const minLeftSpace = leftReserve + 1 + overflowTabW + 1;
  // Right of centered muxotronEnabled must fit: rightReserve (badge + toolbar + gap)
  const minRightSpace = rightReserve;
  const minSideSpace = Math.max(minLeftSpace, minRightSpace);
  return Math.max(COLLAPSED_MUXOTRON_WIDTH, termWidth - 2 * minSideSpace);
}

/** Total muxotronEnabled width including borders. */
export function getMuxotronWidth(termWidth: number, uiMode: UIMode, muxotronEnabled = true, expanded = false): number {
  if (uiMode === "raw") return 0;
  if (isMarqueeMode(uiMode)) return termWidth;
  // adaptive — respect muxotronEnabled toggle
  if (!muxotronEnabled) return 0;
  if (expanded) return termWidth;
  return termWidth >= 30 ? COLLAPSED_MUXOTRON_WIDTH : COLLAPSED_MUXOTRON_WIDTH_NARROW;
}
