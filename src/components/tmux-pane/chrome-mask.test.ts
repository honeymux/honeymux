import { describe, expect, it } from "bun:test";

import { computeReservedRightChromeMask } from "./chrome-mask.ts";

describe("tmux pane reserved chrome mask", () => {
  it("returns null when the terminal already fills the visible width", () => {
    expect(
      computeReservedRightChromeMask({
        terminalCols: 100,
        terminalRows: 37,
        uiMode: "adaptive",
        width: 100,
      }),
    ).toBeNull();
  });

  it("reserves the toolbar and gutter columns below the tab bar", () => {
    expect(
      computeReservedRightChromeMask({
        terminalCols: 81,
        terminalRows: 36,
        uiMode: "adaptive",
        width: 89,
      }),
    ).toEqual({
      height: 36,
      left: 81,
      top: 3,
      width: 8,
    });
  });

  it("accounts for the sidebar offset and marquee-bottom content origin", () => {
    expect(
      computeReservedRightChromeMask({
        sidebarOpen: true,
        sidebarWidth: 24,
        terminalCols: 81,
        terminalRows: 33,
        uiMode: "marquee-bottom",
        width: 120,
      }),
    ).toEqual({
      height: 33,
      left: 106,
      top: 0,
      width: 14,
    });
  });
});
