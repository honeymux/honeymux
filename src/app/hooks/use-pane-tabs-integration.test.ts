import { describe, expect, test } from "bun:test";

import { countInactivePaneTabs, shouldConfirmPaneTabsDisable } from "./use-pane-tabs-integration.ts";

describe("pane tabs integration helpers", () => {
  test("counts inactive tabs across all groups", () => {
    const groups = new Map([
      [
        "slot-a",
        {
          activeIndex: 0,
          slotHeight: 20,
          slotKey: "slot-a",
          slotWidth: 100,
          tabs: [{ paneId: "%1" }, { paneId: "%2" }, { paneId: "%3" }],
        },
      ],
      [
        "slot-b",
        {
          activeIndex: 0,
          slotHeight: 20,
          slotKey: "slot-b",
          slotWidth: 80,
          tabs: [{ paneId: "%4" }],
        },
      ],
    ]);

    expect(countInactivePaneTabs(groups as any)).toBe(2);
  });

  test("only prompts for confirmation when disabling with inactive tabs", () => {
    expect(shouldConfirmPaneTabsDisable(false, 2)).toBe(true);
    expect(shouldConfirmPaneTabsDisable(false, 0)).toBe(false);
    expect(shouldConfirmPaneTabsDisable(true, 2)).toBe(false);
  });
});
