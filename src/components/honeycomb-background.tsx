import { type RGB, lerpRgb, rgbToHex } from "../themes/theme.ts";

const HEX = "⬢";
const CELL_W = 3;

const WAVE_BRIGHT: RGB = [255, 240, 180];
const FILLED_COLOR: RGB = [200, 155, 30];
const DIM_GOLD: RGB = [40, 30, 5];

export function HoneycombBackground({ height, width }: { height: number; width: number }) {
  const MARGIN = 1;
  const STAGGER = 1;
  const centerX = width / 2;
  const centerY = height / 2;
  const normX = width / 2;
  const normY = height; // height/2 * 2 — 2x Y stretch for terminal aspect ratio

  // Even rows: MARGIN on each side, filled with hex cells.
  // Odd rows: inset by STAGGER on both sides (MARGIN+STAGGER each side),
  // with one fewer hex, creating a zigzag on both edges.
  // Any leftover space is spread imperceptibly across inter-cell gaps.
  const evenAvail = width - 2 * MARGIN;
  const evenCols = Math.floor((evenAvail - 1) / CELL_W) + 1;
  const oddCols = evenCols - 1;

  type Cell = { content: string; fg: string };
  const rows: Cell[][] = [];
  for (let r = 0; r < height; r++) {
    const row: Cell[] = [];
    const isOddRow = r % 2 === 1;
    const cols = isOddRow ? oddCols : evenCols;
    const leftPad = isOddRow ? MARGIN + STAGGER : MARGIN;
    const rightPad = isOddRow ? MARGIN + STAGGER : MARGIN;
    const naturalW = (cols - 1) * CELL_W + 1;
    const slack = width - leftPad - naturalW - rightPad;

    // Distribute slack evenly across inter-cell gaps
    const gaps = cols - 1;
    const wideGaps = new Set<number>();
    const distributable = Math.max(0, Math.min(slack, gaps));
    if (distributable > 0) {
      for (let i = 0; i < distributable; i++) {
        wideGaps.add(Math.floor(((i + 1) * gaps) / (distributable + 1)));
      }
    }

    row.push({ content: " ".repeat(leftPad), fg: "" });

    let screenX = leftPad;
    for (let c = 0; c < cols; c++) {
      const dx = (screenX - centerX) / normX;
      const dy = (r - centerY) / normY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isLast = c === cols - 1;
      const gapExtra = !isLast && wideGaps.has(c) ? 1 : 0;
      const pad = isLast ? 0 : CELL_W - 1 + gapExtra;
      row.push({ content: HEX + " ".repeat(pad), fg: radialColor(clamp01(dist)) });
      screenX += 1 + pad;
    }

    rows.push(row);
  }

  return (
    <>
      {rows.map((row, r) => (
        <box flexDirection="row" height={1} key={r} width={width}>
          {row.map((cell, i) => (
            <text content={cell.content} fg={cell.fg} key={i} />
          ))}
        </box>
      ))}
    </>
  );
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function radialColor(dist: number): string {
  let c: RGB;
  if (dist < 0.3) {
    c = lerpRgb(WAVE_BRIGHT, FILLED_COLOR, clamp01(dist / 0.3));
  } else if (dist < 0.8) {
    c = lerpRgb(FILLED_COLOR, DIM_GOLD, clamp01((dist - 0.3) / 0.5));
  } else {
    c = lerpRgb(DIM_GOLD, WAVE_BRIGHT, clamp01((dist - 0.8) / 0.2));
  }
  return rgbToHex(c);
}
