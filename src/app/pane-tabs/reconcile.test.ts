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
});
