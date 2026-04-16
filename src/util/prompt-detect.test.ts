import { expect, test } from "bun:test";

import { analyzePromptChunk, initialPanePromptTapState } from "./prompt-detect.ts";

test("OSC 133 prompt markers toggle prompt mode", () => {
  const start = analyzePromptChunk("\x1b]133;A\x1b\\", initialPanePromptTapState());
  expect(start.hasPromptMarks).toBe(true);
  expect(start.atPrompt).toBe(true);

  const output = analyzePromptChunk("\x1b]133;C\x1b\\", start);
  expect(output.hasPromptMarks).toBe(true);
  expect(output.atPrompt).toBe(false);
});

test("OSC 133 prompt end marker keeps prompt mode active", () => {
  const state = analyzePromptChunk("\x1b]133;A\x1b\\prompt>\x1b]133;B\x1b\\", initialPanePromptTapState());
  expect(state.hasPromptMarks).toBe(true);
  expect(state.atPrompt).toBe(true);
});

test("OSC 3008 shell and command markers toggle prompt mode", () => {
  const shell = analyzePromptChunk("\x1b]3008;start=shell-id;type=shell;cwd=/tmp\x1b\\", initialPanePromptTapState());
  expect(shell.hasPromptMarks).toBe(true);
  expect(shell.atPrompt).toBe(true);

  const command = analyzePromptChunk("\x1b]3008;start=cmd-id;type=command;cwd=/tmp\x1b\\", shell);
  expect(command.hasPromptMarks).toBe(true);
  expect(command.atPrompt).toBe(false);
});

test("partial OSC sequences are reassembled across chunks", () => {
  const partial = analyzePromptChunk("\x1b]133;", initialPanePromptTapState());
  expect(partial.hasPromptMarks).toBe(false);
  expect(partial.carry).toBe("\x1b]133;");

  const completed = analyzePromptChunk("A\x1b\\", partial);
  expect(completed.hasPromptMarks).toBe(true);
  expect(completed.atPrompt).toBe(true);
});

test("split OSC prefix is reassembled across chunks", () => {
  const partial = analyzePromptChunk("\x1b", initialPanePromptTapState());
  expect(partial.hasPromptMarks).toBe(false);
  expect(partial.carry).toBe("\x1b");

  const completed = analyzePromptChunk("]133;C\x1b\\", partial);
  expect(completed.hasPromptMarks).toBe(true);
  expect(completed.atPrompt).toBe(false);
});

test("plain text does not change prompt state", () => {
  const state = analyzePromptChunk("echo hello\r\n", initialPanePromptTapState());
  expect(state.hasPromptMarks).toBe(false);
  expect(state.atPrompt).toBe(false);
});
