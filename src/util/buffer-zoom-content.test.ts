import { describe, expect, test } from "bun:test";

import { softWrapContent } from "./buffer-zoom-content.ts";

describe("softWrapContent", () => {
  test("inserts a reset + erase-line before original newlines", () => {
    expect(softWrapContent("hello\nworld")).toBe("hello\x1b[0m\x1b[K\nworld");
  });

  test("does not insert wrap newlines for long lines", () => {
    // A long line passes through verbatim — the terminal's own auto-wrap
    // handles it, and the resulting soft-wrap cells preserve continuation
    // semantics on select+copy.
    expect(softWrapContent("abcdefghij")).toBe("abcdefghij");
  });

  test("preserves wide characters as-is", () => {
    expect(softWrapContent("日本語")).toBe("日本語");
  });

  test("passes CSI SGR escapes through unchanged", () => {
    const input = "\x1b[31mhello\x1b[0m world";
    expect(softWrapContent(input)).toBe(input);
  });

  test("passes OSC sequences through unchanged", () => {
    const input = "\x1b]2;title\x07prefix\nsuffix";
    expect(softWrapContent(input)).toBe("\x1b]2;title\x07prefix\x1b[0m\x1b[K\nsuffix");
  });

  test("emits cleanup at every original newline", () => {
    expect(softWrapContent("a\nb\nc")).toBe("a\x1b[0m\x1b[K\nb\x1b[0m\x1b[K\nc");
  });

  test("preserves carriage returns and other low-ASCII control bytes", () => {
    expect(softWrapContent("a\rb\nc")).toBe("a\rb\x1b[0m\x1b[K\nc");
  });

  test("handles an empty string", () => {
    expect(softWrapContent("")).toBe("");
  });

  test("handles a trailing original newline", () => {
    expect(softWrapContent("done\n")).toBe("done\x1b[0m\x1b[K\n");
  });

  test("does not substitute newlines that appear inside an OSC payload", () => {
    // Defensive: a stray \n inside an OSC payload (between ESC ] and BEL)
    // should be carried through as part of the escape, not replaced with the
    // SGR-reset cleanup intended for content-level newlines.
    const input = "\x1b]2;title\nwith newline\x07after";
    expect(softWrapContent(input)).toBe("\x1b]2;title\nwith newline\x07after");
  });
});
