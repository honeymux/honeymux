import { describe, expect, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import { buildPaneCycleModel } from "./navigation.ts";

describe("pane tab navigation", () => {
  test("expands a visible tab group into per-tab cycle entries", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const model = buildPaneCycleModel({
      activePaneIndex: 0,
      enabled: true,
      groups,
      panes: [{ id: "%2" }, { id: "%3" }],
    });

    expect(model.currentIndex).toBe(1);
    expect(model.entries).toEqual([
      { paneId: "%1", slotKey: "slot-1", tabIndex: 0 },
      { paneId: "%2", slotKey: "slot-1", tabIndex: 1 },
      { paneId: "%3" },
    ]);
  });

  test("ignores pane-tab groups when pane tabs are disabled", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const model = buildPaneCycleModel({
      activePaneIndex: 0,
      enabled: false,
      groups,
      panes: [{ id: "%2" }, { id: "%3" }],
    });

    expect(model.currentIndex).toBe(0);
    expect(model.entries).toEqual([{ paneId: "%2" }, { paneId: "%3" }]);
  });
});
