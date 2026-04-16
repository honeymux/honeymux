/**
 * Cursor alert — changes cursor shape and color when agents are waiting
 * for tool permission. Output is routed through the renderer when available
 * so it stays serialized with threaded native frame writes.
 *
 * The post-render hook in index.tsx must call `cursorAlertPostRender()`
 * instead of unconditionally resetting OSC 12 — otherwise OpenTUI's Zig
 * renderer stomps the alert color every frame.
 */
import type { CursorAlertShape } from "./config.ts";

import { hexToRgb, terminalCursorParam } from "../themes/theme.ts";
import { writeTerminalOutput } from "./terminal-output.ts";

let active = false;
let activeColor = "#ff0000";

/**
 * Called from the renderer post-process hook (queueMicrotask) after every
 * frame. Re-applies the alert cursor color when active, or resets to
 * reverse-video when inactive.
 */
export function cursorAlertPostRender(): void {
  if (active) {
    writeTerminalOutput(colorSeq(activeColor));
  } else {
    writeTerminalOutput("\x1b]112\x1b\\");
  }
}

/**
 * Toggle the cursor alert on/off. When activating, changes cursor to the
 * configured shape/blink in the configured color. When deactivating,
 * restores the terminal's original cursor shape and resets color.
 */
export function setCursorAlertActive(
  value: boolean,
  shape: CursorAlertShape = "underline",
  blink: boolean = true,
  color: string = "#ff0000",
): void {
  if (value === active) return;
  active = value;
  if (value) {
    activeColor = color;
    writeTerminalOutput(colorSeq(color));
    writeTerminalOutput(`\x1b[${cursorParam(shape, blink)} q`);
  } else {
    writeTerminalOutput("\x1b]112\x1b\\");
    const param = terminalCursorParam ?? 0;
    writeTerminalOutput(`\x1b[${param} q`);
  }
}

function colorSeq(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `\x1b]12;rgb:${h(r)}/${h(g)}/${h(b)}\x1b\\`;
}

/**
 * DECSCUSR param from shape + blink.
 *   block:     blink=1 steady=2
 *   underline: blink=3 steady=4
 *   bar:       blink=5 steady=6
 */
function cursorParam(shape: CursorAlertShape, blink: boolean): number {
  const base = shape === "block" ? 2 : shape === "underline" ? 4 : 6;
  return blink ? base - 1 : base;
}
