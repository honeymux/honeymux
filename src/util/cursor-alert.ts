/**
 * Cursor alert — changes cursor shape and color when agents are waiting
 * for tool permission. Output is routed through the renderer when available
 * so it stays serialized with threaded native frame writes.
 *
 * The post-render hook in index.tsx must call `cursorAlertPostRender()`
 * instead of unconditionally resetting OSC 12 — otherwise OpenTUI's Zig
 * renderer stomps the alert color every frame.
 */
import type { CursorAlertBlink, CursorAlertShape } from "./config.ts";

import { hexToRgb, terminalCursorParam } from "../themes/theme.ts";
import { writeTerminalOutput } from "./terminal-output.ts";
import { OSC_TERMINATOR } from "./terminal-sequences.ts";

let active = false;
let activeColor = "#ff0000";
let shapeChanged = false;

/**
 * Called from the renderer post-process hook (queueMicrotask) after every
 * frame. Re-applies the alert cursor color when active, or resets to
 * reverse-video when inactive.
 */
export function cursorAlertPostRender(): void {
  if (active) {
    writeTerminalOutput(colorSeq(activeColor));
  } else {
    writeTerminalOutput(`\x1b]112${OSC_TERMINATOR}`);
  }
}

/**
 * Toggle the cursor alert on/off. When activating, changes cursor color and
 * (when shape and blink are both not "default") shape/blink in the
 * configured color. When deactivating, resets the cursor color and — only
 * if shape was changed on activation — restores the terminal's original
 * cursor shape.
 */
export function setCursorAlertActive(
  value: boolean,
  shape: CursorAlertShape = "default",
  blink: CursorAlertBlink = "default",
  color: string = "#ff0000",
): void {
  if (value === active) return;
  active = value;
  if (value) {
    activeColor = color;
    writeTerminalOutput(colorSeq(color));
    const param = cursorParam(shape, blink);
    if (param !== null) {
      writeTerminalOutput(`\x1b[${param} q`);
      shapeChanged = true;
    }
  } else {
    writeTerminalOutput(`\x1b]112${OSC_TERMINATOR}`);
    if (shapeChanged) {
      const param = terminalCursorParam ?? 0;
      writeTerminalOutput(`\x1b[${param} q`);
      shapeChanged = false;
    }
  }
}

function colorSeq(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `\x1b]12;rgb:${h(r)}/${h(g)}/${h(b)}${OSC_TERMINATOR}`;
}

/**
 * DECSCUSR param from shape + blink. Returns null when either is "default",
 * meaning no shape sequence should be sent (the outer terminal's existing
 * cursor style is preserved).
 *   block:     blink=1 steady=2
 *   underline: blink=3 steady=4
 *   bar:       blink=5 steady=6
 */
function cursorParam(shape: CursorAlertShape, blink: CursorAlertBlink): null | number {
  if (shape === "default" || blink === "default") return null;
  const base = shape === "block" ? 2 : shape === "underline" ? 4 : 6;
  return blink === "on" ? base - 1 : base;
}
