import { describe, expect, test } from "bun:test";

import type { ScreenshotPreview } from "./use-screenshot-workflow.ts";

import {
  DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
  MAX_SCROLLBACK_LINES,
  buildScreenshotFilePath,
  computePreviewImageDims,
  countRenderedLines,
  isScrollbackTooTall,
  resolveScreenshotOutputDir,
  sanitizeFilenamePart,
} from "./use-screenshot-workflow.ts";

describe("screenshot workflow helpers", () => {
  test("resolves configured screenshot dir with tilde expansion", () => {
    expect(resolveScreenshotOutputDir("~/shots", "/tmp/fallback", "/home/alice")).toBe("/home/alice/shots");
    expect(resolveScreenshotOutputDir("", "/tmp/fallback", "/home/alice")).toBe("/tmp/fallback");
  });

  test("builds a deterministic screenshot file path with names", () => {
    const names = { paneName: "bash", sessionName: "main", windowName: "editor" };
    expect(buildScreenshotFilePath("/tmp/shots", new Date("2026-04-08T12:34:56.789Z"), names)).toBe(
      "/tmp/shots/main-editor-bash-2026-04-08T12-34-56.png",
    );
  });

  test("builds screenshot file path without names", () => {
    expect(buildScreenshotFilePath("/tmp/shots", new Date("2026-04-08T12:34:56.789Z"))).toBe(
      "/tmp/shots/2026-04-08T12-34-56.png",
    );
  });

  test("sanitizes special characters in filename parts", () => {
    expect(sanitizeFilenamePart("my session")).toBe("my-session");
    expect(sanitizeFilenamePart("foo/bar:baz")).toBe("foo-bar-baz");
    expect(sanitizeFilenamePart("---clean---")).toBe("clean");
    expect(sanitizeFilenamePart("CJK\u3000test")).toBe("CJK-test");
    expect(sanitizeFilenamePart("")).toBe("");
    expect(sanitizeFilenamePart("simple")).toBe("simple");
    expect(sanitizeFilenamePart("under_score")).toBe("under_score");
  });

  test("falls back to generic names for empty sanitized parts", () => {
    const names = { paneName: "", sessionName: "///", windowName: "ok" };
    expect(buildScreenshotFilePath("/tmp", new Date("2026-01-01T00:00:00.000Z"), names)).toBe(
      "/tmp/session-ok-pane-2026-01-01T00-00-00.png",
    );
  });

  test("uses the existing scrollback cap", () => {
    expect(MAX_SCROLLBACK_LINES).toBe(5000);
  });

  test("computes image dims matching ghostty-opentui renderTerminalToImage defaults", () => {
    // 240 cols × 60 rows at defaults (fontSize 14, lineHeight 1.5, charFactor 0.6, dpr 2)
    // charWidth = 8.4 → ceil(240*8.4) = 2016; width = 2016*2 = 4032
    // lineHeightPx = round(14*1.5) = 21; height = 60*21*2 = 2520
    expect(computePreviewImageDims(240, 60)).toEqual({ height: 2520, width: 4032 });
    // Single column/row sanity check.
    expect(computePreviewImageDims(1, 1)).toEqual({ height: 42, width: 18 });
  });

  test("flags scrollback as too tall when height exceeds the pixel cap", () => {
    const base: ScreenshotPreview = {
      dir: "/tmp",
      scrollbackDims: "loading",
      viewportDims: { height: 100, width: 100 },
    };
    expect(isScrollbackTooTall(null, DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT)).toBe(false);
    expect(isScrollbackTooTall(base, DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT)).toBe(false);
    expect(isScrollbackTooTall({ ...base, scrollbackDims: "error" }, DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT)).toBe(false);
    expect(
      isScrollbackTooTall(
        { ...base, scrollbackDims: { height: DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT, width: 100 } },
        DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
      ),
    ).toBe(false);
    expect(
      isScrollbackTooTall(
        { ...base, scrollbackDims: { height: DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT + 1, width: 100 } },
        DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
      ),
    ).toBe(true);
  });

  test("counts rendered lines by trimming trailing blank spans", () => {
    const blank = { spans: [] };
    const whitespace = { spans: [{ bg: null, fg: null, flags: 0, text: "   ", width: 3 }] };
    const content = { spans: [{ bg: null, fg: null, flags: 0, text: "hi", width: 2 }] };
    const bgTail = { spans: [{ bg: "#ff0000", fg: null, flags: 0, text: " ", width: 1 }] };
    expect(countRenderedLines([content, blank, whitespace])).toBe(1);
    expect(countRenderedLines([content, blank, content, blank])).toBe(3);
    // Whitespace with a background is not empty.
    expect(countRenderedLines([content, bgTail])).toBe(2);
    expect(countRenderedLines([])).toBe(0);
  });
});
