import { describe, expect, it } from "bun:test";

import {
  borderCharsForStyle,
  computeHoneybeamMaxCol,
  computeHoneybeamOffsets,
  computeHoneybeamSplitRow,
} from "./honeybeam-animation.ts";

describe("computeHoneybeamOffsets", () => {
  it("uses top chrome height for full/marquee terminal areas", () => {
    expect(computeHoneybeamOffsets({ height: 40, rows: 37 })).toEqual({
      colOffset: 0,
      rowOffset: 3,
    });
  });

  it("uses zero offset for raw mode", () => {
    expect(computeHoneybeamOffsets({ height: 40, rows: 40 })).toEqual({
      colOffset: 0,
      rowOffset: 0,
    });
  });

  it("never returns a negative row offset", () => {
    expect(computeHoneybeamOffsets({ height: 2, rows: 3 })).toEqual({
      colOffset: 0,
      rowOffset: 0,
    });
  });

  it("clips the right tool bar when toolbar is open", () => {
    expect(computeHoneybeamMaxCol({ width: 120 }, true)).toBe(111);
  });

  it("does not clip columns when toolbar is closed", () => {
    expect(computeHoneybeamMaxCol({ width: 120 }, false)).toBeUndefined();
  });
});

describe("computeHoneybeamSplitRow", () => {
  // Values match what tmux actually does for split-window (vertical tmux
  // split → horizontal separator). Verified empirically against tmux 3.5.
  it("handles the top-of-window pane under pane-border-status=top (paneTop=1)", () => {
    // The top-of-window pane's cell includes its status row (row 0), so
    // cellSy = paneHeight + 1 and the separator lands at floor(cellSy/2).
    expect(computeHoneybeamSplitRow(1, 23)).toBe(12);
    expect(computeHoneybeamSplitRow(1, 24)).toBe(12);
    expect(computeHoneybeamSplitRow(1, 25)).toBe(13);
    expect(computeHoneybeamSplitRow(1, 26)).toBe(13);
    expect(computeHoneybeamSplitRow(1, 44)).toBe(22);
    expect(computeHoneybeamSplitRow(1, 45)).toBe(23);
  });

  it("handles non-top panes (cell equals pane, status is in the border above)", () => {
    // Regression for the original bug: splitting a pane at paneTop>1
    // (e.g. the bottom half of a prior split) must use cell = pane, so
    // the separator lands at paneTop + floor(paneHeight/2). Window sy=45
    // split once gives %1 pt=23 ph=22; splitting %1 again must put the
    // separator at row 34, not 33.
    expect(computeHoneybeamSplitRow(23, 22)).toBe(34);
    expect(computeHoneybeamSplitRow(23, 11)).toBe(28);
    expect(computeHoneybeamSplitRow(16, 14)).toBe(23);
  });

  it("handles the top-of-window pane under pane-border-status=off (paneTop=0)", () => {
    expect(computeHoneybeamSplitRow(0, 24)).toBe(12);
    expect(computeHoneybeamSplitRow(0, 25)).toBe(12);
    expect(computeHoneybeamSplitRow(0, 26)).toBe(13);
    expect(computeHoneybeamSplitRow(0, 30)).toBe(15);
  });
});

describe("borderCharsForStyle", () => {
  it("returns light box-drawing chars for single", () => {
    expect(borderCharsForStyle("single")).toEqual({ horizontal: "─", vertical: "│" });
  });

  it("returns double box-drawing chars for double", () => {
    expect(borderCharsForStyle("double")).toEqual({ horizontal: "═", vertical: "║" });
  });

  it("returns heavy box-drawing chars for heavy", () => {
    expect(borderCharsForStyle("heavy")).toEqual({ horizontal: "━", vertical: "┃" });
  });

  it("returns ASCII chars for simple", () => {
    expect(borderCharsForStyle("simple")).toEqual({ horizontal: "-", vertical: "|" });
  });

  it("returns single-style chars for number", () => {
    expect(borderCharsForStyle("number")).toEqual({ horizontal: "─", vertical: "│" });
  });
});
