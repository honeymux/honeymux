import { describe, expect, mock, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import { pruneShadowedSinglePaneGroups, syncPaneTabMarkers } from "./group-sync.ts";

class FakeGroupSyncClient {
  runCommand = mock(async (_command: string) => "");
}

describe("pane tab group sync", () => {
  test("pruneShadowedSinglePaneGroups removes single-tab groups shadowed by another group member", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-live",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-live",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
      [
        "slot-shadow",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-shadow",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
    ]);

    const changed = pruneShadowedSinglePaneGroups(groups);

    expect(changed).toBe(true);
    expect(groups.has("slot-live")).toBe(true);
    expect(groups.has("slot-shadow")).toBe(false);
  });

  test("syncPaneTabMarkers updates member and active marker options from previous to next groups", async () => {
    const client = new FakeGroupSyncClient();
    const previousGroups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
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
    const nextGroups = new Map<string, PaneTabGroup>([
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
      [
        "slot-2",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [
            { label: "top", paneId: "%3" },
            { label: "shell", paneId: "%4" },
          ],
          windowId: "@2",
        },
      ],
    ]);

    await syncPaneTabMarkers(client as never, previousGroups, nextGroups);

    expect(client.runCommand).toHaveBeenCalledWith("set-option -up -t %1 @hmx-pane-tab-active");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 @hmx-pane-tab-active 1");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %3 @hmx-pane-tab-member 1");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %4 @hmx-pane-tab-member 1");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %4 @hmx-pane-tab-active 1");
  });

  test("syncPaneTabMarkers reasserts inactive members when syncing from an empty previous state", async () => {
    const client = new FakeGroupSyncClient();
    const nextGroups = new Map<string, PaneTabGroup>([
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

    await syncPaneTabMarkers(client as never, new Map(), nextGroups);

    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %1 @hmx-pane-tab-member 1");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -up -t %1 @hmx-pane-tab-active");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 @hmx-pane-tab-member 1");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 @hmx-pane-tab-active 1");
  });
});
