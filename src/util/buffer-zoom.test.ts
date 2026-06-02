import { describe, expect, test } from "bun:test";

import { consumeBufferZoomDismissChunk } from "./buffer-zoom.ts";

describe("consumeBufferZoomDismissChunk", () => {
  test("dismisses on a bare Escape byte (legacy terminals)", () => {
    expect(consumeBufferZoomDismissChunk("\x1b")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("dismisses on Escape encoded as CSI u (Kitty flag 8)", () => {
    // \x1b[27u, with explicit modifier field, and with event-type field
    expect(consumeBufferZoomDismissChunk("\x1b[27u")).toEqual({
      dismiss: true,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[27;1u")).toEqual({
      dismiss: true,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[27;1:1u")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("dismisses when an Escape press and release arrive in the same chunk", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[27;1:1u\x1b[27;1:3u")).toEqual({
      dismiss: true,
      pending: "",
    });
  });

  test("ignores an Escape release on its own", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[27;1:3u")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores plain printable keys", () => {
    expect(consumeBufferZoomDismissChunk("a")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[97u")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores Enter, Tab, arrows, and other special keys", () => {
    expect(consumeBufferZoomDismissChunk("\x1b[13u")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[9u")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[A")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[3~")).toEqual({
      dismiss: false,
      pending: "",
    });
  });

  test("ignores modified keys (left for the terminal/app)", () => {
    // Cmd+A / Super+A (super = bit 8, modifier value 9): select-all
    expect(consumeBufferZoomDismissChunk("\x1b[97;9u")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Cmd+C / Super+C: copy
    expect(consumeBufferZoomDismissChunk("\x1b[99;9u")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Ctrl+A (ctrl = bit 4, modifier value 5)
    expect(consumeBufferZoomDismissChunk("\x1b[97;5u")).toEqual({
      dismiss: false,
      pending: "",
    });
    // Shift+A (shift = bit 1, modifier value 2) — a non-Escape key is ignored
    expect(consumeBufferZoomDismissChunk("\x1b[97;2u")).toEqual({
      dismiss: false,
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

  test("ignores mouse events including press, release, and wheel scroll", () => {
    // Left-button press / release
    expect(consumeBufferZoomDismissChunk("\x1b[<0;10;5M")).toEqual({
      dismiss: false,
      pending: "",
    });
    expect(consumeBufferZoomDismissChunk("\x1b[<0;10;5m")).toEqual({
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

  test("buffers incomplete CSI sequences until they are complete", () => {
    const first = consumeBufferZoomDismissChunk("\x1b[27;1:", "");
    expect(first).toEqual({
      dismiss: false,
      pending: "\x1b[27;1:",
    });

    expect(consumeBufferZoomDismissChunk("1u", first.pending)).toEqual({
      dismiss: true,
      pending: "",
    });
  });
});
