import { describe, expect, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import {
  findPaneTabGroupByPaneId,
  findPaneTabGroupEntriesByWindowId,
  findPaneTabGroupEntryByPaneId,
  findPaneTabGroupForWindow,
  groupOwnsHostWindowName,
  hasRefreshablePaneTabLabels,
  paneNeedsPaneTabLabelRefresh,
} from "./selectors.ts";

describe("pane tab selectors", () => {
  const groups = new Map<string, PaneTabGroup>([
    [
      "slot-1",
      {
        activeIndex: 0,
        restoreAutomaticRename: true,
        slotHeight: 24,
        slotKey: "slot-1",
        slotWidth: 80,
        tabs: [
          { label: "bash", paneId: "%1" },
          { label: "logs", paneId: "%2", userLabel: "logs" },
        ],
        windowId: "@1",
      },
    ],
    [
      "slot-2",
      {
        activeIndex: 0,
        explicitWindowName: "workspace",
        slotHeight: 24,
        slotKey: "slot-2",
        slotWidth: 80,
        tabs: [{ label: "htop", paneId: "%3" }],
        windowId: "@1",
      },
    ],
    [
      "slot-3",
      {
        activeIndex: 0,
        slotHeight: 24,
        slotKey: "slot-3",
        slotWidth: 80,
        tabs: [{ label: "Claude", paneId: "%4", userLabel: "Claude" }],
        windowId: "@2",
      },
    ],
  ]);

  test("finds all groups for a window", () => {
    expect(findPaneTabGroupEntriesByWindowId(groups, "@1").map(([slotKey]) => slotKey)).toEqual(["slot-1", "slot-2"]);
    expect(findPaneTabGroupEntriesByWindowId(groups, "@9")).toEqual([]);
  });

  test("finds group entries by pane id", () => {
    expect(findPaneTabGroupEntryByPaneId(groups, "%3")).toEqual(["slot-2", groups.get("slot-2")!]);
    expect(findPaneTabGroupEntryByPaneId(groups, "%9")).toBeUndefined();
  });

  test("finds groups by pane id", () => {
    expect(findPaneTabGroupByPaneId(groups, "%2")?.slotKey).toBe("slot-1");
    expect(findPaneTabGroupByPaneId(groups, "%9")).toBeUndefined();
  });

  test("finds the first group for a window", () => {
    expect(findPaneTabGroupForWindow(groups, "@1")?.slotKey).toBe("slot-1");
    expect(findPaneTabGroupForWindow(groups, "@9")).toBeUndefined();
  });

  test("tracks managed host window ownership", () => {
    expect(groupOwnsHostWindowName(groups.get("slot-1")!)).toBe(true);
    expect(groupOwnsHostWindowName(groups.get("slot-2")!)).toBe(true);
    expect(groupOwnsHostWindowName(groups.get("slot-3")!)).toBe(false);
  });

  test("detects when any pane-tab label still depends on pane_current_command", () => {
    expect(hasRefreshablePaneTabLabels(groups)).toBe(true);
    expect(paneNeedsPaneTabLabelRefresh(groups, "%1")).toBe(true);
    expect(paneNeedsPaneTabLabelRefresh(groups, "%2")).toBe(false);
    expect(paneNeedsPaneTabLabelRefresh(groups, "%9")).toBe(false);
  });

  test("skips label refresh tracking when all tab labels are user-defined", () => {
    const userNamedGroups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "Claude", paneId: "%1", userLabel: "Claude" },
            { label: "Logs", paneId: "%2", userLabel: "Logs" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    expect(hasRefreshablePaneTabLabels(userNamedGroups)).toBe(false);
    expect(paneNeedsPaneTabLabelRefresh(userNamedGroups, "%1")).toBe(false);
  });
});
