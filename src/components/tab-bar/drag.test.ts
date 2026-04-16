import { describe, expect, it } from "bun:test";

import { computeDragDisplayState, computeDropIndexForDrag } from "./drag.ts";

const windows = [
  { active: false, id: "@1", index: 1, layout: "", name: "one", paneId: "%1" },
  { active: true, id: "@2", index: 2, layout: "", name: "two", paneId: "%2" },
  { active: false, id: "@3", index: 3, layout: "", name: "three", paneId: "%3" },
];

describe("tab-bar drag helpers", () => {
  it("computes display state for active drag reorder preview", () => {
    const state = computeDragDisplayState({
      activeIndex: 1,
      dragFrom: 1,
      dragOver: 2,
      hasOverflow: false,
      visibleActiveIndex: 1,
      visibleWindows: windows,
      windows,
    });

    expect(state.displayWindows.map((w) => w.id)).toEqual(["@1", "@3", "@2"]);
    expect(state.displayActiveIndex).toBe(2);
    expect(state.displaySlotIndex).toBe(2);
  });

  it("keeps overflow-visible subset when not dragging reorder target", () => {
    const visibleWindows = windows.slice(0, 2);
    const state = computeDragDisplayState({
      activeIndex: 2,
      dragFrom: null,
      dragOver: null,
      hasOverflow: true,
      visibleActiveIndex: -1,
      visibleWindows,
      windows,
    });

    expect(state.displayWindows).toEqual(visibleWindows);
    expect(state.displayActiveIndex).toBe(-1);
    expect(state.displaySlotIndex).toBe(-1);
  });

  it("computes drop index from dragged tab position", () => {
    const from = 1;
    expect(computeDropIndexForDrag(windows, from, 0)).toBe(0);
    expect(computeDropIndexForDrag(windows, from, 14)).toBe(1);
    expect(computeDropIndexForDrag(windows, from, 40)).toBe(2);
  });

  it("uses terminal cell widths for wide tab labels", () => {
    const wideWindows = [
      { active: false, id: "@1", index: 1, layout: "", name: "漢字", paneId: "%1" },
      { active: true, id: "@2", index: 2, layout: "", name: "vim", paneId: "%2" },
      { active: false, id: "@3", index: 3, layout: "", name: "編譯器", paneId: "%3" },
    ];

    expect(computeDropIndexForDrag(wideWindows, 0, 2, 2)).toBe(0);
    expect(computeDropIndexForDrag(wideWindows, 0, 20, 2)).toBe(2);
  });
});
