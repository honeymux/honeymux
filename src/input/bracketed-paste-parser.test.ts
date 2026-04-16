import { describe, expect, test } from "bun:test";

import { createBracketedPasteParser } from "./bracketed-paste-parser.ts";

describe("bracketed paste parser", () => {
  test("keeps focus-like escape sequences inside paste payloads", () => {
    const parser = createBracketedPasteParser();

    expect(parser.push("\x1b[200~X\x1b[IY\x1b[201~")).toEqual([{ text: "X\x1b[IY", type: "paste" }]);
  });

  test("recognizes a start marker split across chunks", () => {
    const parser = createBracketedPasteParser();

    expect(parser.push("\x1b[20")).toEqual([]);
    expect(parser.push("0~abc\x1b[201~")).toEqual([{ text: "abc", type: "paste" }]);
  });

  test("recognizes an end marker split across chunks without counting it against paste size", () => {
    const parser = createBracketedPasteParser(3);

    expect(parser.push("\x1b[200~abc\x1b[20")).toEqual([]);
    expect(parser.push("1~tail")).toEqual([
      { text: "abc", type: "paste" },
      { text: "tail", type: "text" },
    ]);
  });

  test("drops oversized unterminated paste and resynchronizes at the terminator", () => {
    const parser = createBracketedPasteParser(4);

    expect(parser.push("\x1b[200~abcde")).toEqual([]);
    expect(parser.push("more\x1b[201~tail")).toEqual([{ text: "tail", type: "text" }]);
  });
});
