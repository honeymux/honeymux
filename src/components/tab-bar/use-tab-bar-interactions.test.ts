import { describe, expect, test } from "bun:test";

import { tabBoundsFromIndex } from "./layout.ts";
import {
  getMuxotronClickZone,
  isModifierSecondaryClick,
  tabIndexFromXWithTolerance,
} from "./use-tab-bar-interactions.ts";

describe("tab-bar interactions helpers", () => {
  test("treats ctrl/alt + left click as secondary click", () => {
    expect(isModifierSecondaryClick({ button: 0, modifiers: { ctrl: true } } as any)).toBe(true);
    expect(isModifierSecondaryClick({ button: 0, modifiers: { alt: true } } as any)).toBe(true);
    expect(isModifierSecondaryClick({ button: 0, modifiers: {} } as any)).toBe(false);
    expect(isModifierSecondaryClick({ button: 2, modifiers: { ctrl: true } } as any)).toBe(false);
  });

  test("routes muxotron clicks by zone", () => {
    // Width 100, muxotron 20 wide, so muxotronLeft = 40.
    expect(getMuxotronClickZone(100, 20, 39)).toBeNull(); // outside left
    expect(getMuxotronClickZone(100, 20, 40)).toBeNull(); // left vBar
    expect(getMuxotronClickZone(100, 20, 41)).toBeNull(); // padding before badge
    expect(getMuxotronClickZone(100, 20, 42)).toBe("notifications"); // badge slot start
    expect(getMuxotronClickZone(100, 20, 47)).toBe("notifications"); // badge slot end
    expect(getMuxotronClickZone(100, 20, 48)).toBe("agents"); // padding column left of sine wave
    expect(getMuxotronClickZone(100, 20, 49)).toBe("agents"); // sine wave left extent
    expect(getMuxotronClickZone(100, 20, 55)).toBe("agents"); // middle of agents zone
    expect(getMuxotronClickZone(100, 20, 59)).toBe("agents"); // right vBar (inclusive)
    expect(getMuxotronClickZone(100, 20, 60)).toBeNull(); // outside right
  });

  test("finds the nearest tab when the click lands one column outside the hit box", () => {
    const windows = [
      { active: true, id: "@1", index: 0, layout: "", name: "alpha", paneId: "%1" },
      { active: false, id: "@2", index: 1, layout: "", name: "beta", paneId: "%2" },
    ];
    const displayNames = ["alpha", "beta"];
    const leftReserve = 2;
    const firstBounds = tabBoundsFromIndex(windows, 0, leftReserve, 0, false, displayNames);
    const secondBounds = tabBoundsFromIndex(windows, 1, leftReserve, 0, false, displayNames);

    expect(firstBounds).not.toBeNull();
    expect(secondBounds).not.toBeNull();
    expect(tabIndexFromXWithTolerance(windows, firstBounds!.left - 1, 0, false, leftReserve, displayNames)).toBe(0);
    expect(
      tabIndexFromXWithTolerance(
        windows,
        secondBounds!.left + secondBounds!.width,
        0,
        false,
        leftReserve,
        displayNames,
      ),
    ).toBe(1);
  });
});
