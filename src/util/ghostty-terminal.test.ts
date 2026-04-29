import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import { describe, expect, test } from "bun:test";

import type { ActivePaneRect } from "./ghostty-terminal.ts";

import { filterCursorAgainstActiveRect, prepareGhosttyTerminalForTmux } from "./ghostty-terminal.ts";

const MAX_NATIVE_OFFSET = 0xffff_ffff;

interface FakeTerminalData {
  lines: string[];
  offset: number;
  rows: number;
  totalLines: number;
}

function createTerminal(totalLines: number, rows: number) {
  const feedCalls: string[] = [];
  const getJsonCalls: Array<{ limit?: number; offset?: number }> = [];

  const baseData = (options: { limit?: number; offset?: number } = {}): FakeTerminalData => {
    getJsonCalls.push(options);

    const offset = options.offset ?? 0;
    const limit = options.limit ?? totalLines;
    const lineCount = Math.max(0, Math.min(limit, totalLines - offset));

    return {
      lines: Array.from({ length: lineCount }, (_, index) => `Line ${offset + index + 1}`),
      offset,
      rows,
      totalLines,
    };
  };

  const terminal = {
    _persistentTerminal: {
      getJson: baseData,
    },
    feed(data: string) {
      feedCalls.push(data);
    },
  } as unknown as GhosttyTerminalRenderable;

  return { feedCalls, getJsonCalls, terminal };
}

describe("prepareGhosttyTerminalForTmux", () => {
  test("pages directly to the visible rows when scrollback exists", () => {
    const { feedCalls, getJsonCalls, terminal } = createTerminal(120, 24);

    prepareGhosttyTerminalForTmux(terminal);
    const data = (
      terminal as unknown as {
        _persistentTerminal: { getJson: (options?: { limit?: number; offset?: number }) => FakeTerminalData };
      }
    )._persistentTerminal.getJson();

    expect(feedCalls).toEqual(["\x1b[20l", "\x1b[?2027h"]);
    expect(getJsonCalls).toEqual([
      { limit: 1, offset: MAX_NATIVE_OFFSET },
      { limit: 24, offset: 96 },
    ]);
    expect(data.offset).toBe(96);
    expect(data.lines).toHaveLength(24);
    expect(data.lines[0]).toBe("Line 97");
  });

  test("preserves explicit pagination requests", () => {
    const { getJsonCalls, terminal } = createTerminal(120, 24);

    prepareGhosttyTerminalForTmux(terminal);
    const data = (
      terminal as unknown as {
        _persistentTerminal: { getJson: (options?: { limit?: number; offset?: number }) => FakeTerminalData };
      }
    )._persistentTerminal.getJson({ limit: 5, offset: 10 });

    expect(getJsonCalls).toEqual([{ limit: 5, offset: 10 }]);
    expect(data.offset).toBe(10);
    expect(data.lines).toHaveLength(5);
    expect(data.lines[0]).toBe("Line 11");
  });

  test("rewrites cursor and visibility outside the active pane to last-known-good", () => {
    const cursorRef: { current: ActivePaneRect | null } = {
      current: { height: 30, left: 0, top: 30, width: 200 },
    };
    let nextCursor: [number, number] = [10, 35];
    let nextVisible: boolean = true;

    const baseData = (options: { limit?: number; offset?: number } = {}) => {
      const o = options.offset ?? 0;
      const l = options.limit ?? 60;
      return {
        cursor: [...nextCursor] as [number, number],
        cursorVisible: nextVisible,
        lines: Array.from({ length: Math.max(0, Math.min(l, 60 - o)) }, () => "x"),
        offset: o,
        rows: 30,
        totalLines: 60,
      };
    };
    const terminal = {
      _persistentTerminal: { getJson: baseData },
      feed: () => {},
    } as unknown as GhosttyTerminalRenderable;

    prepareGhosttyTerminalForTmux(terminal, { activePaneRectRef: cursorRef });
    const getJson = (
      terminal as unknown as {
        _persistentTerminal: {
          getJson: (options?: {
            limit?: number;
            offset?: number;
          }) => { cursor: [number, number]; cursorVisible: boolean } & FakeTerminalData;
        };
      }
    )._persistentTerminal.getJson;

    let r = getJson();
    expect(r.cursor).toEqual([10, 35]);
    expect(r.cursorVisible).toBe(true);

    // Buffer cursor jumps outside active pane and visibility flips false (e.g.,
    // tmux brackets a non-active pane's paint with ?25l). Both fields must be
    // substituted with the last-good values from when the cursor was inside.
    nextCursor = [60, 5];
    nextVisible = false;
    r = getJson();
    expect(r.cursor).toEqual([10, 35]);
    expect(r.cursorVisible).toBe(true);

    // Cursor lands back inside the active pane while visibility is still false
    // — that's a legitimate hide by an app in the focused pane, honor it.
    nextCursor = [50, 40];
    nextVisible = false;
    r = getJson();
    expect(r.cursor).toEqual([50, 40]);
    expect(r.cursorVisible).toBe(false);

    // Bouncing back outside again: substitute uses the now-false last-good.
    nextCursor = [70, 10];
    nextVisible = true;
    r = getJson();
    expect(r.cursor).toEqual([50, 40]);
    expect(r.cursorVisible).toBe(false);
  });
});

describe("filterCursorAgainstActiveRect", () => {
  test("returns the cursor unchanged when there is no rect", () => {
    const state = { lastRect: null, lastValid: null };
    expect(filterCursorAgainstActiveRect([10, 5], true, null, state)).toEqual({ cursor: [10, 5], visible: true });
    expect(filterCursorAgainstActiveRect([10, 5], false, null, state)).toEqual({ cursor: [10, 5], visible: false });
  });

  test("accepts cursors inside the rect and remembers them", () => {
    const rect: ActivePaneRect = { height: 10, left: 0, top: 0, width: 20 };
    const state = { lastRect: null, lastValid: null };
    expect(filterCursorAgainstActiveRect([5, 5], true, rect, state)).toEqual({ cursor: [5, 5], visible: true });
    expect(filterCursorAgainstActiveRect([19, 9], false, rect, state)).toEqual({ cursor: [19, 9], visible: false });
  });

  test("substitutes both cursor and visibility when buffer reports outside the rect", () => {
    const rect: ActivePaneRect = { height: 10, left: 0, top: 0, width: 20 };
    const state = { lastRect: null, lastValid: null };
    filterCursorAgainstActiveRect([5, 5], true, rect, state);
    // Buffer flipped to invisible while cursor is in another pane; substitute.
    expect(filterCursorAgainstActiveRect([100, 100], false, rect, state)).toEqual({ cursor: [5, 5], visible: true });
    // Cursor returns inside the rect: accept buffer's values again.
    expect(filterCursorAgainstActiveRect([7, 8], false, rect, state)).toEqual({ cursor: [7, 8], visible: false });
    // Now last-good visibility is false; outside-rect calls inherit it.
    expect(filterCursorAgainstActiveRect([100, 100], true, rect, state)).toEqual({ cursor: [7, 8], visible: false });
  });

  test("treats rect upper boundary as exclusive (cell at left+width is outside)", () => {
    const rect: ActivePaneRect = { height: 10, left: 0, top: 0, width: 20 };
    const state = { lastRect: null, lastValid: null };
    filterCursorAgainstActiveRect([5, 5], true, rect, state);
    expect(filterCursorAgainstActiveRect([20, 5], true, rect, state)).toEqual({ cursor: [5, 5], visible: true });
    expect(filterCursorAgainstActiveRect([5, 10], true, rect, state)).toEqual({ cursor: [5, 5], visible: true });
  });

  test("clamps stale last-valid into a new rect when the active pane changes", () => {
    const rectA: ActivePaneRect = { height: 10, left: 0, top: 0, width: 20 };
    const rectB: ActivePaneRect = { height: 10, left: 100, top: 50, width: 20 };
    const state = { lastRect: null, lastValid: null };
    filterCursorAgainstActiveRect([5, 5], true, rectA, state);
    expect(filterCursorAgainstActiveRect([200, 200], true, rectB, state)).toEqual({
      cursor: [100, 50],
      visible: true,
    });
    expect(filterCursorAgainstActiveRect([110, 55], true, rectB, state)).toEqual({
      cursor: [110, 55],
      visible: true,
    });
  });

  test("preserves visibility across rect changes", () => {
    const rectA: ActivePaneRect = { height: 10, left: 0, top: 0, width: 20 };
    const rectB: ActivePaneRect = { height: 10, left: 100, top: 50, width: 20 };
    const state = { lastRect: null, lastValid: null };
    filterCursorAgainstActiveRect([5, 5], false, rectA, state);
    // New rect, buffer reports outside — fallback uses preserved visibility.
    expect(filterCursorAgainstActiveRect([200, 200], true, rectB, state)).toEqual({
      cursor: [100, 50],
      visible: false,
    });
  });

  test("seeds at rect origin when no prior cursor was seen", () => {
    const rect: ActivePaneRect = { height: 10, left: 30, top: 40, width: 20 };
    const state = { lastRect: null, lastValid: null };
    expect(filterCursorAgainstActiveRect([0, 0], false, rect, state)).toEqual({ cursor: [30, 40], visible: true });
  });

  test("accepts cursor exactly at rect.left/top (lower boundary inclusive)", () => {
    const rect: ActivePaneRect = { height: 10, left: 5, top: 7, width: 20 };
    const state = { lastRect: null, lastValid: null };
    expect(filterCursorAgainstActiveRect([5, 7], true, rect, state)).toEqual({ cursor: [5, 7], visible: true });
  });
});
