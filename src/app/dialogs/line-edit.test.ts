import { describe, expect, test } from "bun:test";

import { type LineEditState, applyLineEdit, isPrintableChar, lineEditStateAtEnd } from "./line-edit.ts";

function apply(state: LineEditState, ...keys: string[]): LineEditState {
  let current = state;
  for (const key of keys) {
    const result = applyLineEdit(current, key);
    expect(result.handled).toBe(true);
    current = result.next;
  }
  return current;
}

function s(query: string, cursor = query.length): LineEditState {
  return { cursor, query };
}

describe("applyLineEdit — insertion", () => {
  test("inserts printable ASCII at cursor and advances cursor", () => {
    const out = apply(s(""), "a", "b", "c");
    expect(out).toEqual({ cursor: 3, query: "abc" });
  });

  test("inserts at cursor mid-string without truncating tail", () => {
    const out = apply(s("abd", 2), "c");
    expect(out).toEqual({ cursor: 3, query: "abcd" });
  });

  test("inserts emoji as a single codepoint position", () => {
    const out = apply(s(""), "😀", "x");
    expect(out).toEqual({ cursor: 2, query: "😀x" });
  });

  test("inserts CJK characters", () => {
    const out = apply(s(""), "日", "本");
    expect(out).toEqual({ cursor: 2, query: "日本" });
  });

  test("returns handled=false for non-printable unknown bytes", () => {
    const result = applyLineEdit(s("x"), "\x1b[99~");
    expect(result.handled).toBe(false);
    expect(result.queryChanged).toBe(false);
  });
});

describe("applyLineEdit — cursor motion", () => {
  test("ctrl+a moves to beginning", () => {
    const out = apply(s("hello"), "\x01");
    expect(out).toEqual({ cursor: 0, query: "hello" });
  });

  test("ctrl+e moves to end", () => {
    const out = apply(s("hello", 0), "\x05");
    expect(out).toEqual({ cursor: 5, query: "hello" });
  });

  test("ctrl+b / left moves backward by codepoint", () => {
    expect(apply(s("ab", 2), "\x02")).toEqual({ cursor: 1, query: "ab" });
    expect(apply(s("ab", 2), "\x1b[D")).toEqual({ cursor: 1, query: "ab" });
  });

  test("ctrl+f / right moves forward by codepoint", () => {
    expect(apply(s("ab", 0), "\x06")).toEqual({ cursor: 1, query: "ab" });
    expect(apply(s("ab", 0), "\x1b[C")).toEqual({ cursor: 1, query: "ab" });
  });

  test("left past start clamps at 0", () => {
    expect(apply(s("ab", 0), "\x02")).toEqual({ cursor: 0, query: "ab" });
  });

  test("right past end clamps at length", () => {
    expect(apply(s("ab", 2), "\x06")).toEqual({ cursor: 2, query: "ab" });
  });

  test("cursor motion does not mark queryChanged", () => {
    const result = applyLineEdit(s("abc", 2), "\x02");
    expect(result.handled).toBe(true);
    expect(result.queryChanged).toBe(false);
  });

  test("home/end legacy sequences work", () => {
    expect(apply(s("hello", 3), "\x1b[H")).toEqual({ cursor: 0, query: "hello" });
    expect(apply(s("hello", 3), "\x1b[F")).toEqual({ cursor: 5, query: "hello" });
  });

  test("alt+b moves one word backward skipping non-word chars", () => {
    expect(apply(s("foo bar baz", 11), "\x1bb")).toEqual({ cursor: 8, query: "foo bar baz" });
    expect(apply(s("foo bar baz", 8), "\x1bb")).toEqual({ cursor: 4, query: "foo bar baz" });
  });

  test("alt+f moves one word forward skipping non-word chars", () => {
    expect(apply(s("foo bar", 0), "\x1bf")).toEqual({ cursor: 3, query: "foo bar" });
    expect(apply(s("foo bar", 3), "\x1bf")).toEqual({ cursor: 7, query: "foo bar" });
  });
});

describe("applyLineEdit — deletion", () => {
  test("backspace removes codepoint before cursor", () => {
    expect(apply(s("abc"), "\x7f")).toEqual({ cursor: 2, query: "ab" });
    expect(apply(s("abc"), "\x08")).toEqual({ cursor: 2, query: "ab" });
  });

  test("backspace at start is a no-op", () => {
    const result = applyLineEdit(s("abc", 0), "\x7f");
    expect(result.handled).toBe(true);
    expect(result.queryChanged).toBe(false);
    expect(result.next).toEqual({ cursor: 0, query: "abc" });
  });

  test("backspace on emoji removes single codepoint", () => {
    expect(apply(s("a😀b", 2), "\x7f")).toEqual({ cursor: 1, query: "ab" });
  });

  test("ctrl+d deletes codepoint at cursor", () => {
    expect(apply(s("abc", 1), "\x04")).toEqual({ cursor: 1, query: "ac" });
  });

  test("forward delete (\\x1b[3~) deletes at cursor", () => {
    expect(apply(s("abc", 1), "\x1b[3~")).toEqual({ cursor: 1, query: "ac" });
  });

  test("ctrl+k kills to end of line", () => {
    expect(apply(s("hello world", 5), "\x0b")).toEqual({ cursor: 5, query: "hello" });
  });

  test("ctrl+u kills to beginning of line", () => {
    expect(apply(s("hello world", 6), "\x15")).toEqual({ cursor: 0, query: "world" });
  });

  test("ctrl+w deletes whitespace-delimited word backward", () => {
    expect(apply(s("foo bar baz", 11), "\x17")).toEqual({ cursor: 8, query: "foo bar " });
    expect(apply(s("foo-bar baz", 7), "\x17")).toEqual({ cursor: 0, query: " baz" });
  });

  test("alt+backspace deletes word-class word backward", () => {
    expect(apply(s("foo-bar", 7), "\x1b\x7f")).toEqual({ cursor: 4, query: "foo-" });
  });

  test("alt+d deletes word forward", () => {
    expect(apply(s("foo bar baz", 0), "\x1bd")).toEqual({ cursor: 0, query: " bar baz" });
  });
});

describe("applyLineEdit — ctrl+w non-standard cases", () => {
  test("multiple trailing spaces are consumed before the word", () => {
    expect(apply(s("foo   bar   ", 12), "\x17")).toEqual({ cursor: 6, query: "foo   " });
  });

  test("cursor at 0 is a no-op", () => {
    const result = applyLineEdit(s("foo", 0), "\x17");
    expect(result.handled).toBe(true);
    expect(result.queryChanged).toBe(false);
  });
});

describe("isPrintableChar", () => {
  test("true for ASCII letters/digits/punct", () => {
    expect(isPrintableChar("a")).toBe(true);
    expect(isPrintableChar("1")).toBe(true);
    expect(isPrintableChar("!")).toBe(true);
    expect(isPrintableChar(" ")).toBe(true);
  });

  test("false for control characters", () => {
    expect(isPrintableChar("\x01")).toBe(false);
    expect(isPrintableChar("\x1b")).toBe(false);
    expect(isPrintableChar("\x7f")).toBe(false);
  });

  test("true for single-codepoint emoji and CJK", () => {
    expect(isPrintableChar("😀")).toBe(true);
    expect(isPrintableChar("日")).toBe(true);
  });

  test("false for multi-codepoint strings", () => {
    expect(isPrintableChar("ab")).toBe(false);
    expect(isPrintableChar("😀a")).toBe(false);
  });
});

describe("lineEditStateAtEnd", () => {
  test("cursor at codepoint length of query", () => {
    expect(lineEditStateAtEnd("")).toEqual({ cursor: 0, query: "" });
    expect(lineEditStateAtEnd("abc")).toEqual({ cursor: 3, query: "abc" });
    expect(lineEditStateAtEnd("a😀b")).toEqual({ cursor: 3, query: "a😀b" });
  });
});
