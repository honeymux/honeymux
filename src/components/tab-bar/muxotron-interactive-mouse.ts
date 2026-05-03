import type { MouseEvent } from "@opentui/core";

interface InteractiveMouseFrame {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function buildInteractiveScrollSequence(
  event: Pick<MouseEvent, "modifiers" | "scroll" | "x" | "y">,
  frame: InteractiveMouseFrame,
): null | string {
  if (!event.scroll) return null;
  const baseButton = event.scroll.direction === "up" ? 64 : event.scroll.direction === "down" ? 65 : null;
  if (baseButton === null) return null;

  const localX = event.x - frame.left + 1;
  const localY = event.y - frame.top + 1;
  if (localX < 1 || localX > frame.width || localY < 1 || localY > frame.height) {
    return null;
  }

  let button = baseButton;
  if (event.modifiers.shift) button |= 4;
  if (event.modifiers.alt) button |= 8;
  if (event.modifiers.ctrl) button |= 16;

  return `\x1b[<${button};${localX};${localY}M`;
}
