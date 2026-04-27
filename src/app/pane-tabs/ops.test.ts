import { describe, expect, mock, test } from "bun:test";

import type { PaneTabPersistState } from "../services/session-persistence.ts";
import type { PaneTabGroup } from "./types.ts";

import { createPaneTabOps } from "./ops.ts";

type PaneInfo = { active: boolean; height: number; id: string; width: number };

class FakePaneTabClient {
  automaticRenameByWindow = new Map<string, boolean>();
  disableAutomaticRename = mock(async (windowId: string) => {
    this.automaticRenameByWindow.set(windowId, false);
  });
  enableAutomaticRename = mock(async (windowId: string) => {
    this.automaticRenameByWindow.set(windowId, true);
  });
  exactResponseQueues = new Map<string, string[]>();
  exactResponses = new Map<string, string>();
  forceSwapPaneError: Error | null = null;
  getAutomaticRename = mock(async (windowId: string) => this.automaticRenameByWindow.get(windowId) ?? true);
  paneBorderLines = "single";
  getPaneBorderLines = mock(async () => this.paneBorderLines);
  paneCommandQueues = new Map<string, string[]>();
  paneCommands = new Map<string, string>();
  getPaneCommands = mock(async (paneIds: string[]) => {
    const result = new Map<string, string>();
    for (const paneId of paneIds) {
      const queued = this.paneCommandQueues.get(paneId);
      if (queued && queued.length > 0) {
        const next = queued.shift()!;
        if (queued.length === 0) this.paneCommandQueues.delete(paneId);
        result.set(paneId, next);
        continue;
      }
      result.set(paneId, this.paneCommands.get(paneId) ?? "shell");
    }
    return result;
  });
  killedPanes = new Set<string>();

  listPanesByWindow = new Map<string, PaneInfo[]>();

  listPanesInWindow = mock(async (windowId: string) => this.listPanesByWindow.get(windowId) ?? []);

  matchResponses: Array<{ match: (command: string) => boolean; response: string }> = [];

  newDetachedWindowResult = { paneId: "%9", windowId: "@9" };

  newDetachedWindow = mock(async (_windowName?: string) => this.newDetachedWindowResult);
  operations: string[] = [];

  refreshPtyClient = mock(async () => {});
  renameWindow = mock(async (_windowId: string, _name: string) => {});
  resizePane = mock(async (_paneId: string, _width: number, _height: number) => {});
  sentCommands: string[] = [];
  sendCommand = mock(async (command: string) => {
    this.operations.push(command);
    this.sentCommands.push(command);
    const killPaneMatch = /^kill-pane -t (\S+)$/.exec(command);
    if (killPaneMatch) {
      this.killedPanes.add(killPaneMatch[1]!);
    }
    const queued = this.exactResponseQueues.get(command);
    if (queued && queued.length > 0) {
      const next = queued.shift()!;
      if (queued.length === 0) this.exactResponseQueues.delete(command);
      return next;
    }
    const exact = this.exactResponses.get(command);
    if (exact != null) return exact;
    for (const matcher of this.matchResponses) {
      if (matcher.match(command)) return matcher.response;
    }
    return "";
  });
  runCommand = mock(async (command: string) => this.sendCommand(command));
  runCommandChain = mock(async (commands: string[]) => {
    for (const cmd of commands) await this.sendCommand(cmd);
  });
  runWindowSwapChain = mock(async (commands: string[]) => {
    for (const cmd of commands) await this.sendCommand(cmd);
  });
  selectWindow = mock(async (_windowId: string) => {});
  setPaneBorderFormat = mock(async (_paneId: string, _format: string) => {});
  setPaneBorderStatus = mock(async (_paneId: string, _value: "off" | "top") => {});
  swapPane = mock(async (sourcePaneId: string, targetPaneId: string) => {
    this.operations.push(`swap-pane ${sourcePaneId} ${targetPaneId}`);
    if (this.forceSwapPaneError) throw this.forceSwapPaneError;
    if (this.killedPanes.has(sourcePaneId)) {
      throw new Error(`can't find pane: ${sourcePaneId}`);
    }
  });
  swapWindow = mock(async (_sourceWindowId: string, _targetWindowId: string) => {});
  queuePaneCommands(paneId: string, commands: string[]): void {
    this.paneCommandQueues.set(paneId, [...commands]);
  }
  respond(command: string, response: string): void {
    this.exactResponses.set(command, response);
  }
  respondMatch(match: (command: string) => boolean, response: string): void {
    this.matchResponses.push({ match, response });
  }
  respondSequence(command: string, responses: string[]): void {
    this.exactResponseQueues.set(command, [...responses]);
  }
}

function cloneGroups(groups: Map<string, PaneTabGroup>): Map<string, PaneTabGroup> {
  return new Map([...groups.entries()].map(([slotKey, group]) => [slotKey, { ...group, tabs: [...group.tabs] }]));
}

function createHarness({
  activeSlotInfo = null as {
    height: number;
    paneId: string;
    slotKey: string;
    width: number;
  } | null,
  activeWindowId = "@1",
  currentSessionName = "alpha",
  groups = new Map<string, PaneTabGroup>(),
  loadPaneTabState = async () => null as PaneTabPersistState | null,
} = {}) {
  const client = new FakePaneTabClient();
  const clientRef = { current: client as any };
  const groupsRef = { current: cloneGroups(groups) };
  const activeWindowIdRef = { current: activeWindowId };
  const borderLinesRef = { current: "single" };
  const commits: Map<string, PaneTabGroup>[] = [];
  const emitLayoutChange = mock(() => {});

  const ops = createPaneTabOps({
    activeWindowIdRef,
    borderLinesRef,
    clientRef,
    commitGroups: (nextGroups) => {
      groupsRef.current = cloneGroups(nextGroups);
      commits.push(cloneGroups(nextGroups));
    },
    currentSessionName,
    emitLayoutChange,
    getActiveSlotKey: async () => activeSlotInfo,
    groupsRef,
    loadPaneTabState,
    log: () => {},
  });

  return {
    activeWindowIdRef,
    borderLinesRef,
    client,
    commits,
    emitLayoutChange,
    groupsRef,
    ops,
  };
}

describe("pane tab ops", () => {
  test("doNewTab creates a new tab group for the active pane", async () => {
    const { client, groupsRef, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%1", slotKey: "%1", width: 80 },
    });
    client.paneCommands.set("%1", "bash");
    client.paneCommands.set("%9", "htop");
    client.listPanesByWindow.set("@1", [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%3", width: 40 },
    ]);

    await ops.doNewTab();

    const group = groupsRef.current.get("%1");
    expect(group).toBeDefined();
    expect(group?.activeIndex).toBe(1);
    expect(group?.tabs.map((tab) => `${tab.paneId}:${tab.label}`)).toEqual(["%1:bash", "%9:htop"]);
    expect(group?.restoreAutomaticRename).toBe(true);
    expect(client.newDetachedWindow).toHaveBeenCalledWith("_hmx_tab");
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%9");
    expect(client.sentCommands).toContain("set-option -w -t %9 pane-border-status off");
    expect(client.sentCommands).toContain("set-option -p -t %9 remain-on-exit on");
    expect(client.sentCommands).toContain("set-option -p -t %1 remain-on-exit on");
    expect(client.sentCommands.some((command) => command.includes("pane-died[0]"))).toBe(false);
  });

  test("doNewTab disables automatic rename on the visible host window", async () => {
    const { client, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%1", slotKey: "%1", width: 80 },
      activeWindowId: "@1",
    });
    client.paneCommands.set("%1", "bash");
    client.paneCommands.set("%9", "htop");

    await ops.doNewTab();

    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@1");
    expect(client.automaticRenameByWindow.get("@1")).toBe(false);
  });

  test("doNewTab inherits managed window rename state from another tabbed slot in the same window", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 0,
          restoreAutomaticRename: true,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [
            { label: "codex", paneId: "%1" },
            { label: "bash", paneId: "%9" },
          ],
          windowId: "@1",
        },
      ],
      [
        "%2",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%2",
          slotWidth: 80,
          tabs: [{ label: "top", paneId: "%2" }],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%2", slotKey: "%2", width: 80 },
      activeWindowId: "@1",
      groups,
    });
    client.automaticRenameByWindow.set("@1", false);
    client.paneCommands.set("%2", "top");
    client.paneCommands.set("%9", "shell");

    await ops.doNewTab();

    const group = groupsRef.current.get("%2");
    expect(group?.restoreAutomaticRename).toBe(true);
  });

  test("doNewTab refreshes an existing group's windowId from the active window", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@9",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%2", slotKey: "%1", width: 80 },
      activeWindowId: "@1",
      groups,
    });
    client.paneCommands.set("%2", "logs");
    client.paneCommands.set("%9", "shell");

    await ops.doNewTab();

    const group = groupsRef.current.get("%1");
    expect(group?.windowId).toBe("@1");
    expect(group?.activeIndex).toBe(2);
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%2", "%9"]);
  });

  test("doNewTab re-reads labels after the swap so the hidden source tab does not stay stale", async () => {
    const { client, groupsRef, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%1", slotKey: "%1", width: 80 },
    });
    client.queuePaneCommands("%1", ["bash", "vim"]);
    client.queuePaneCommands("%9", ["shell", "shell"]);
    client.listPanesByWindow.set("@1", [{ active: true, height: 24, id: "%1", width: 80 }]);

    await ops.doNewTab();

    const group = groupsRef.current.get("%1");
    expect(group?.tabs.map((tab) => `${tab.paneId}:${tab.label}`)).toEqual(["%1:vim", "%9:shell"]);
    expect(client.getPaneCommands).toHaveBeenCalledTimes(2);
  });

  test("doSwitchTab swaps panes for multi-pane layouts and updates the active index", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.respond("list-panes -a -F ' #{pane_id} #{window_id}'", " %1 @1\n %2 @2");
    client.listPanesByWindow.set("@1", [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%8", width: 40 },
    ]);

    await ops.doSwitchTab("slot-1", 1);

    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.refreshPtyClient).toHaveBeenCalledTimes(1);
    expect(groupsRef.current.get("slot-1")?.activeIndex).toBe(1);
    expect(groupsRef.current.get("slot-1")?.windowId).toBe("@1");
  });

  test("doSwitchTab hands a single-pane slot off to the target window", async () => {
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
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.respond("list-panes -a -F ' #{pane_id} #{window_id}'", " %1 @1\n %2 @2");
    client.listPanesByWindow.set("@1", [{ active: true, height: 24, id: "%1", width: 80 }]);

    await ops.doSwitchTab("slot-1", 1);

    expect(client.runWindowSwapChain).toHaveBeenCalled();
    const chainArg = (client.runWindowSwapChain.mock.calls[0]?.[0] ?? []) as string[];
    expect(chainArg).toContain("swap-window -s @2 -t @1");
    expect(chainArg).toContain("select-window -t @2");
    expect(chainArg).toContain("rename-window -t @1 _hmx_tab");
    expect(chainArg.some((c) => c.startsWith("rename-window -t @2 "))).toBe(true);
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%2", "top");
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%1", "off");
    expect(client.refreshPtyClient).toHaveBeenCalledTimes(1);
    expect(groupsRef.current.get("slot-1")?.activeIndex).toBe(1);
    expect(groupsRef.current.get("slot-1")?.windowId).toBe("@2");
  });

  test("doCloseTab closes the active tab and dissolves a two-tab group", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%1", slotKey: "slot-1", width: 80 },
      groups,
    });

    const result = await ops.doCloseTab();

    expect(result).toBe(true);
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.sentCommands).toContain("kill-pane -t %1");
    // Group is kept alive as a single-tab group (not dissolved).
    expect(groupsRef.current.size).toBe(1);
    const remaining = groupsRef.current.get("slot-1");
    expect(remaining?.tabs.length).toBe(1);
    expect(remaining?.tabs[0]?.paneId).toBe("%2");
  });

  test("doCloseTab keeps automatic naming disabled for custom-named windows", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          explicitWindowName: "workspace",
          restoreAutomaticRename: false,
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
    const { client, ops } = createHarness({
      activeSlotInfo: { height: 24, paneId: "%1", slotKey: "slot-1", width: 80 },
      groups,
    });

    const result = await ops.doCloseTab();

    expect(result).toBe(true);
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@1");
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "workspace");
  });

  test("doDissolveAll leaves tmux automatic rename untouched for metadata-only single-tab groups", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });

    await ops.doDissolveAll();

    expect(groupsRef.current.size).toBe(0);
    expect(client.sentCommands).not.toContain("set-option -w -t %1 automatic-rename off");
    expect(client.sentCommands).not.toContain("set-option -w -t %1 automatic-rename on");
  });

  test("doDissolveAll restores tmux automatic rename for managed groups that started auto-renaming", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });

    await ops.doDissolveAll();

    expect(groupsRef.current.size).toBe(0);
    expect(client.sentCommands).toContain("set-option -w -t %1 automatic-rename on");
  });

  test("doRefreshLabels syncs a managed host window name from the active pane-tab label", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.paneCommands.set("%1", "codex");

    await ops.doRefreshLabels();

    expect(groupsRef.current.get("slot-1")?.tabs[0]?.label).toBe("codex");
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "codex");
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@1");
  });

  test("doRefreshLabels does not try to auto-sync a shared tmux window name for multiple managed slots", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 0,
          restoreAutomaticRename: false,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
      [
        "%2",
        {
          activeIndex: 0,
          restoreAutomaticRename: false,
          slotHeight: 24,
          slotKey: "%2",
          slotWidth: 80,
          tabs: [{ label: "top", paneId: "%2" }],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.paneCommands.set("%1", "codex");
    client.paneCommands.set("%2", "htop");

    await ops.doRefreshLabels();

    expect(groupsRef.current.get("%1")?.tabs[0]?.label).toBe("codex");
    expect(groupsRef.current.get("%2")?.tabs[0]?.label).toBe("htop");
    expect(client.renameWindow).not.toHaveBeenCalled();
  });

  test("doRenamePaneTab updates the managed host window when the active tab is renamed", async () => {
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
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });

    await ops.doRenamePaneTab("slot-1", 0, "Claude");

    const group = groupsRef.current.get("slot-1");
    expect(group?.tabs[0]).toEqual({ label: "Claude", paneId: "%1", userLabel: "Claude" });
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "Claude");
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@1");
  });

  test("doRenameManagedWindow keeps an explicit window rename sticky until cleared", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.paneCommands.set("%1", "bash");

    await expect(ops.doRenameManagedWindow("@1", "workspace")).resolves.toBe(true);
    expect(groupsRef.current.get("slot-1")?.explicitWindowName).toBe("workspace");
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "workspace");

    await expect(ops.doRenameManagedWindow("@1", "")).resolves.toBe(true);
    expect(groupsRef.current.get("slot-1")?.explicitWindowName).toBeUndefined();
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "bash");
  });

  test("doRenameManagedWindow refreshes the visible tab strip when it refreshes the active label", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          restoreAutomaticRename: false,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "shell", paneId: "%1" },
            { label: "logs", paneId: "%2", userLabel: "logs" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.paneCommands.set("%1", "bash");

    await expect(ops.doRenameManagedWindow("@1", "workspace")).resolves.toBe(true);

    expect(groupsRef.current.get("slot-1")?.tabs[0]?.label).toBe("bash");
    expect(client.setPaneBorderFormat).toHaveBeenCalledWith("%1", expect.stringContaining("┤ bash ├"));
    expect(client.renameWindow).toHaveBeenCalledWith("@1", "workspace");
  });

  test("doMovePaneTab moves the active source tab into the target group without killing it", async () => {
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
          slotHeight: 30,
          slotKey: "slot-2",
          slotWidth: 90,
          tabs: [
            { label: "shell", paneId: "%3" },
            { label: "tail", paneId: "%4" },
          ],
          windowId: "@2",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });

    await ops.doMovePaneTab("slot-1", 0, "slot-2", 1);

    expect(groupsRef.current.get("slot-1")?.tabs.map((tab) => tab.paneId)).toEqual(["%2"]);
    expect(groupsRef.current.get("slot-2")?.tabs.map((tab) => tab.paneId)).toEqual(["%3", "%1", "%4"]);
    expect(groupsRef.current.get("slot-2")?.activeIndex).toBe(1);
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.swapPane).toHaveBeenCalledWith("%3", "%1");
    expect(client.sentCommands).not.toContain("kill-pane -t %1");
  });

  test("doMoveToUngroupedPane creates a new group without killing the moved pane", async () => {
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
    ]);
    const { client, groupsRef, ops } = createHarness({
      activeWindowId: "@9",
      groups,
    });
    client.listPanesByWindow.set("@9", [{ active: false, height: 40, id: "%7", width: 100 }]);
    client.paneCommands.set("%7", "htop");

    await ops.doMoveToUngroupedPane("slot-1", 0, "%7", 1);

    expect(groupsRef.current.get("slot-1")?.tabs.map((tab) => tab.paneId)).toEqual(["%2"]);
    expect(groupsRef.current.get("%7")?.tabs).toEqual([
      { label: "htop", paneId: "%7" },
      { label: "bash", paneId: "%1" },
    ]);
    expect(groupsRef.current.get("%7")?.activeIndex).toBe(1);
    expect(groupsRef.current.get("%7")?.windowId).toBe("@9");
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.swapPane).toHaveBeenCalledWith("%7", "%1");
    expect(client.sentCommands).not.toContain("kill-pane -t %1");
  });

  test("doMoveToUngroupedPane reuses an existing single-tab target group and hides the displaced window", async () => {
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
        "slot-legacy",
        {
          activeIndex: 0,
          explicitWindowName: "heh",
          restoreAutomaticRename: true,
          slotHeight: 40,
          slotKey: "slot-legacy",
          slotWidth: 100,
          tabs: [{ label: "Claude", paneId: "%7", userLabel: "Claude" }],
          windowId: "@9",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({
      activeWindowId: "@9",
      groups,
    });
    client.listPanesByWindow.set("@9", [{ active: false, height: 40, id: "%7", width: 100 }]);
    client.respond("list-panes -a -F ' #{pane_id} #{window_id}'", " %1 @9\n %2 @1\n %7 @20");

    await ops.doMoveToUngroupedPane("slot-1", 0, "%7", 1);

    expect(groupsRef.current.get("slot-1")?.tabs.map((tab) => tab.paneId)).toEqual(["%2"]);
    expect(groupsRef.current.has("%7")).toBe(false);
    expect(groupsRef.current.get("slot-legacy")).toEqual({
      activeIndex: 1,
      explicitWindowName: "heh",
      restoreAutomaticRename: true,
      slotHeight: 40,
      slotKey: "slot-legacy",
      slotWidth: 100,
      tabs: [
        { label: "Claude", paneId: "%7", userLabel: "Claude" },
        { label: "bash", paneId: "%1" },
      ],
      windowId: "@9",
    });
    expect(client.renameWindow).toHaveBeenCalledWith("@20", "_hmx_tab");
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@20");
    expect(client.sentCommands).toContain("set-option -w -t @20 window-status-format ''");
  });

  test("doMoveToUngroupedPane inserts at the requested index when dropping before the existing tab", async () => {
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
        "slot-target",
        {
          activeIndex: 0,
          slotHeight: 40,
          slotKey: "slot-target",
          slotWidth: 100,
          tabs: [{ label: "Claude", paneId: "%7", userLabel: "Claude" }],
          windowId: "@9",
        },
      ],
    ]);
    const { groupsRef, ops } = createHarness({
      activeWindowId: "@9",
      groups,
    });

    await ops.doMoveToUngroupedPane("slot-1", 0, "%7", 0);

    expect(groupsRef.current.get("slot-target")?.tabs).toEqual([
      { label: "bash", paneId: "%1" },
      { label: "Claude", paneId: "%7", userLabel: "Claude" },
    ]);
    expect(groupsRef.current.get("slot-target")?.activeIndex).toBe(0);
  });

  test("doRestore filters dead panes, reinstalls hooks, and restores border lines", async () => {
    const savedState: PaneTabPersistState = {
      borderLines: "double",
      groups: [
        {
          activePaneId: "%2",
          slotKey: "slot-1",
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
        },
        {
          activePaneId: "%9",
          slotKey: "slot-2",
          tabs: [{ label: "orphan", paneId: "%9" }],
        },
      ],
    };
    const { borderLinesRef, client, groupsRef, ops } = createHarness({
      loadPaneTabState: async () => savedState,
    });
    client.respond(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      " alpha\t%1\t0\t@5\t80\t24\t0\t\n alpha\t%2\t0\t@6\t80\t24\t1\t\n alpha\t%9\t0\t@9\t70\t20\t1\t",
    );
    client.listPanesByWindow.set("@6", [{ active: true, height: 24, id: "%2", width: 80 }]);
    client.listPanesByWindow.set("@9", [{ active: true, height: 20, id: "%9", width: 70 }]);

    await ops.doRestore();

    expect(borderLinesRef.current).toBe("double");
    const group = groupsRef.current.get("slot-1");
    expect(group?.activeIndex).toBe(1);
    expect(group?.windowId).toBe("@6");
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%2"]);
    // Single-tab group is kept alive with per-pane format.
    expect(groupsRef.current.has("slot-2")).toBe(true);
    const singleGroup = groupsRef.current.get("slot-2");
    expect(singleGroup?.tabs.length).toBe(1);
    expect(singleGroup?.tabs[0]?.paneId).toBe("%9");
    expect(singleGroup?.windowId).toBe("@9");
    expect(client.sentCommands).toContain("set-option -p -t %9 remain-on-exit off");
    expect(client.sentCommands.some((command) => command.includes("pane-died[0]"))).toBe(false);
  });

  test("doRestore prefers the tab in the active window and immediately validates a dead visible pane", async () => {
    const savedState: PaneTabPersistState = {
      borderLines: "single",
      groups: [
        {
          activePaneId: "%0",
          slotKey: "slot-1",
          tabs: [
            { label: "bash", paneId: "%0" },
            { label: "logs", paneId: "%1" },
            { label: "shell", paneId: "%2" },
          ],
        },
      ],
    };
    const { client, emitLayoutChange, groupsRef, ops } = createHarness({
      activeWindowId: "@0",
      loadPaneTabState: async () => savedState,
    });
    client.respondSequence(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      [
        " alpha\t%0\t0\t@1\t80\t24\t0\t\n alpha\t%1\t0\t@2\t80\t24\t0\t\n alpha\t%2\t1\t@0\t80\t24\t1\t",
        " alpha\t%0\t0\t@1\t80\t24\t0\t\n alpha\t%1\t0\t@2\t80\t24\t0\t\n alpha\t%2\t1\t@0\t80\t24\t1\t",
        " alpha\t%0\t0\t@1\t80\t24\t0\t\n alpha\t%1\t0\t@0\t80\t24\t1\t",
      ],
    );
    client.listPanesByWindow.set("@0", []);

    await ops.doRestore();

    const group = groupsRef.current.get("slot-1");
    expect(group?.windowId).toBe("@0");
    expect(group?.activeIndex).toBe(1);
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%0", "%1"]);
    expect(client.swapPane).toHaveBeenCalledWith("%2", "%1");
    expect(client.sentCommands).toContain("kill-pane -t %2");
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doValidate reconciles a dead active tab and emits a layout refresh", async () => {
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
            { label: "shell", paneId: "%3" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, commits, emitLayoutChange, groupsRef, ops } = createHarness({ groups });
    client.respond(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      " alpha\t%1\t1\t@1\t82\t26\t0\t\n alpha\t%2\t0\t@1\t82\t26\t1\t\n alpha\t%3\t0\t@2\t80\t24\t0\t",
    );
    client.listPanesByWindow.set("@1", [{ active: true, height: 26, id: "%2", width: 82 }]);

    await ops.doValidate();

    const group = groupsRef.current.get("slot-1");
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%2", "%3"]);
    expect(group?.activeIndex).toBe(0);
    expect(group?.slotWidth).toBe(82);
    expect(group?.slotHeight).toBe(26);
    expect(client.sentCommands).toContain("kill-pane -t %1");
    expect(commits).toHaveLength(1);
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doValidate prunes a shadowed single-tab group that duplicates another group member", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-live",
        {
          activeIndex: 0,
          explicitWindowName: "heh",
          restoreAutomaticRename: true,
          slotHeight: 24,
          slotKey: "slot-live",
          slotWidth: 80,
          tabs: [
            { label: "claude", paneId: "%2" },
            { label: "bash", paneId: "%6" },
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
          tabs: [{ label: "claude", paneId: "%2" }],
          windowId: "@1",
        },
      ],
    ]);
    const { client, groupsRef, ops } = createHarness({ groups });
    client.respond(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      " alpha\t%2\t0\t@1\t80\t24\t1\t\n alpha\t%6\t0\t@20\t80\t24\t0\t",
    );
    client.listPanesByWindow.set("@1", [{ active: true, height: 24, id: "%2", width: 80 }]);
    client.listPanesByWindow.set("@20", [{ active: true, height: 24, id: "%6", width: 80 }]);
    client.respond("list-panes -a -F ' #{pane_id} #{window_id}'", " %2 @1\n %6 @20");

    await ops.doValidate();

    expect(groupsRef.current.has("slot-shadow")).toBe(false);
    expect(groupsRef.current.get("slot-live")?.tabs.map((tab) => tab.paneId)).toEqual(["%2", "%6"]);
    expect(client.renameWindow).toHaveBeenCalledWith("@20", "_hmx_tab");
    expect(client.disableAutomaticRename).toHaveBeenCalledWith("@20");
  });

  test("doValidate prefers the dead active pane's actual window over stale group.windowId", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 3,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%0" },
            { label: "logs", paneId: "%1" },
            { label: "shell", paneId: "%2" },
            { label: "tail", paneId: "%3" },
          ],
          windowId: "@13",
        },
      ],
    ]);
    const { client, emitLayoutChange, groupsRef, ops } = createHarness({ groups });
    client.respond(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      " alpha\t%0\t0\t@1\t80\t24\t0\t\n alpha\t%1\t0\t@13\t80\t24\t0\t\n alpha\t%2\t0\t@0\t80\t24\t1\t\n alpha\t%3\t1\t@0\t80\t24\t0\t",
    );
    client.listPanesByWindow.set("@0", [{ active: true, height: 24, id: "%2", width: 80 }]);
    client.listPanesByWindow.set("@13", [{ active: true, height: 24, id: "%1", width: 80 }]);

    await ops.doValidate();

    const group = groupsRef.current.get("slot-1");
    expect(group?.windowId).toBe("@0");
    expect(group?.activeIndex).toBe(2);
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%0", "%1", "%2"]);
    expect(client.sentCommands).toContain("kill-pane -t %3");
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doValidate swaps a dead active tab out before killing it", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 2,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
            { label: "shell", paneId: "%3" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, emitLayoutChange, groupsRef, ops } = createHarness({ groups });
    client.respondSequence(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      [
        " alpha\t%1\t0\t@1\t80\t24\t0\t\n alpha\t%2\t0\t@2\t80\t24\t0\t\n alpha\t%3\t1\t@0\t80\t24\t1\t",
        " alpha\t%1\t0\t@1\t80\t24\t0\t\n alpha\t%2\t0\t@0\t80\t24\t1\t",
      ],
    );
    client.listPanesByWindow.set("@1", []);

    await ops.doValidate();

    const group = groupsRef.current.get("slot-1");
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%2"]);
    expect(group?.activeIndex).toBe(1);
    expect(group?.windowId).toBe("@0");
    expect(client.swapPane).toHaveBeenCalledWith("%3", "%2");
    expect(client.operations.indexOf("swap-pane %3 %2")).toBeGreaterThan(-1);
    expect(client.operations.indexOf("kill-pane -t %3")).toBeGreaterThan(client.operations.indexOf("swap-pane %3 %2"));
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doValidate recovers a dead visible tab in a multi-pane window even if activeIndex drifted to a hidden tab", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "claude", paneId: "%1" },
            { label: "bash", paneId: "%2" },
          ],
          windowId: "@0",
        },
      ],
    ]);
    const { client, emitLayoutChange, groupsRef, ops } = createHarness({ groups });
    client.respondSequence(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      [
        " alpha\t%1\t1\t@0\t80\t24\t1\t\n alpha\t%2\t0\t@9\t80\t24\t1\t\n alpha\t%7\t0\t@0\t80\t24\t0\t",
        " alpha\t%2\t0\t@0\t80\t24\t1\t\n alpha\t%7\t0\t@0\t80\t24\t0\t",
      ],
    );
    client.listPanesByWindow.set("@0", [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%7", width: 80 },
    ]);
    client.listPanesByWindow.set("@9", [{ active: true, height: 24, id: "%2", width: 80 }]);

    await ops.doValidate();

    const group = groupsRef.current.get("slot-1");
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%2"]);
    expect(group?.activeIndex).toBe(0);
    expect(group?.windowId).toBe("@0");
    expect(client.swapPane).toHaveBeenCalledWith("%1", "%2");
    expect(client.sentCommands).toContain("kill-pane -t %1");
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doValidate falls back to breaking out a survivor when swap-pane loses the race", async () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 2,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
            { label: "shell", paneId: "%3" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const { client, emitLayoutChange, groupsRef, ops } = createHarness({ groups });
    client.respondSequence(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      [
        " alpha\t%1\t0\t@1\t80\t24\t0\t\n alpha\t%2\t0\t@2\t80\t24\t0\t\n alpha\t%3\t1\t@0\t80\t24\t1\t",
        " alpha\t%1\t0\t@1\t80\t24\t0\t\n alpha\t%2\t0\t@9\t80\t24\t1\t",
      ],
    );
    client.respond("break-pane -P -F '#{window_id}' -s %2", "@9");
    client.listPanesByWindow.set("@1", []);
    client.forceSwapPaneError = new Error("can't find pane: %3");

    await ops.doValidate();

    const group = groupsRef.current.get("slot-1");
    expect(group?.tabs.map((tab) => tab.paneId)).toEqual(["%1", "%2"]);
    expect(group?.activeIndex).toBe(1);
    expect(group?.windowId).toBe("@9");
    expect(client.sentCommands).toContain("break-pane -P -F '#{window_id}' -s %2");
    expect(client.sentCommands).toContain("kill-pane -t %3");
    expect(client.setPaneBorderStatus).toHaveBeenCalledWith("%2", "top");
    expect(emitLayoutChange).toHaveBeenCalledTimes(1);
  });

  test("doBootstrapUngroupedPanes only bootstraps panes from the current session", async () => {
    const { client, groupsRef, ops } = createHarness({ currentSessionName: "alpha" });
    client.respond(
      "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      " alpha\t%1\t0\t@1\t80\t24\t1\t\n beta\t%2\t0\t@2\t70\t20\t1\t",
    );
    client.respond("list-windows -F '#{window_id} #{window_name}'", "@1 main\n@2 other");
    client.paneCommands.set("%1", "bash");
    client.paneCommands.set("%2", "top");

    await ops.doBootstrapUngroupedPanes();

    expect([...groupsRef.current.keys()]).toEqual(["%1"]);
    expect(groupsRef.current.get("%1")).toEqual({
      activeIndex: 0,
      slotHeight: 24,
      slotKey: "%1",
      slotWidth: 80,
      tabs: [{ label: "bash", paneId: "%1" }],
      windowId: "@1",
    });
  });
});
