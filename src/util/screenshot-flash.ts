import { writeTerminalOutput } from "./terminal-output.ts";

const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";
const BLOCK = "\u2588"; // █

/**
 * Flash the pane area: dark grey → bright white → fade to black.
 * Uses full-block characters (█) with matching fg+bg so the entire cell is filled.
 */
export async function runScreenshotFlash(
  paneLeft: number,
  paneTop: number,
  paneWidth: number,
  paneHeight: number,
  colOffset: number,
  rowOffset: number,
): Promise<void> {
  // Brightness keyframes (0–255) over time
  // Ramp up: dark grey → white, then ramp down: white → black
  const RAMP_UP: number[] = [40, 80, 140, 200, 255];
  const RAMP_DOWN: number[] = [200, 140, 80, 40, 0];
  const FRAME_MS = 20;

  const blockRow = BLOCK.repeat(paneWidth);

  for (const frames of [RAMP_UP, RAMP_DOWN]) {
    for (const brightness of frames) {
      let buf = SYNC_BEGIN;
      buf += setFg(brightness, brightness, brightness);
      buf += setBg(brightness, brightness, brightness);

      for (let r = 0; r < paneHeight; r++) {
        const screenRow = rowOffset + paneTop + r;
        const screenCol = colOffset + paneLeft;
        buf += moveCursor(screenRow, screenCol) + blockRow;
      }

      buf += "\x1b[0m" + SYNC_END;
      writeTerminalOutput(buf);
      await Bun.sleep(FRAME_MS);
    }
  }
}

function moveCursor(row: number, col: number): string {
  return `\x1b[${row + 1};${col + 1}H`;
}

function setBg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

function setFg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}
