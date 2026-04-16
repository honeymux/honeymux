import { describe, expect, test } from "bun:test";

import {
  centerToWidth,
  fitToWidth,
  overlayAtColumn,
  padEndToWidth,
  padStartToWidth,
  shortenPath,
  splitAtColumn,
  stringWidth,
  stripNonPrintingControlChars,
  truncateName,
  truncateToWidth,
} from "./text.ts";

describe("stripNonPrintingControlChars", () => {
  test("removes ASCII control characters including newlines and tabs", () => {
    expect(stripNonPrintingControlChars("alpha\nbeta\tgamma\rdelta")).toBe("alphabetagammadelta");
  });

  test("removes DEL and C1 control bytes", () => {
    expect(stripNonPrintingControlChars(`a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x85)}c`)).toBe("abc");
  });
});

describe("shortenPath", () => {
  test("replaces the home prefix with tilde", () => {
    const home = process.env.HOME ?? "";
    expect(shortenPath(`${home}/project`)).toBe("~/project");
  });

  test("strips control characters and ANSI escapes before display", () => {
    expect(shortenPath("/tmp/\nproject\t\x1b[31mname\x1b[0m")).toBe("/tmp/projectname");
  });
});

describe("display width helpers", () => {
  test("counts CJK code points as two columns", () => {
    expect(stringWidth("abc")).toBe(3);
    expect(stringWidth("漢字")).toBe(4);
    expect(stringWidth("a漢b")).toBe(4);
  });

  test("truncates to display width instead of code unit length", () => {
    expect(truncateToWidth("漢字漢字", 5)).toBe("漢字…");
    expect(stringWidth(truncateToWidth("漢字漢字", 5))).toBe(5);
  });

  test("pads to the requested display width", () => {
    const padded = padEndToWidth("漢字", 6);
    expect(padded).toBe("漢字  ");
    expect(stringWidth(padded)).toBe(6);
  });

  test("truncateName keeps its width budget with mixed-width text", () => {
    const truncated = truncateName("編譯器窗口名字", 8);
    expect(stringWidth(truncated)).toBeLessThanOrEqual(8);
    expect(truncated).toContain("…");
  });

  test("pads on the left and centers by display width", () => {
    expect(padStartToWidth("漢字", 6)).toBe("  漢字");
    expect(centerToWidth("漢字", 6)).toBe(" 漢字 ");
  });

  test("fits and overlays strings by display column", () => {
    const base = fitToWidth("東京都", 8);
    expect(stringWidth(base)).toBe(8);
    expect(overlayAtColumn(base, 6, "x")).toBe("東京都x ");
  });

  test("splits strings at display columns", () => {
    expect(splitAtColumn("東京都北京", 4)).toEqual(["東京", "都北京"]);
  });
});
