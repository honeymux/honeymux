import { describe, expect, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import { planGroupTabRemoval, planInsertTab, planNewTabGroup, planReorderTabs, planSwitchTab } from "./transitions.ts";

describe("pane tab transitions", () => {
  const sampleGroup: PaneTabGroup = {
    activeIndex: 1,
    slotHeight: 24,
    slotKey: "slot-1",
    slotWidth: 80,
    tabs: [
      { label: "bash", paneId: "%1" },
      { label: "logs", paneId: "%2" },
      { label: "shell", paneId: "%3" },
    ],
    windowId: "@1",
  };

  test("planNewTabGroup creates a new two-tab group", () => {
    const plan = planNewTabGroup({
      currentLabel: "bash",
      currentPaneId: "%1",
      height: 24,
      newLabel: "htop",
      newPaneId: "%9",
      slotKey: "slot-1",
      width: 80,
      windowId: "@1",
    });

    expect(plan).toEqual({
      activeIndex: 1,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "htop", paneId: "%9" },
      ],
      windowId: "@1",
    });
  });

  test("planSwitchTab updates the active index and visible window", () => {
    const plan = planSwitchTab(sampleGroup, 2, "@9");

    expect(plan?.currentPaneId).toBe("%2");
    expect(plan?.targetPaneId).toBe("%3");
    expect(plan?.updatedGroup.activeIndex).toBe(2);
    expect(plan?.updatedGroup.windowId).toBe("@9");
  });

  test("planGroupTabRemoval can treat a visible stale tab as the removed active tab", () => {
    const staleGroup: PaneTabGroup = {
      ...sampleGroup,
      activeIndex: 2,
    };

    const plan = planGroupTabRemoval(staleGroup, 1, {
      preferredWindowId: "@0",
      treatRemovedAsActive: true,
    });

    expect(plan?.removedWasActive).toBe(true);
    expect(plan?.remainingTabs.map((tab) => tab.paneId)).toEqual(["%1", "%3"]);
    expect(plan?.nextActiveIndex).toBe(1);
    expect(plan?.nextActivePaneId).toBe("%3");
    expect(plan?.updatedGroup?.windowId).toBe("@0");
  });

  test("planReorderTabs keeps the moved active tab active", () => {
    const plan = planReorderTabs(sampleGroup, 1, 0);

    expect(plan?.updatedGroup.tabs.map((tab) => tab.paneId)).toEqual(["%2", "%1", "%3"]);
    expect(plan?.updatedGroup.activeIndex).toBe(0);
    expect(plan?.activePaneId).toBe("%2");
  });

  test("planInsertTab makes the inserted tab active", () => {
    const insertPlan = planInsertTab(sampleGroup, { label: "tail", paneId: "%9" }, 1);
    expect(insertPlan.updatedGroup.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%9", "%2", "%3"]);
    expect(insertPlan.updatedGroup.activeIndex).toBe(1);
  });
});
