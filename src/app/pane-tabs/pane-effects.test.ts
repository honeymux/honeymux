import { describe, expect, mock, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import {
  clearSiblingPaneFormats,
  collectVisibleTabbedPaneIds,
  installExitHook,
  setPaneFormatForTabs,
} from "./pane-effects.ts";

type PaneInfo = { active: boolean; height: number; id: string; width: number };

class FakePaneEffectsClient {
  exactResponses = new Map<string, string>();
  listPanesByWindow = new Map<string, PaneInfo[]>();
  listPanesInWindow = mock(async (windowId: string) => this.listPanesByWindow.get(windowId) ?? []);
  runCommand = mock(async (command: string) => this.exactResponses.get(command) ?? "");
  setPaneBorderFormat = mock(async (_paneId: string, _format: string) => {});

  respond(command: string, response: string): void {
    this.exactResponses.set(command, response);
  }
}

describe("pane tab pane effects", () => {
  test("collectVisibleTabbedPaneIds returns the active pane from each group", () => {
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

    expect([...collectVisibleTabbedPaneIds(groups)]).toEqual(["%2", "%3"]);
  });

  test("setPaneFormatForTabs renders a border format using the provided border style", async () => {
    const client = new FakePaneEffectsClient();

    await setPaneFormatForTabs(
      client as never,
      "%2",
      [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      1,
      80,
      "double",
    );

    expect(client.setPaneBorderFormat).toHaveBeenCalledTimes(1);
    expect(client.setPaneBorderFormat.mock.calls[0]?.[0]).toBe("%2");
    expect(client.setPaneBorderFormat.mock.calls[0]?.[1]).toContain("╡ logs ╞");
  });

  test("installExitHook formats the active pane, enables remain-on-exit, and clears pane hooks", async () => {
    const client = new FakePaneEffectsClient();
    const group: PaneTabGroup = {
      activeIndex: 1,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      windowId: "@1",
    };

    await installExitHook(client as never, group, "single");

    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%2", expect.stringContaining("┤ logs ├"));
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 remain-on-exit on");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 remain-on-exit-format ' '");
    expect(client.runCommand).toHaveBeenCalledWith("set-hook -up -t %1 pane-died");
    expect(client.runCommand).toHaveBeenCalledWith("set-hook -up -t %2 pane-died");
  });

  test("clearSiblingPaneFormats only clears panes outside the visible set", async () => {
    const client = new FakePaneEffectsClient();
    client.listPanesByWindow.set("@1", [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%2", width: 80 },
      { active: false, height: 24, id: "%3", width: 80 },
    ]);

    await clearSiblingPaneFormats(client as never, "@1", new Set(["%1", "%3"]));

    expect(client.runCommand).toHaveBeenCalledWith("set-option -up -t %2 pane-border-format");
    expect(client.runCommand).not.toHaveBeenCalledWith("set-option -up -t %1 pane-border-format");
    expect(client.runCommand).not.toHaveBeenCalledWith("set-option -up -t %3 pane-border-format");
  });

  test("clearSiblingPaneFormats preserves remote panes that own their own border format", async () => {
    const client = new FakePaneEffectsClient();
    client.listPanesByWindow.set("@1", [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%2", width: 80 },
      { active: false, height: 24, id: "%3", width: 80 },
    ]);
    client.respond("list-panes -t '@1' -F ' #{pane_id}\t#{@hmx-remote-host}'", " %1\t\n %2\tremote-box\n %3\t\n");

    await clearSiblingPaneFormats(client as never, "@1", new Set(["%1"]));

    expect(client.runCommand).not.toHaveBeenCalledWith("set-option -up -t %2 pane-border-format");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -up -t %3 pane-border-format");
  });
});
