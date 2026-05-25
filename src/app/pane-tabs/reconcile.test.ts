import { describe, expect, test } from "bun:test";

import type { PaneSnapshot, WindowPaneSnapshot } from "./reconcile.ts";
import type { PaneTabGroup } from "./types.ts";

import { buildPaneStateSummary, planValidateGroup } from "./reconcile.ts";

function createPaneSnapshot(paneId: string, windowId: string, options: Partial<PaneSnapshot> = {}): PaneSnapshot {
  return {
    active: false,
    dead: false,
    height: 24,
    paneId,
    sessionName: "alpha",
    width: 80,
    windowId,
    ...options,
  };
}

describe("pane tab reconcile", () => {
  test("planValidateGroup emits an apply-tabs drift repair for a healthy group", () => {
    const group: PaneTabGroup = {
      activeIndex: 0,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      windowId: "@9",
    };
    const paneStateById = new Map<string, PaneSnapshot>([
      ["%1", createPaneSnapshot("%1", "@1")],
      ["%2", createPaneSnapshot("%2", "@2")],
    ]);
    const paneState = buildPaneStateSummary(paneStateById);

    const plan = planValidateGroup(group.slotKey, group, paneStateById, paneState, new Map());

    expect(plan).toMatchObject({
      activeIndex: 0,
      changed: true,
      kind: "apply_tabs",
      slotKey: "slot-1",
      tabs: [
        { label: "bash", paneId: "%1" },
        { label: "logs", paneId: "%2" },
      ],
      tabsToKillBeforeApply: [],
      windowId: "@1",
    });
    if (plan.kind === "apply_tabs") {
      expect(plan.materialization).toBeUndefined();
    }
  });

  test("planValidateGroup emits a plain apply-tabs update when a survivor already occupies the dead tab window", () => {
    const group: PaneTabGroup = {
      activeIndex: 0,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "dead", paneId: "%1" },
        { label: "logs", paneId: "%2" },
        { label: "shell", paneId: "%3" },
      ],
      windowId: "@1",
    };
    const paneStateById = new Map<string, PaneSnapshot>([
      ["%1", createPaneSnapshot("%1", "@1", { dead: true })],
      ["%2", createPaneSnapshot("%2", "@1")],
      ["%3", createPaneSnapshot("%3", "@2")],
    ]);
    const paneState = buildPaneStateSummary(paneStateById);
    const windowPanesByWindowId = new Map<string, WindowPaneSnapshot[]>([
      [
        "@1",
        [
          { active: false, height: 24, id: "%1", width: 80 },
          { active: true, height: 24, id: "%2", width: 80 },
        ],
      ],
    ]);

    const plan = planValidateGroup(group.slotKey, group, paneStateById, paneState, windowPanesByWindowId);

    expect(plan).toMatchObject({
      activeIndex: 0,
      changed: true,
      kind: "apply_tabs",
      slotKey: "slot-1",
      tabs: [
        { label: "logs", paneId: "%2" },
        { label: "shell", paneId: "%3" },
      ],
      tabsToKillBeforeApply: [{ label: "dead", paneId: "%1" }],
      windowId: "@1",
    });
    if (plan.kind === "apply_tabs") {
      expect(plan.materialization).toBeUndefined();
      expect(plan.activeTabToKillAfterMaterialize).toBeUndefined();
    }
  });

  test("planValidateGroup emits a promotion intent when the dead active pane leaves no survivor in its window", () => {
    const group: PaneTabGroup = {
      activeIndex: 0,
      slotHeight: 24,
      slotKey: "slot-1",
      slotWidth: 80,
      tabs: [
        { label: "dead", paneId: "%1" },
        { label: "logs", paneId: "%2" },
        { label: "shell", paneId: "%3" },
      ],
      windowId: "@1",
    };
    const paneStateById = new Map<string, PaneSnapshot>([
      ["%1", createPaneSnapshot("%1", "@1", { dead: true })],
      ["%2", createPaneSnapshot("%2", "@2")],
      ["%3", createPaneSnapshot("%3", "@3")],
    ]);
    const paneState = buildPaneStateSummary(paneStateById);

    const plan = planValidateGroup(group.slotKey, group, paneStateById, paneState, new Map());

    expect(plan).toMatchObject({
      activeIndex: 0,
      changed: true,
      kind: "apply_tabs",
      slotKey: "slot-1",
      tabs: [
        { label: "logs", paneId: "%2" },
        { label: "shell", paneId: "%3" },
      ],
      tabsToKillBeforeApply: [],
      windowId: "@1",
    });
    if (plan.kind === "apply_tabs") {
      expect(plan.activeTabToKillAfterMaterialize).toEqual({ label: "dead", paneId: "%1" });
      expect(plan.materialization).toMatchObject({
        currentVisiblePaneId: "%1",
        currentVisiblePaneIsLive: true,
        incomingPaneId: "%2",
        joinTargetPaneId: null,
        kind: "promote_active",
        targetWindowId: "@1",
      });
    }
  });

  test("planValidateGroup does not choose remote-backed siblings as dead-tab join targets", () => {
    const group: PaneTabGroup = {
      activeIndex: 0,
      slotHeight: 92,
      slotKey: "left-slot",
      slotWidth: 108,
      tabs: [
        { label: "dead-left", paneId: "%30" },
        { label: "live-left", paneId: "%29" },
      ],
      windowId: "@4",
    };
    const paneStateById = new Map<string, PaneSnapshot>([
      ["%29", createPaneSnapshot("%29", "@9", { height: 92, width: 108 })],
      ["%30", createPaneSnapshot("%30", "@4", { dead: true, height: 92, width: 108 })],
      ["%8", createPaneSnapshot("%8", "@4", { height: 45, remoteHost: "hs-p8-04", width: 108 })],
      ["%9", createPaneSnapshot("%9", "@4", { height: 46, remoteHost: "hs-p8-04", width: 108 })],
    ]);
    const paneState = buildPaneStateSummary(paneStateById);
    const windowPanesByWindowId = new Map<string, WindowPaneSnapshot[]>([
      [
        "@4",
        [
          { active: true, height: 92, id: "%30", width: 108 },
          { active: false, height: 45, id: "%8", width: 108 },
          { active: false, height: 46, id: "%9", width: 108 },
        ],
      ],
      ["@9", [{ active: true, height: 92, id: "%29", width: 108 }]],
    ]);

    const plan = planValidateGroup(group.slotKey, group, paneStateById, paneState, windowPanesByWindowId);

    expect(plan).toMatchObject({
      activeIndex: 0,
      changed: true,
      kind: "apply_tabs",
      slotKey: "left-slot",
      tabs: [{ label: "live-left", paneId: "%29" }],
      windowId: "@4",
    });
    if (plan.kind === "apply_tabs") {
      expect(plan.materialization).toMatchObject({
        incomingPaneId: "%29",
        joinTargetPaneId: null,
        targetWindowId: "@4",
      });
    }
  });
});
