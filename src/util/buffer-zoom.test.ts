import { describe, expect, test } from "bun:test";

import { consumeBufferZoomDismissChunk } from "./buffer-zoom.ts";

describe("consumeBufferZoomDismissChunk", () => {
  test("dismisses when a press and release arrive in the same chunk", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[13;1:1u\x1b[13;1:3u")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("ignores release-only chunks", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[13;1:3u")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores mouse release chunks", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[<0;10;5m")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores terminal query responses on unknown CSI terminators", () => {
    // XTWINOPS pixel-size reply (e.g. Warp response to CSI 14 t)
    expect(consumeBufferZoomDismissChunk("\x1b[4;752;1240t")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Cursor position report
    expect(consumeBufferZoomDismissChunk("\x1b[24;80R")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Primary device attributes reply
    expect(consumeBufferZoomDismissChunk("\x1b[?62;1;2c")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Device status report reply
    expect(consumeBufferZoomDismissChunk("\x1b[?6;0n")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores focus in/out events", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[I")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[O")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores all mouse events including wheel scroll", () => {
    // Left-button press
    expect(consumeBufferZoomDismissChunk("\x1b[<0;10;5M")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Wheel up / wheel down
    expect(consumeBufferZoomDismissChunk("\x1b[<64;10;5M")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[<65;10;5M")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores bare BEL bytes (OSC echo from Warp/Terminal.app)", () => {
    expect(consumeBufferZoomDismissChunk("\x07")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x07\x07\x07")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("dismisses on plain printable keys", () => {
    expect(consumeBufferZoomDismissChunk("a")).toEqual({
      dismiss: true,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x07a")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("dismisses on Escape, arrows, and special keys", () => {
    expect(consumeBufferZoomDismissChunk("\x1b")).toEqual({
      dismiss: true,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[A")).toEqual({
      dismiss: true,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[3~")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("ignores modifier-only key presses", () => {
    // Left Shift press (code 57441, event type 1)
    expect(consumeBufferZoomDismissChunk("\x1b[57441;1:1u")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Left Control press
    expect(consumeBufferZoomDismissChunk("\x1b[57442;1:1u")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("buffers incomplete CSI sequences until they are complete", () => {
    const first = consumeBufferZoomDismissChunk("\x1b[13;1:", "");
    expect(first).toEqual({
      dismiss: false,
      pending: "\x1b[13;1:",
    });

    expect(consumeBufferZoomDismissChunk("1u", first.pending)).toEqual({
      dismiss: true,
      pending: "",
    });
  });
});
