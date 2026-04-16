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

  test("splits muxotron clicks into notification and agent halves", () => {
    expect(getMuxotronClickZone(100, 20, 39)).toBeNull();
    expect(getMuxotronClickZone(100, 20, 44)).toBe("notifications");
    expect(getMuxotronClickZone(100, 20, 55)).toBe("agents");
    expect(getMuxotronClickZone(100, 20, 60)).toBeNull();
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
