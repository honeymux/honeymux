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
