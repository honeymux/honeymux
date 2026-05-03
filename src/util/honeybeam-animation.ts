import { type RGB } from "../themes/theme.ts";
import { writeTerminalOutput } from "./terminal-output.ts";

export type PaneBorderLines = "double" | "heavy" | "number" | "simple" | "single";

interface HoneybeamDims {
  height: number;
  rows: number;
}

interface HoneybeamOptions {
  accentColor: string;
  /** tmux pane-border-lines style, defaults to "single". */
  borderLines?: PaneBorderLines;
  /** Offset to convert pane col to full-terminal col */
  colOffset: number;
  direction: "horizontal" | "vertical";
  /** Optional right clip (inclusive, absolute terminal column). */
  maxCol?: number;
  paneHeight: number;
  /** Pane left in tmux coordinates (0-indexed within pane area) */
  paneLeft: number;
  /** Pane top in tmux coordinates (0-indexed within pane area) */
  paneTop: number;
  paneWidth: number;
  /** Offset to convert pane row to full-terminal row */
  rowOffset: number;
}

interface HoneybeamViewport {
  width: number;
}

/** Map tmux pane-border-lines style to vertical and horizontal characters. */
export function borderCharsForStyle(style: PaneBorderLines): { horizontal: string; vertical: string } {
  switch (style) {
    case "double":
      return { horizontal: "\u2550", vertical: "\u2551" }; // ║ ═
    case "heavy":
      return { horizontal: "\u2501", vertical: "\u2503" }; // ┃ ━
    case "simple":
      return { horizontal: "-", vertical: "|" };
    case "number":
    case "single":
    default:
      return { horizontal: "\u2500", vertical: "\u2502" }; // │ ─
  }
}

/** Convert a display-formatted key name (e.g. "ctrl+b", "%") to its raw terminal sequence. */
export function displayKeyToSequence(key: string): null | string {
  const lower = key.toLowerCase();
  if (lower === "enter") return "\r";
  if (lower === "escape" || lower === "esc") return "\x1b";
  if (lower === "tab") return "\t";
  if (lower === "space") return " ";
  if (lower === "backspace" || lower === "bspace") return "\x7f";
  if (lower === "ctrl+space" || lower === "ctrl-space") return "\x00";
  const ctrlMatch = key.match(/^ctrl[+-](.)/i);
  if (ctrlMatch) {
    return String.fromCharCode(ctrlMatch[1]!.toLowerCase().charCodeAt(0) - 96);
  }
  const altMatch = key.match(/^alt[+-](.)/i);
  if (altMatch) {
    return "\x1b" + altMatch[1]!;
  }
  return key.length === 1 ? key : null;
}

const HONEYBEAM_TOOLBAR_WIDTH = 7;

/**
 * When the right-side toolbar is open, clip beam drawing so direct ANSI output
 * cannot overpaint the toolbar overlay.
 */
export function computeHoneybeamMaxCol(
  viewport: HoneybeamViewport,
  toolbarOpen: boolean,
  sidebarOffset = 0,
): number | undefined {
  if (!toolbarOpen && sidebarOffset === 0) return undefined;
  const rightClip = toolbarOpen ? HONEYBEAM_TOOLBAR_WIDTH + 2 : 0;
  return Math.max(0, viewport.width - rightClip);
}

/**
 * Convert pane-local tmux coordinates to absolute screen coordinates.
 * Keep this in sync with the terminal content area origin (no left tool bar).
 */
export function computeHoneybeamOffsets(
  dims: HoneybeamDims,
  sidebarOffset = 0,
): { colOffset: number; rowOffset: number } {
  return {
    colOffset: sidebarOffset,
    rowOffset: Math.max(0, dims.height - dims.rows),
  };
}

// Synchronized output — terminal buffers all writes between begin/end
// and paints atomically, eliminating flicker.
const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

function moveCursor(row: number, col: number): string {
  return `\x1b[${row + 1};${col + 1}H`;
}

function setFg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

// ── Beam trail gradient ─────────────────────────────────────────────────
// White → light yellow → dark yellow → orange, then fading to ember.
const TRAIL_LENGTH = 8;
const BEAM_GRADIENT: RGB[] = [
  [255, 255, 255], // 0: white (head — color only, char is pulsing dot)
  [255, 255, 220], // 1: near-white
  [255, 250, 170], // 2: light yellow
  [255, 240, 100], // 3: yellow
  [255, 220, 50], // 4: dark yellow
  [255, 180, 0], // 5: orange
  [200, 120, 0], // 6: dark orange
  [140, 70, 0], // 7: ember
];

// Pulsing dot cycle for the beam head: small → medium → large → medium → ...
const PULSE_DOTS = ["\u00B7", "\u2022", "\u25CF", "\u2022"]; // · • ● •
const PULSE_PERIOD_MS = 80;

// Settled beam color
const SETTLED_COLOR: RGB = [200, 120, 0];

export interface BeamToken {
  cancelled: boolean;
}

/**
 * Row within the window where tmux will place a horizontal split separator.
 *
 * tmux splits a layout cell using floor(cell.sy / 2) for the upper half, so
 * the separator lands at cell.top + floor(cell.sy / 2). The subtlety is how
 * the pane maps to its enclosing cell under pane-border-status=top: only the
 * *top-of-window* pane has its status row inside its own cell (row 0), which
 * makes its cell one row taller than its pane. Every other pane's cell
 * coincides with (paneTop, paneHeight) because its status row lives in the
 * shared border row above it. We can detect the top-of-window case without
 * querying pane-border-status: paneTop === 1 is reachable only under
 * pane-border-status=top for the topmost pane (under =off the topmost pane
 * has paneTop=0, and any non-topmost pane has paneTop≥2).
 */
export function computeHoneybeamSplitRow(paneTop: number, paneHeight: number): number {
  if (paneTop === 1) {
    return Math.floor((paneHeight + 1) / 2);
  }
  return paneTop + Math.floor(paneHeight / 2);
}

export async function runHoneybeamAnimation(opts: HoneybeamOptions, token?: BeamToken): Promise<void> {
  const { borderLines, colOffset, direction, maxCol, paneHeight, paneLeft, paneTop, paneWidth, rowOffset } = opts;

  const chars = borderCharsForStyle(borderLines ?? "single");
  let length: number;
  let beamChar: string;

  if (direction === "vertical") {
    length = paneHeight;
    beamChar = chars.vertical;
  } else {
    length = paneWidth;
    beamChar = chars.horizontal;
  }

  if (length < 2) return;

  // Skip animation if the pane is too small for tmux to actually split.
  // Each side needs at least 1 row/col + 1 for the border = 3 minimum.
  const splitDim = direction === "vertical" ? paneWidth : paneHeight;
  const minSplitDim = 3;
  if (splitDim < minSplitDim) return;

  // Randomly choose beam travel direction (top→bottom or bottom→top, etc.)
  const reverse = Math.random() < 0.5;

  const splitRow = computeHoneybeamSplitRow(paneTop, paneHeight);
  const beamPos = (i: number): [number, number] => {
    const idx = reverse ? length - 1 - i : i;
    if (direction === "vertical") {
      return [rowOffset + paneTop + idx, colOffset + paneLeft + Math.floor(paneWidth / 2)];
    }
    return [rowOffset + splitRow, colOffset + paneLeft + idx];
  };

  // ── Phase 1: Beam sweep ─────────────────────────────────────────────
  const beamMs = Math.min(400, Math.max(200, length * 6));
  const start = performance.now();
  let lastDrawn = -1;

  while (true) {
    if (token?.cancelled) return;
    const elapsed = performance.now() - start;
    if (elapsed >= beamMs) break;

    const progress = elapsed / beamMs;
    const headPos = Math.floor(progress * (length + TRAIL_LENGTH));

    if (headPos === lastDrawn) {
      await Bun.sleep(2);
      continue;
    }
    lastDrawn = headPos;

    let buf = SYNC_BEGIN;

    for (let i = Math.max(0, headPos - TRAIL_LENGTH); i <= Math.min(headPos, length - 1); i++) {
      const distFromHead = headPos - i;
      const gradIdx = Math.min(distFromHead, BEAM_GRADIENT.length - 1);
      const color = BEAM_GRADIENT[gradIdx]!;
      const [row, col] = beamPos(i);
      // Head cell uses a pulsing filled dot; trail uses the beam line char
      const ch = distFromHead === 0 ? PULSE_DOTS[Math.floor(elapsed / PULSE_PERIOD_MS) % PULSE_DOTS.length]! : beamChar;
      if (maxCol !== undefined && col > maxCol) continue;
      buf += moveCursor(row, col) + setFg(color[0], color[1], color[2]) + ch;
    }

    const si = headPos - TRAIL_LENGTH - 1;
    if (si >= 0 && si < length) {
      const [row, col] = beamPos(si);
      if (maxCol === undefined || col <= maxCol) {
        buf += moveCursor(row, col) + setFg(SETTLED_COLOR[0], SETTLED_COLOR[1], SETTLED_COLOR[2]) + beamChar;
      }
    }

    buf += "\x1b[0m" + SYNC_END;
    writeTerminalOutput(buf);
    await Bun.sleep(2);
  }

  // Final beam frame: all cells settled
  let buf = SYNC_BEGIN;
  for (let i = 0; i < length; i++) {
    const [row, col] = beamPos(i);
    if (maxCol !== undefined && col > maxCol) continue;
    buf += moveCursor(row, col) + setFg(SETTLED_COLOR[0], SETTLED_COLOR[1], SETTLED_COLOR[2]) + beamChar;
  }
  buf += "\x1b[0m" + SYNC_END;
  writeTerminalOutput(buf);
}
