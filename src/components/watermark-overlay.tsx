import type { UIMode, WatermarkShape } from "../util/config.ts";

import { theme } from "../themes/theme.ts";

export interface WatermarkOverlayProps {
  shape: WatermarkShape;
  sidebarOffset?: number;
  termCols: number;
  termRows: number;
  uiMode: UIMode;
  waitCount?: number;
  zIndex?: number;
}

const BEAR_FACE: { col: number; w: number }[][] = [
  [
    { col: 2, w: 8 },
    { col: 26, w: 8 },
  ],
  [
    { col: 1, w: 10 },
    { col: 25, w: 10 },
  ],
  [
    { col: 0, w: 10 },
    { col: 11, w: 14 },
    { col: 26, w: 10 },
  ],
  [{ col: 1, w: 34 }],
  [{ col: 1, w: 34 }],
  [
    { col: 1, w: 7 },
    { col: 11, w: 14 },
    { col: 28, w: 7 },
  ],
  [
    { col: 1, w: 7 },
    { col: 11, w: 14 },
    { col: 28, w: 7 },
  ],
  [{ col: 0, w: 36 }],
  [
    { col: 0, w: 15 },
    { col: 21, w: 15 },
  ],
  [
    { col: 0, w: 16 },
    { col: 20, w: 16 },
  ],
  [
    { col: 1, w: 15 },
    { col: 17, w: 2 },
    { col: 20, w: 15 },
  ],
  [{ col: 1, w: 34 }],
  [{ col: 3, w: 30 }],
  [{ col: 6, w: 24 }],
];

const HONEYCOMB: { col: number; w: number }[][] = [
  [
    { col: 4, w: 6 },
    { col: 18, w: 6 },
    { col: 32, w: 6 },
  ],
  [
    { col: 2, w: 10 },
    { col: 16, w: 10 },
    { col: 30, w: 10 },
  ],
  [
    { col: 2, w: 10 },
    { col: 16, w: 10 },
    { col: 30, w: 10 },
  ],
  [
    { col: 4, w: 6 },
    { col: 18, w: 6 },
    { col: 32, w: 6 },
  ],
  [
    { col: 11, w: 6 },
    { col: 25, w: 6 },
  ],
  [
    { col: 9, w: 10 },
    { col: 23, w: 10 },
  ],
  [
    { col: 9, w: 10 },
    { col: 23, w: 10 },
  ],
  [
    { col: 11, w: 6 },
    { col: 25, w: 6 },
  ],
  [
    { col: 4, w: 6 },
    { col: 18, w: 6 },
    { col: 32, w: 6 },
  ],
  [
    { col: 2, w: 10 },
    { col: 16, w: 10 },
    { col: 30, w: 10 },
  ],
  [
    { col: 2, w: 10 },
    { col: 16, w: 10 },
    { col: 30, w: 10 },
  ],
  [
    { col: 4, w: 6 },
    { col: 18, w: 6 },
    { col: 32, w: 6 },
  ],
];

const BEAR_PAW: { col: number; w: number }[][] = [
  [
    { col: 13, w: 2 },
    { col: 25, w: 2 },
  ],
  [
    { col: 12, w: 3 },
    { col: 25, w: 3 },
  ],
  [
    { col: 4, w: 2 },
    { col: 11, w: 4 },
    { col: 25, w: 4 },
    { col: 34, w: 2 },
  ],
  [
    { col: 3, w: 3 },
    { col: 34, w: 3 },
  ],
  [
    { col: 2, w: 4 },
    { col: 11, w: 6 },
    { col: 23, w: 6 },
    { col: 34, w: 4 },
  ],
  [
    { col: 1, w: 4 },
    { col: 10, w: 8 },
    { col: 22, w: 8 },
    { col: 35, w: 4 },
  ],
  [
    { col: 0, w: 6 },
    { col: 10, w: 8 },
    { col: 22, w: 8 },
    { col: 34, w: 6 },
  ],
  [
    { col: 0, w: 6 },
    { col: 11, w: 6 },
    { col: 23, w: 6 },
    { col: 34, w: 6 },
  ],
  [
    { col: 1, w: 4 },
    { col: 35, w: 4 },
  ],
  [],
  [
    { col: 6, w: 6 },
    { col: 16, w: 8 },
    { col: 28, w: 6 },
  ],
  [
    { col: 3, w: 10 },
    { col: 14, w: 12 },
    { col: 27, w: 10 },
  ],
  [{ col: 2, w: 36 }],
  [{ col: 1, w: 38 }],
  [{ col: 0, w: 40 }],
  [{ col: 1, w: 38 }],
  [{ col: 2, w: 36 }],
  [{ col: 4, w: 32 }],
  [{ col: 7, w: 26 }],
  [{ col: 11, w: 18 }],
];

// Mecha Octagon Wide digits (24 cols x 18 rows each)
const DIGIT_WIDTH = 24;
const DIGIT_HEIGHT = 18;
const DIGIT_SPACING = 2;

type Span = { col: number; w: number };

const DIGITS: Record<string, Span[][]> = {
  "0": [
    [{ col: 6, w: 12 }],
    [{ col: 4, w: 16 }],
    [{ col: 2, w: 20 }],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 2, w: 20 }],
    [{ col: 4, w: 16 }],
    [{ col: 6, w: 12 }],
  ],
  "1": [
    [{ col: 6, w: 10 }],
    [{ col: 4, w: 12 }],
    [{ col: 2, w: 14 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
  ],
  "2": [
    [{ col: 0, w: 18 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 22 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 16, w: 8 }],
    [{ col: 14, w: 8 }],
    [{ col: 12, w: 8 }],
    [{ col: 10, w: 8 }],
    [{ col: 8, w: 8 }],
    [{ col: 6, w: 8 }],
    [{ col: 4, w: 8 }],
    [{ col: 2, w: 8 }],
    [{ col: 0, w: 8 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
  ],
  "3": [
    [{ col: 0, w: 18 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 22 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 8, w: 16 }],
    [{ col: 10, w: 14 }],
    [{ col: 8, w: 16 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 0, w: 22 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 18 }],
  ],
  "4": [
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
  ],
  "5": [
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 22 }],
    [{ col: 0, w: 24 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 0, w: 22 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 18 }],
  ],
  "6": [
    [{ col: 6, w: 18 }],
    [{ col: 4, w: 20 }],
    [{ col: 2, w: 22 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 6 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 22 }],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 2, w: 22 }],
    [{ col: 4, w: 20 }],
    [{ col: 6, w: 18 }],
  ],
  "7": [
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 0, w: 24 }],
    [{ col: 18, w: 6 }],
    [{ col: 16, w: 6 }],
    [{ col: 14, w: 6 }],
    [{ col: 12, w: 6 }],
    [{ col: 10, w: 6 }],
    [{ col: 8, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
    [{ col: 6, w: 6 }],
  ],
  "8": [
    [{ col: 6, w: 12 }],
    [{ col: 4, w: 16 }],
    [{ col: 2, w: 20 }],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 2, w: 20 }],
    [{ col: 4, w: 16 }],
    [{ col: 2, w: 20 }],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 2, w: 20 }],
    [{ col: 4, w: 16 }],
    [{ col: 6, w: 12 }],
  ],
  "9": [
    [{ col: 0, w: 18 }],
    [{ col: 0, w: 20 }],
    [{ col: 0, w: 22 }],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [
      { col: 0, w: 6 },
      { col: 18, w: 6 },
    ],
    [{ col: 2, w: 22 }],
    [{ col: 4, w: 20 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 18, w: 6 }],
    [{ col: 2, w: 22 }],
    [{ col: 4, w: 20 }],
    [{ col: 6, w: 18 }],
  ],
};

/** Compose digit shapes side-by-side for a given number. */
function composeDigits(n: number): { height: number; rows: Span[][]; width: number } | null {
  const text = String(Math.max(0, Math.floor(n)));
  const digitCount = text.length;
  const totalWidth = digitCount * DIGIT_WIDTH + (digitCount - 1) * DIGIT_SPACING;

  const rows: Span[][] = [];
  for (let row = 0; row < DIGIT_HEIGHT; row++) {
    const spans: Span[] = [];
    for (let d = 0; d < digitCount; d++) {
      const digitShape = DIGITS[text[d]!];
      if (!digitShape) return null;
      const offset = d * (DIGIT_WIDTH + DIGIT_SPACING);
      const digitRow = digitShape[row] || [];
      for (const span of digitRow) {
        spans.push({ col: span.col + offset, w: span.w });
      }
    }
    rows.push(spans);
  }

  return { height: DIGIT_HEIGHT, rows, width: totalWidth };
}

const SHAPES: Record<
  Exclude<WatermarkShape, "off" | "unanswered count">,
  { height: number; shape: Span[][]; width: number }
> = {
  "bear face": { height: 14, shape: BEAR_FACE, width: 36 },
  "bear paw": { height: 20, shape: BEAR_PAW, width: 40 },
  honeycomb: { height: 12, shape: HONEYCOMB, width: 40 },
};

export function WatermarkOverlay({
  shape,
  sidebarOffset = 0,
  termCols,
  termRows,
  uiMode,
  waitCount = 0,
  zIndex = 3,
}: WatermarkOverlayProps) {
  if (shape === "off") return null;

  let rows: Span[][];
  let shapeWidth: number;
  let shapeHeight: number;

  if (shape === "unanswered count") {
    const composed = composeDigits(waitCount);
    if (!composed) return null;
    rows = composed.rows;
    shapeWidth = composed.width;
    shapeHeight = composed.height;
  } else {
    const shapeData = SHAPES[shape];
    if (!shapeData) return null;
    rows = shapeData.shape;
    shapeWidth = shapeData.width;
    shapeHeight = shapeData.height;
  }

  if (termCols < shapeWidth || termRows < shapeHeight) return null;

  // Same origin offset pattern as RootWarningOverlay
  const originTop = uiMode === "raw" ? 0 : 3;
  const originLeft = sidebarOffset;

  // Center the shape in the terminal content area
  const centerCol = Math.floor((termCols - shapeWidth) / 2);
  const centerRow = Math.floor((termRows - shapeHeight) / 2);

  const baseTop = originTop + centerRow;
  const baseLeft = originLeft + centerCol;

  // ~30% alpha tint
  const tintColor = theme.border + "4d";

  return (
    <>
      {rows.map((spans, row) =>
        spans.map((span, i) => (
          <box
            backgroundColor={tintColor}
            height={1}
            key={`${row}-${i}`}
            left={baseLeft + span.col}
            position="absolute"
            top={baseTop + row}
            width={span.w}
            zIndex={zIndex}
          />
        )),
      )}
    </>
  );
}
