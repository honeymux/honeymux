import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import { describe, expect, test } from "bun:test";

import { prepareGhosttyTerminalForTmux } from "./ghostty-terminal.ts";

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

    expect(feedCalls).toEqual(["\x1b[20l"]);
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
});
