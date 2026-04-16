import { describe, expect, test } from "bun:test";

import { buildInteractiveScrollSequence } from "./muxotron-interactive-mouse.ts";

describe("buildInteractiveScrollSequence", () => {
  test("encodes wheel-up scroll inside the interactive frame", () => {
    const sequence = buildInteractiveScrollSequence(
      {
        modifiers: { alt: false, ctrl: false, shift: false },
        scroll: { delta: 1, direction: "up" },
        x: 23,
        y: 8,
      } as const,
      { height: 10, left: 20, top: 5, width: 40 },
    );

    expect(sequence).toBe("\x1b[<64;4;4M");
  });

  test("preserves modifier bits for wheel-down scroll", () => {
    const sequence = buildInteractiveScrollSequence(
      {
        modifiers: { alt: true, ctrl: true, shift: true },
        scroll: { delta: 1, direction: "down" },
        x: 24,
        y: 9,
      } as const,
      { height: 10, left: 20, top: 5, width: 40 },
    );

    expect(sequence).toBe("\x1b[<93;5;5M");
  });

  test("rejects scrolls outside the interactive frame", () => {
    const sequence = buildInteractiveScrollSequence(
      {
        modifiers: { alt: false, ctrl: false, shift: false },
        scroll: { delta: 1, direction: "up" },
        x: 19,
        y: 8,
      } as const,
      { height: 10, left: 20, top: 5, width: 40 },
    );

    expect(sequence).toBeNull();
  });

  test("ignores horizontal scroll directions", () => {
    const sequence = buildInteractiveScrollSequence(
      {
        modifiers: { alt: false, ctrl: false, shift: false },
        scroll: { delta: 1, direction: "left" },
        x: 23,
        y: 8,
      } as const,
      { height: 10, left: 20, top: 5, width: 40 },
    );

    expect(sequence).toBeNull();
  });
});
