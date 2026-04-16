import { describe, expect, test } from "bun:test";

import { getConversationsViewForAbsoluteIndex, getOldestConversationsPageOffset } from "./use-history-workflow.ts";

describe("getOldestConversationsPageOffset", () => {
  test("aligns the oldest page to a page boundary", () => {
    expect(getOldestConversationsPageOffset(1088)).toBe(1050);
    expect(getOldestConversationsPageOffset(428)).toBe(400);
    expect(getOldestConversationsPageOffset(50)).toBe(0);
  });
});

describe("getConversationsViewForAbsoluteIndex", () => {
  test("maps an absolute result index to a bounded page window", () => {
    expect(getConversationsViewForAbsoluteIndex(0, 1088)).toEqual({
      loadedCount: 50,
      offset: 0,
      resultIndex: 0,
    });
    expect(getConversationsViewForAbsoluteIndex(62, 1088)).toEqual({
      loadedCount: 50,
      offset: 50,
      resultIndex: 12,
    });
    expect(getConversationsViewForAbsoluteIndex(1087, 1088)).toEqual({
      loadedCount: 50,
      offset: 1050,
      resultIndex: 37,
    });
  });

  test("clamps out-of-range indexes safely", () => {
    expect(getConversationsViewForAbsoluteIndex(-10, 20)).toEqual({
      loadedCount: 50,
      offset: 0,
      resultIndex: 0,
    });
    expect(getConversationsViewForAbsoluteIndex(999, 20)).toEqual({
      loadedCount: 50,
      offset: 0,
      resultIndex: 19,
    });
  });
});
