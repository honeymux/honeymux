import { useEffect, useRef, useState } from "react";

import { theme } from "../themes/theme.ts";

/** Glow animation constants. */
const GLOW_STEPS = 6; // frames for accent→white (and same for white→accent)
const GLOW_MS = 200; // ms per frame
const PAUSE_FRAMES = 10; // 10 × 200ms = 2s pause at accent before next glow
const TOTAL_FRAMES = GLOW_STEPS * 2 + PAUSE_FRAMES;

/**
 * Shared glow animation for key capture UI.
 * Cycles: accent → white → accent, then pauses at accent.
 * Returns the current glow color (hex string) and interpolation factor.
 */
export function useCaptureGlow(capturing: boolean): { glowColor: string; glowT: number } {
  const glowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [glowIdx, setGlowIdx] = useState(0);

  useEffect(() => {
    if (capturing) {
      setGlowIdx(0);
      glowTimerRef.current = setInterval(() => {
        setGlowIdx((i) => (i + 1) % TOTAL_FRAMES);
      }, GLOW_MS);
      return () => {
        if (glowTimerRef.current) clearInterval(glowTimerRef.current);
      };
    }
    if (glowTimerRef.current) {
      clearInterval(glowTimerRef.current);
      glowTimerRef.current = null;
    }
  }, [capturing]);

  // Frames 0..5: accent→white, 6..11: white→accent, 12..21: pause at accent
  const glowT =
    glowIdx < GLOW_STEPS
      ? glowIdx / (GLOW_STEPS - 1)
      : glowIdx < GLOW_STEPS * 2
        ? (GLOW_STEPS * 2 - 1 - glowIdx) / (GLOW_STEPS - 1)
        : 0;

  const [r0, g0, b0] = theme.accentRgb;
  const r = Math.round(r0 + (255 - r0) * glowT);
  const g = Math.round(g0 + (255 - g0) * glowT);
  const b = Math.round(b0 + (255 - b0) * glowT);
  const glowColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  return { glowColor, glowT };
}
