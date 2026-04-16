import { RGBA } from "@opentui/core";
import { describe, expect, test } from "bun:test";

import { animateFadeOverlayOpacity, wrapContentToTermCols } from "./buffer-zoom-fade.ts";

function createFakeBox() {
  const alphas: number[] = [];
  let backgroundColor = RGBA.fromInts(0, 0, 0, 0);

  return {
    alphas,
    box: {
      get backgroundColor() {
        return backgroundColor;
      },
      set backgroundColor(value: RGBA) {
        backgroundColor = value;
        alphas.push(value.toInts()[3]);
      },
      destroy() {},
      height: 12,
      width: 80,
    },
  };
}

function createFakeRenderer() {
  let idleCalls = 0;
  let renderCalls = 0;

  return {
    get idleCalls() {
      return idleCalls;
    },
    get renderCalls() {
      return renderCalls;
    },
    renderer: {
      height: 12,
      async idle() {
        idleCalls++;
      },
      requestRender() {
        renderCalls++;
      },
      width: 80,
    },
  };
}

describe("animateFadeOverlayOpacity", () => {
  test("fades a blackout overlay in over each frame", async () => {
    const { alphas, box } = createFakeBox();
    const fakeRenderer = createFakeRenderer();

    await animateFadeOverlayOpacity({
      box,
      durationMs: 0,
      frames: 3,
      fromAlpha: 0,
      renderer: fakeRenderer.renderer,
      toAlpha: 255,
    });

    expect(alphas).toEqual([85, 170, 255]);
    expect(fakeRenderer.renderCalls).toBe(3);
    expect(fakeRenderer.idleCalls).toBe(3);
  });

  test("supports the reverse fade back to the alternate screen", async () => {
    const { alphas, box } = createFakeBox();
    const fakeRenderer = createFakeRenderer();

    await animateFadeOverlayOpacity({
      box,
      durationMs: 0,
      frames: 4,
      fromAlpha: 255,
      renderer: fakeRenderer.renderer,
      toAlpha: 0,
    });

    expect(alphas).toEqual([191, 128, 64, 0]);
    expect(fakeRenderer.renderCalls).toBe(4);
    expect(fakeRenderer.idleCalls).toBe(4);
  });
});

describe("wrapContentToTermCols", () => {
  test("inserts a reset + erase-line before original newlines when the line is shorter than termCols", () => {
    expect(wrapContentToTermCols("hello\nworld", 10)).toBe("hello\x1b[0m\x1b[K\nworld");
  });

  test("omits the erase-line when an original line fills termCols exactly", () => {
    expect(wrapContentToTermCols("abcd\nxyz", 4)).toBe("abcd\x1b[0m\nxyz");
  });

  test("inserts a soft wrap when a line exceeds termCols", () => {
    expect(wrapContentToTermCols("abcdefghij", 4)).toBe("abcd\nefgh\nij");
  });

  test("treats CSI SGR escapes as zero width", () => {
    const input = "\x1b[31mabcdef\x1b[0m";
    expect(wrapContentToTermCols(input, 4)).toBe("\x1b[31mabcd\nef\x1b[0m");
  });

  test("treats OSC sequences as zero width", () => {
    const input = "\x1b]2;title\x07abcdef";
    expect(wrapContentToTermCols(input, 4)).toBe("\x1b]2;title\x07abcd\nef");
  });

  test("counts wide characters as two cells and avoids splitting them", () => {
    // 3 wide chars = 6 cells; termCols=5 should wrap before the second char
    // would have pushed column to 4 (odd), but since each glyph is 2 wide the
    // second glyph at col=2+2=4 fits, the third at col=4+2=6 does not.
    expect(wrapContentToTermCols("日本語", 5)).toBe("日本\n語");
  });

  test("resets column on an existing newline and reset-clears tail before it", () => {
    expect(wrapContentToTermCols("abc\ndefghij", 4)).toBe("abc\x1b[0m\x1b[K\ndefg\nhij");
  });

  test("leaves soft-wrap newlines un-reset so SGR continues across the wrap", () => {
    // "abcdefg\nx": soft wrap after 'd' (no reset), original newline after 'g'
    // (reset + erase), then "x" with no trailing newline.
    expect(wrapContentToTermCols("abcdefg\nx", 4)).toBe("abcd\nefg\x1b[0m\x1b[K\nx");
  });

  test("returns the input unchanged when termCols is non-positive", () => {
    expect(wrapContentToTermCols("anything long", 0)).toBe("anything long");
  });
});
