import { expect, test } from "bun:test";

import { computePromptClickDelta } from "./prompt-click-region.ts";

test("computes same-row deltas", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 80,
        cursorX: 18,
        cursorY: 4,
        endX: 24,
        endY: 4,
        startX: 10,
        startY: 4,
      },
      13,
      4,
    ),
  ).toBe(-5);
});

test("computes wrapped-line deltas", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 10,
        cursorX: 4,
        cursorY: 4,
        endX: 6,
        endY: 4,
        startX: 7,
        startY: 2,
      },
      8,
      2,
    ),
  ).toBe(-16);
});

test("clamps clicks before the editable start on the first row", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 80,
        cursorX: 18,
        cursorY: 3,
        endX: 18,
        endY: 3,
        startX: 12,
        startY: 3,
      },
      4,
      3,
    ),
  ).toBe(-6);
});

test("clamps clicks after the cursor on the last row", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 10,
        cursorX: 4,
        cursorY: 4,
        endX: 6,
        endY: 4,
        startX: 7,
        startY: 2,
      },
      9,
      4,
    ),
  ).toBe(2);
});

test("rejects clicks outside the wrapped prompt rows", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 80,
        cursorX: 18,
        cursorY: 4,
        endX: 24,
        endY: 4,
        startX: 10,
        startY: 4,
      },
      10,
      3,
    ),
  ).toBeNull();
});

test("moves forward on an unwrapped line", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 80,
        cursorX: 18,
        cursorY: 4,
        endX: 24,
        endY: 4,
        startX: 10,
        startY: 4,
      },
      22,
      4,
    ),
  ).toBe(4);
});

test("snaps past-end clicks to the visible input end", () => {
  expect(
    computePromptClickDelta(
      {
        cols: 80,
        cursorX: 18,
        cursorY: 4,
        endX: 24,
        endY: 4,
        startX: 10,
        startY: 4,
      },
      70,
      4,
    ),
  ).toBe(6);
});
