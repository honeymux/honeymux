import { describe, expect, mock, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import {
  hydrateAutomaticRenameModes,
  normalizeHiddenTabWindows,
  resolveHostWindowRenameState,
  syncManagedWindowNamesForGroups,
} from "./window-policy.ts";

class FakeWindowPolicyClient {
  automaticRenameByWindow = new Map<string, boolean>();
  disableAutomaticRename = mock(async (_windowId: string) => {});
  exactResponses = new Map<string, string>();
  getAutomaticRename = mock(async (windowId: string) => this.automaticRenameByWindow.get(windowId) ?? true);
  renameWindow = mock(async (_windowId: string, _name: string) => {});
  runCommand = mock(async (command: string) => this.exactResponses.get(command) ?? "");

  respond(command: string, response: string): void {
    this.exactResponses.set(command, response);
  }
}

describe("pane tab window policy", () => {
  test("resolveHostWindowRenameState inherits managed state from another slot in the same window", async () => {
    const client = new FakeWindowPolicyClient();
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          explicitWindowName: "workspace",
          restoreAutomaticRename: true,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
      [
        "slot-2",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [{ label: "top", paneId: "%2" }],
          windowId: "@1",
        },
      ],
    ]);

    await expect(resolveHostWindowRenameState(client as never, groups, "@1", "slot-2")).resolves.toEqual({
      explicitWindowName: "workspace",
      restoreAutomaticRename: true,
    });
  });

  test("resolveHostWindowRenameState falls back to tmux window state", async () => {
    const client = new FakeWindowPolicyClient();
    client.automaticRenameByWindow.set("@1", false);
    client.respond("list-windows -F '#{window_id} #{window_name}'", " @1 shell workspace\n");

    await expect(resolveHostWindowRenameState(client as never, new Map(), "@1")).resolves.toEqual({
      explicitWindowName: "shell workspace",
      restoreAutomaticRename: false,
    });
  });

  test("syncManagedWindowNamesForGroups only syncs windows owned by exactly one managed group", async () => {
    const client = new FakeWindowPolicyClient();
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          restoreAutomaticRename: false,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
      [
        "slot-2",
        {
          activeIndex: 0,
          restoreAutomaticRename: false,
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [{ label: "top", paneId: "%2" }],
          windowId: "@2",
        },
      ],
      [
        "slot-3",
        {
          activeIndex: 0,
          explicitWindowName: "shared",
          slotHeight: 24,
          slotKey: "slot-3",
          slotWidth: 80,
          tabs: [{ label: "htop", paneId: "%3" }],
          windowId: "@2",
        },
      ],
    ]);

    await syncManagedWindowNamesForGroups(client as never, groups);

    expect(client.renameWindow).toHaveBeenCalledTimes(1);
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "bash");
    expect(client.disableAutomaticRename).toHaveBeenCalledTimes(1);
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@1");
  });

  test("hydrateAutomaticRenameModes only fills missing values for multi-tab groups", async () => {
    const client = new FakeWindowPolicyClient();
    client.automaticRenameByWindow.set("@1", false);
    client.automaticRenameByWindow.set("@2", true);
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "top", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
      [
        "slot-2",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [{ label: "htop", paneId: "%3" }],
          windowId: "@2",
        },
      ],
    ]);

    const hydrated = await hydrateAutomaticRenameModes(client as never, groups);

    expect(hydrated.get("slot-1")?.restoreAutomaticRename).toBe(false);
    expect(hydrated.get("slot-2")?.restoreAutomaticRename).toBeUndefined();
  });

  test("normalizeHiddenTabWindows hides windows backing inactive tabs", async () => {
    const client = new FakeWindowPolicyClient();
    client.respond("list-panes -a -F ' #{pane_id} #{window_id}'", " %1 @1\n %2 @9\n %3 @1\n");
    const groups = new Map<string, PaneTabGroup>([
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
      [
        "slot-2",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [{ label: "shell", paneId: "%3" }],
          windowId: "@1",
        },
      ],
    ]);

    await normalizeHiddenTabWindows(client as never, groups);

    expect(client.renameWindow).toHaveBeenCalledWith("@9", "_hmx_tab");
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@9");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -w -t @9 window-status-format ''");
  });
});
