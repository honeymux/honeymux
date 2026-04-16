/**
 * Anamorphic Equalizer scanner bar.
 *
 * Mimics the original Larson scanner effect: a bright leading edge sweeps
 * back and forth, leaving an asymmetric exponentially-decaying trail behind
 * it (like halogen afterglow). No glow ahead of the scan head.
 */
import { hexToRgb, lerpRgb, rgbToHex } from "../themes/theme.ts";

export const EQ_BRIGHT = "#ff0000";
export const EQ_DIM = "#330000";
export const EQ_BORDER = "#881111";

const TRAIL_LENGTH = 8;
// Exponential decay factor per cell of distance behind the head.
// 0.55 gives roughly: 100%, 55%, 30%, 17%, 9%, 5%, 3%, 1%
const DECAY = 0.55;

const brightRgb = hexToRgb(EQ_BRIGHT);
const dimRgb = hexToRgb(EQ_DIM);

/**
 * Compute per-cell hex colors for the scanner bar.
 *
 * The scan head is the brightest point. Cells behind it (in the direction
 * it came from) decay exponentially. Cells ahead of it stay dark.
 *
 * @param inner  Number of inner cells (muxotronEnabled width minus 2 corners)
 * @param phase  Sweep phase, 0–1: 0 = left end, 0.5 = right end, 1 = back to left
 * @returns      Array of hex color strings, one per inner cell
 */
export function computeScannerColors(inner: number, phase: number): string[] {
  if (inner <= 0) return [];

  // Triangle wave: bounces 0 → inner-1 → 0 over one phase cycle
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const pos = tri * (inner - 1);

  // Scan direction: +1 = moving right (first half), -1 = moving left (second half)
  const scanDir = phase < 0.5 ? 1 : -1;

  const colors: string[] = new Array(inner);
  for (let i = 0; i < inner; i++) {
    // Signed distance: positive = cell is behind the scan head (trail side)
    const behind = (pos - i) * scanDir;

    if (behind < -0.5) {
      // Ahead of the scan head — dark
      colors[i] = EQ_DIM;
    } else if (behind <= 0.5) {
      // The scan head itself (within ±0.5 cell of pos)
      colors[i] = EQ_BRIGHT;
    } else if (behind <= TRAIL_LENGTH) {
      // Trailing afterglow: exponential decay
      const t = Math.pow(DECAY, behind);
      colors[i] = rgbToHex(lerpRgb(dimRgb, brightRgb, t));
    } else {
      colors[i] = EQ_DIM;
    }
  }
  return colors;
}
