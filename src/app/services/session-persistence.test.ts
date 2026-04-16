import { describe, expect, test } from "bun:test";

import type { PaneTabGroup } from "../pane-tabs/types.ts";

import { buildPaneTabPersistState } from "./session-persistence.ts";

describe("session persistence", () => {
  test("buildPaneTabPersistState snapshots active pane ids and tab labels", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 1,
          explicitWindowName: "workspace",
          restoreAutomaticRename: false,
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
    ]);

    expect(buildPaneTabPersistState(groups, "double")).toEqual({
      borderLines: "double",
      groups: [
        {
          activePaneId: "%2",
          explicitWindowName: "workspace",
          restoreAutomaticRename: false,
          slotKey: "slot-1",
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2", userLabel: "logs" },
          ],
        },
      ],
    });
  });
});
