/**
 * Box-drawing character cycling animation ("scribble" effect).
 * 3-phase character map:
 *   Phase 0: Normal (rounded light) — ╭╮╰╯│─┴┘└
 *   Phase 1: Heavy dashed — ┏┓┗┛┇┅┻┛┗
 *   Phase 2: Heavy solid — ┏┓┗┛┃━┻┛┗
 *
 * Each position is staggered by 1 phase, creating a rightward wave.
 */

/** Maps box-drawing char → [phase1 variant, phase2 variant] */
const SCRIBBLE_MAP: Record<string, [string, string]> = {
  "─": ["┅", "━"],
  "━": ["─", "┅"],
  "│": ["┇", "┃"],
  "┃": ["│", "┇"],
  // Heavy variants (Anamorphic Equalizer base chars) cycle through dashed/light
  "┏": ["╭", "┏"],
  "┓": ["╮", "┓"],
  "└": ["┗", "┗"],
  "┗": ["╰", "┗"],
  "┘": ["┛", "┛"],
  "┛": ["╯", "┛"],
  "┴": ["┻", "┻"],
  "┻": ["┴", "┻"],
  "╭": ["┏", "┏"],
  "╮": ["┓", "┓"],
  "╯": ["┛", "┛"],
  "╰": ["┗", "┗"],
};

/** Wave effect — each character position staggered by 1 phase (moves rightward). */
export function scribbleCycle(text: string, now: number, intervalMs = 169): string {
  const basePhase = Math.floor(now / intervalMs) % 3;
  const result: string[] = [];
  for (let i = 0; i < text.length; i++) {
    result.push(applyPhase(text[i]!, (((basePhase - i) % 3) + 3) % 3));
  }
  return result.join("");
}

function applyPhase(ch: string, phase: number): string {
  const variants = SCRIBBLE_MAP[ch];
  if (!variants) return ch;
  switch (phase) {
    case 1:
      return variants[0];
    case 2:
      return variants[1];
    default:
      return ch;
  }
}
