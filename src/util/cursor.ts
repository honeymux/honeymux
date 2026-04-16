/**
 * Maps the DECSCUSR parameter (queried via DECRQSS in theme.ts) to a
 * tmux cursor-style option value, so tmux resets to the user's native
 * cursor shape instead of blinking block.
 */
import { terminalCursorParam } from "../themes/theme.ts";

export type TmuxCursorStyle = "bar" | "blinking-bar" | "blinking-block" | "blinking-underline" | "block" | "underline";

const DECSCUSR_TO_TMUX: Record<number, TmuxCursorStyle> = {
  1: "blinking-block",
  2: "block",
  3: "blinking-underline",
  4: "underline",
  5: "blinking-bar",
  6: "bar",
};

/** The outer terminal's native cursor style as a tmux option value. */
export function getTerminalCursorStyle(): TmuxCursorStyle | null {
  if (terminalCursorParam === null) return null;
  return DECSCUSR_TO_TMUX[terminalCursorParam] ?? null;
}
