import { describe, expect, test } from "bun:test";

import { TmuxQueryStripper, findSequenceEnd, isQuerySequence } from "./query-stripper.ts";

function bytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "binary"));
}

function decode(arr: Uint8Array): string {
  return Buffer.from(arr).toString("binary");
}

function strip(input: string): string {
  return decode(new TmuxQueryStripper().filter(bytes(input)));
}

describe("findSequenceEnd", () => {
  test("returns -1 for incomplete CSI", () => {
    const b = bytes("\x1b[?2004");
    expect(findSequenceEnd(b, 0)).toBe(-1);
  });

  test("returns the index after the CSI final byte", () => {
    const b = bytes("\x1b[?2004h");
    expect(findSequenceEnd(b, 0)).toBe(b.length);
  });

  test("recognizes OSC terminated by BEL", () => {
    const b = bytes("\x1b]0;title\x07");
    expect(findSequenceEnd(b, 0)).toBe(b.length);
  });

  test("recognizes OSC terminated by ST", () => {
    const b = bytes("\x1b]0;title\x1b\\");
    expect(findSequenceEnd(b, 0)).toBe(b.length);
  });

  test("recognizes DCS terminated by ST", () => {
    const b = bytes("\x1bP+q544e\x1b\\");
    expect(findSequenceEnd(b, 0)).toBe(b.length);
  });

  test("returns start+2 for two-byte ESC sequences", () => {
    const b = bytes("\x1b7rest");
    expect(findSequenceEnd(b, 0)).toBe(2);
  });
});

describe("isQuerySequence", () => {
  test("DA1 query is a query", () => {
    const b = bytes("\x1b[c");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DA2 query is a query", () => {
    const b = bytes("\x1b[>c");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DA3 query is a query", () => {
    const b = bytes("\x1b[=c");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("CPR query is a query", () => {
    const b = bytes("\x1b[6n");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DSR-OS query is a query", () => {
    const b = bytes("\x1b[5n");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DEC-private DSR query is a query", () => {
    const b = bytes("\x1b[?6n");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("XTVERSION query is a query", () => {
    const b = bytes("\x1b[>q");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DECRQM query is a query", () => {
    const b = bytes("\x1b[?2004$p");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("XTGETTCAP DCS query is a query", () => {
    const b = bytes("\x1bP+q544e\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("DECRQSS DCS query is a query", () => {
    const b = bytes("\x1bP$qm\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("OSC color query is a query", () => {
    const b = bytes("\x1b]10;?\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("OSC clipboard query is a query", () => {
    const b = bytes("\x1b]52;c;?\x07");
    expect(isQuerySequence(b, 0, b.length)).toBe(true);
  });

  test("cursor up CSI is not a query", () => {
    const b = bytes("\x1b[3A");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });

  test("set-mode CSI is not a query", () => {
    const b = bytes("\x1b[?2004h");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });

  test("title-set OSC is not a query", () => {
    const b = bytes("\x1b]2;hello\x07");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });

  test("clipboard set OSC is not a query", () => {
    const b = bytes("\x1b]52;c;aGVsbG8=\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });

  test("hyperlink OSC is not a query", () => {
    const b = bytes("\x1b]8;;https://example.com\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });

  test("Sixel DCS is not a query", () => {
    const b = bytes("\x1bPq#0;2;0;0;0\x1b\\");
    expect(isQuerySequence(b, 0, b.length)).toBe(false);
  });
});

describe("TmuxQueryStripper", () => {
  test("passes through plain text untouched", () => {
    expect(strip("hello world\n")).toBe("hello world\n");
  });

  test("strips a DA1 query", () => {
    expect(strip("before\x1b[cafter")).toBe("beforeafter");
  });

  test("strips a CPR query", () => {
    expect(strip("a\x1b[6nb")).toBe("ab");
  });

  test("strips an XTVERSION query", () => {
    expect(strip("x\x1b[>qy")).toBe("xy");
  });

  test("strips an XTGETTCAP DCS query", () => {
    expect(strip("a\x1bP+q544e\x1b\\b")).toBe("ab");
  });

  test("strips an OSC color query", () => {
    expect(strip("a\x1b]10;?\x07b")).toBe("ab");
  });

  test("preserves cursor moves and set-mode sequences", () => {
    const input = "\x1b[H\x1b[2J\x1b[?2004h\x1b[3Atext";
    expect(strip(input)).toBe(input);
  });

  test("preserves title-set OSC", () => {
    expect(strip("\x1b]0;hello\x07rest")).toBe("\x1b]0;hello\x07rest");
  });

  test("strips multiple queries in one chunk", () => {
    expect(strip("a\x1b[cb\x1b[6nc\x1b[>qd")).toBe("abcd");
  });

  test("holds an incomplete CSI across chunk boundaries", () => {
    const s = new TmuxQueryStripper();
    const first = decode(s.filter(bytes("a\x1b[?")));
    const second = decode(s.filter(bytes("2004h\x1b[6n")));
    expect(first).toBe("a");
    expect(second).toBe("\x1b[?2004h");
  });

  test("holds an incomplete OSC across chunk boundaries", () => {
    const s = new TmuxQueryStripper();
    const first = decode(s.filter(bytes("x\x1b]10;")));
    const second = decode(s.filter(bytes("?\x07tail")));
    expect(first).toBe("x");
    expect(second).toBe("tail");
  });

  test("holds an incomplete DCS across chunk boundaries", () => {
    const s = new TmuxQueryStripper();
    const first = decode(s.filter(bytes("a\x1bP+q5")));
    const second = decode(s.filter(bytes("44e\x1b\\b")));
    expect(first).toBe("a");
    expect(second).toBe("b");
  });

  test("holds a lone trailing ESC across chunk boundaries", () => {
    const s = new TmuxQueryStripper();
    const first = decode(s.filter(bytes("a\x1b")));
    const second = decode(s.filter(bytes("[6nb")));
    expect(first).toBe("a");
    expect(second).toBe("b");
  });

  test("flushes oversized held buffer rather than holding forever", () => {
    const s = new TmuxQueryStripper();
    const huge = "\x1b[" + "1".repeat(70_000);
    const out = decode(s.filter(bytes(huge)));
    expect(out.length).toBeGreaterThan(0);
  });
});
