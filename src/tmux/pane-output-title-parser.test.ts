import { expect, test } from "bun:test";

import { initialPaneOutputTitleParserState, parsePaneOutputTitleUpdate } from "./pane-output-title-parser.ts";

test("extracts OSC 2 titles terminated by ST", () => {
  const update = parsePaneOutputTitleUpdate("\x1b]2;Claude Code\x1b\\", initialPaneOutputTitleParserState());

  expect(update.title).toBe("Claude Code");
  expect(update.state).toEqual(initialPaneOutputTitleParserState());
});

test("extracts OSC 0 titles terminated by BEL", () => {
  const update = parsePaneOutputTitleUpdate("\x1b]0;spinner 42\x07", initialPaneOutputTitleParserState());

  expect(update.title).toBe("spinner 42");
});

test("ignores non-title OSC sequences", () => {
  const update = parsePaneOutputTitleUpdate(
    "\x1b]133;A\x1b\\prompt\x1b]3008;type=shell\x1b\\",
    initialPaneOutputTitleParserState(),
  );

  expect(update.title).toBeUndefined();
  expect(update.state).toEqual(initialPaneOutputTitleParserState());
});

test("reassembles split OSC title sequences across chunks", () => {
  const partial = parsePaneOutputTitleUpdate("\x1b]2;Claude", initialPaneOutputTitleParserState());
  expect(partial.title).toBeUndefined();
  expect(partial.state.carry).toBe("\x1b]2;Claude");

  const completed = parsePaneOutputTitleUpdate(" Code\x1b\\", partial.state);
  expect(completed.title).toBe("Claude Code");
  expect(completed.state).toEqual(initialPaneOutputTitleParserState());
});

test("reassembles a split ESC prefix across chunks", () => {
  const partial = parsePaneOutputTitleUpdate("\x1b", initialPaneOutputTitleParserState());
  expect(partial.state.carry).toBe("\x1b");

  const completed = parsePaneOutputTitleUpdate("]2;bow\x07", partial.state);
  expect(completed.title).toBe("bow");
});

test("keeps only the last title from a chunk with multiple title updates", () => {
  const update = parsePaneOutputTitleUpdate(
    "\x1b]2;first\x1b\\plain\x1b]0;second\x07",
    initialPaneOutputTitleParserState(),
  );

  expect(update.title).toBe("second");
});

test("drops oversized unterminated OSC payloads and resynchronizes at the next terminator", () => {
  const oversized = `\x1b]2;${"x".repeat(4097)}`;
  const partial = parsePaneOutputTitleUpdate(oversized, initialPaneOutputTitleParserState());

  expect(partial.title).toBeUndefined();
  expect(partial.state.carry).toBe("");
  expect(partial.state.discardingOsc).toBe(true);

  const resynced = parsePaneOutputTitleUpdate("\x07\x1b]2;ok\x1b\\", partial.state);
  expect(resynced.title).toBe("ok");
  expect(resynced.state).toEqual(initialPaneOutputTitleParserState());
});

test("does not get stuck if a bare ESC is followed by non-OSC output", () => {
  const partial = parsePaneOutputTitleUpdate("\x1b", initialPaneOutputTitleParserState());
  const next = parsePaneOutputTitleUpdate("hello", partial.state);

  expect(next.title).toBeUndefined();
  expect(next.state).toEqual(initialPaneOutputTitleParserState());
});
