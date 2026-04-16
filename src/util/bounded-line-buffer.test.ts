import { describe, expect, test } from "bun:test";

import { appendBoundedLines } from "./bounded-line-buffer.ts";

describe("appendBoundedLines", () => {
  test("returns complete lines and keeps the trailing remainder", () => {
    expect(appendBoundedLines("hel", "lo\nwor", 32)).toEqual({
      lines: ["hello"],
      overflowed: false,
      remainder: "wor",
    });
  });

  test("overflows when the retained remainder grows beyond the limit", () => {
    expect(appendBoundedLines("", "abcdef", 5)).toEqual({
      lines: [],
      overflowed: true,
      remainder: "",
    });
  });

  test("overflows when a complete line exceeds the limit", () => {
    expect(appendBoundedLines("", "abcdef\nok", 5)).toEqual({
      lines: [],
      overflowed: true,
      remainder: "",
    });
  });
});
