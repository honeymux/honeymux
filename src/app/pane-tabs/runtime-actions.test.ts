import { describe, expect, mock, test } from "bun:test";

import type { ValidateGroupPlan } from "./reconcile.ts";
import type { PaneTabGroup } from "./types.ts";

import {
  applyGroupTabs,
  applyValidateGroupPlan,
  materializeWindowTabSwitch,
  promotePaneIntoSlot,
  refreshValidatedWindows,
} from "./runtime-actions.ts";

type PaneInfo = { active: boolean; height: number; id: string; width: number };

class FakeRuntimeActionsClient {
  exactResponses = new Map<string, string>();
  listPanesByWindow = new Map<string, PaneInfo[]>();
  listPanesInWindow = mock(async (windowId: string) => this.listPanesByWindow.get(windowId) ?? []);
  renameWindow = mock(async (_windowId: string, _name: string) => {});
  resizePane = mock(async (_paneId: string, _width: number, _height: number) => {});
  runCommand = mock(async (command: string) => this.exactResponses.get(command) ?? "");
  runCommandChain = mock(async (_commands: string[]) => {});
  runWindowSwapChain = mock(async (_commands: string[]) => {});
  selectWindow = mock(async (_windowId: string) => {});
  setPaneBorderFormat = mock(async (_paneId: string, _format: string) => {});
  setPaneBorderStatus = mock(async (_paneId: string, _status: "off" | "top") => {});
  swapPane = mock(async (_targetPaneId: string, _sourcePaneId: string) => {});
  swapWindow = mock(async (_sourceWindowId: string, _targetWindowId: string) => {});

  respond(command: string, response: string): void {
    this.exactResponses.set(command, response);
  }
}

describe("pane tab runtime actions", () => {
  test("applyGroupTabs preserves window ownership when reducing to a single tab", async () => {
    const client = new FakeRuntimeActionsClient();
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
    const group = groups.get("slot-1")!;

    await applyGroupTabs({
      activeIndex: 0,
      borderLinesRef: { current: "single" },
      client: client as never,
      group,
      groups,
      slotKey: "slot-1",
      tabs: [{ label: "logs", paneId: "%2" }],
      windowId: "@9",
    });

    expect(groups.get("slot-1")).toMatchObject({
      activeIndex: 0,
      tabs: [{ label: "logs", paneId: "%2" }],
      windowId: "@9",
    });
    expect(client.runCommand).toHaveBeenCalledWith("set-hook -up -t %2 pane-died");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %2 remain-on-exit off");
    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%2", expect.stringContaining("┤ logs ├"));
  });

  test("applyValidateGroupPlan prunes dead tabs into an updated multi-tab group", async () => {
    const client = new FakeRuntimeActionsClient();
    const runtimeGroup: PaneTabGroup = {
      activeIndex: 2,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "dead", paneId: "%2" },
        { label: "logs", paneId: "%3" },
      ],
      windowId: "@1",
    };
    const plan: ValidateGroupPlan = {
      activeIndex: 1,
      changed: true,
      kind: "apply_tabs",
      runtimeGroup,
      slotKey: "slot-1",
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%3" },
      ],
      tabsToKillBeforeApply: [{ label: "dead", paneId: "%2" }],
      windowId: "@1",
    };
    const groups = new Map<string, PaneTabGroup>([["slot-1", runtimeGroup]]);
    const killed: PaneTabGroup["tabs"][] = [];

    const changed = await applyValidateGroupPlan({
      borderLinesRef: { current: "single" },
      client: client as never,
      groups,
      killDeadPanes: async (tabs) => {
        killed.push(tabs);
      },
      log: () => {},
      plan,
    });

    expect(changed).toBe(true);
    expect(killed).toHaveLength(1);
    expect(killed[0]?.map((tab) => tab.paneId)).toEqual(["%2"]);
    expect(groups.get("slot-1")?.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%3"]);
    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%3", expect.stringContaining("┤ logs ├"));
    expect(client.runCommand).toHaveBeenCalledWith("set-option -p -t %3 remain-on-exit on");
  });

  test("promotePaneIntoSlot uses swap-pane when the visible slot is still live", async () => {
    const client = new FakeRuntimeActionsClient();

    const result = await promotePaneIntoSlot({
      borderLinesRef: { current: "single" },
      client: client as never,
      currentVisiblePaneId: "%1",
      currentVisiblePaneIsLive: true,
      incomingPaneId: "%2",
      joinTargetPaneId: "%9",
      log: () => {},
      slotHeight: 24,
      slotWidth: 80,
      tabActiveIndex: 1,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      targetWindowId: "@1",
    });

    expect(result).toEqual({ promotedIntoVisibleSlot: true, windowId: "@1" });
    expect(client.resizePane).toHaveBeenCalledWith("%2", 80, 24);
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.runCommand).not.toHaveBeenCalledWith(expect.stringContaining("join-pane"));
    expect(client.runCommand).not.toHaveBeenCalledWith(expect.stringContaining("break-pane"));
  });

  test("materializeWindowTabSwitch hands a single-pane slot off to the target window", async () => {
    const client = new FakeRuntimeActionsClient();

    await materializeWindowTabSwitch({
      borderLinesRef: { current: "single" },
      client: client as never,
      currentPaneId: "%1",
      currentWindowId: "@1",
      newTargetWindowName: "logs",
      slotHeight: 24,
      slotWidth: 80,
      tabActiveIndex: 1,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      targetPaneId: "%2",
      targetWindowId: "@2",
    });

    expect(client.resizePane).toHaveBeenCalledWith("%2", 80, 24);
    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%2", expect.stringContaining("┤ logs ├"));
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%2", "top");
    expect(client.runWindowSwapChain).toHaveBeenCalledWith([
      "set-option -wu -t @2 window-status-format",
      "rename-window -t @1 _hmx_tab",
      "set-option -w -t @1 window-status-format ''",
      "rename-window -t @2 'logs'",
      "set-option -w -t @2 automatic-rename off",
      "swap-window -s @2 -t @1",
      "select-window -t @2",
    ]);
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%1", "off");
  });

  test("materializeWindowTabSwitch omits the target rename when no new name is supplied", async () => {
    const client = new FakeRuntimeActionsClient();

    await materializeWindowTabSwitch({
      borderLinesRef: { current: "single" },
      client: client as never,
      currentPaneId: "%1",
      currentWindowId: "@1",
      slotHeight: 24,
      slotWidth: 80,
      tabActiveIndex: 1,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      targetPaneId: "%2",
      targetWindowId: "@2",
    });

    expect(client.runWindowSwapChain).toHaveBeenCalledWith([
      "set-option -wu -t @2 window-status-format",
      "rename-window -t @1 _hmx_tab",
      "set-option -w -t @1 window-status-format ''",
      "swap-window -s @2 -t @1",
      "select-window -t @2",
    ]);
  });

  test("promotePaneIntoSlot falls back to breaking out the survivor when no visible pane remains", async () => {
    const client = new FakeRuntimeActionsClient();
    client.respond("break-pane -P -F '#{window_id}' -s %2", "@7\n");

    const result = await promotePaneIntoSlot({
      borderLinesRef: { current: "single" },
      client: client as never,
      currentVisiblePaneId: "%1",
      currentVisiblePaneIsLive: false,
      incomingPaneId: "%2",
      joinTargetPaneId: null,
      log: () => {},
      slotHeight: 24,
      slotWidth: 80,
      tabActiveIndex: 1,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      targetWindowId: "@1",
    });

    expect(result).toEqual({ promotedIntoVisibleSlot: false, windowId: "@7" });
    expect(client.runCommand).toHaveBeenCalledWith("break-pane -P -F '#{window_id}' -s %2");
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%2", "top");
    expect(client.swapPane).not.toHaveBeenCalled();
  });

  test("refreshValidatedWindows preserves remote panes while clearing ordinary hidden panes", async () => {
    const client = new FakeRuntimeActionsClient();
    client.listPanesByWindow.set("@1", [
      { active: true, height: 30, id: "%1", width: 100 },
      { active: false, height: 24, id: "%2", width: 80 },
      { active: false, height: 24, id: "%3", width: 80 },
    ]);
    client.respond("list-panes -t '@1' -F ' #{pane_id}\t#{@hmx-remote-host}'", " %1\t\n %2\tremote-box\n %3\t\n");

    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
    ]);

    const changed = await refreshValidatedWindows({
      borderLinesRef: { current: "single" },
      client: client as never,
      groups,
    });

    expect(changed).toBe(true);
    expect(groups.get("slot-1")).toMatchObject({ slotHeight: 30, slotWidth: 100 });
    expect(client.runCommand).not.toHaveBeenCalledWith("set-option -up -t %2 pane-border-format");
    expect(client.runCommand).toHaveBeenCalledWith("set-option -up -t %3 pane-border-format");
    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%1", expect.stringContaining("┤ bash ├"));
  });
});
