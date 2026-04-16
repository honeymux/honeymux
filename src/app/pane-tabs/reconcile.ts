import type { PaneTabPersistGroup } from "../services/session-persistence.ts";
import type { PaneTab, PaneTabGroup } from "./types.ts";

export interface PaneSnapshot {
  active: boolean;
  dead: boolean;
  height: number;
  paneId: string;
  remoteHost?: string;
  sessionName: string;
  width: number;
  windowId: string;
}

export interface PaneStateSummary {
  deadPaneIds: Set<string>;
  livePaneIds: Set<string>;
  windowByPaneId: Map<string, string>;
}

export interface ValidateGroupMaterializationPlan {
  currentVisiblePaneId: string;
  currentVisiblePaneIsLive: boolean;
  incomingPaneId: string;
  joinTargetPaneId: null | string;
  kind: "promote_active";
  targetWindowId: string;
}

export type ValidateGroupPlan =
  | {
      activeIndex: number;
      activeTabToKillAfterMaterialize?: PaneTab;
      changed: boolean;
      kind: "apply_tabs";
      logMessage?: string;
      materialization?: ValidateGroupMaterializationPlan;
      runtimeGroup: PaneTabGroup;
      slotKey: string;
      tabs: PaneTab[];
      tabsToKillBeforeApply: PaneTab[];
      windowId: string;
    }
  | {
      kind: "drop_empty";
      slotKey: string;
    }
  | {
      kind: "drop_missing";
      slotKey: string;
    };

export interface WindowPaneSnapshot {
  active: boolean;
  height: number;
  id: string;
  width: number;
}

interface ApplyTabsValidatePlanInput {
  activeIndex: number;
  activeTabToKillAfterMaterialize?: PaneTab;
  changed: boolean;
  logMessage?: string;
  materialization?: ValidateGroupMaterializationPlan;
  runtimeGroup: PaneTabGroup;
  slotKey: string;
  tabs: PaneTab[];
  tabsToKillBeforeApply: PaneTab[];
  windowId: string;
}

interface RuntimeGroupInput {
  activePaneId?: string;
  explicitWindowName?: string;
  restoreAutomaticRename?: boolean;
  slotHeight?: number;
  slotKey: string;
  slotWidth?: number;
  tabs: PaneTab[];
  windowId?: string;
}

export function buildApplyTabsValidatePlan(input: ApplyTabsValidatePlanInput): ValidateGroupPlan {
  return {
    activeIndex: input.activeIndex,
    activeTabToKillAfterMaterialize: input.activeTabToKillAfterMaterialize,
    changed: input.changed,
    kind: "apply_tabs",
    logMessage: input.logMessage,
    materialization: input.materialization,
    runtimeGroup: input.runtimeGroup,
    slotKey: input.slotKey,
    tabs: input.tabs,
    tabsToKillBeforeApply: input.tabsToKillBeforeApply,
    windowId: input.windowId,
  };
}

export function buildPaneStateSummary(paneStateById: Map<string, PaneSnapshot>): PaneStateSummary {
  return {
    deadPaneIds: new Set([...paneStateById.values()].filter((pane) => pane.dead).map((pane) => pane.paneId)),
    livePaneIds: new Set(paneStateById.keys()),
    windowByPaneId: new Map([...paneStateById.values()].map((pane) => [pane.paneId, pane.windowId] as const)),
  };
}

export function buildRuntimeGroup(
  group: RuntimeGroupInput,
  paneStateById: Map<string, PaneSnapshot>,
): PaneTabGroup | null {
  const tabs = group.tabs.filter((tab) => paneStateById.has(tab.paneId));
  if (tabs.length === 0) return null;

  const activePaneId =
    group.activePaneId && tabs.some((tab) => tab.paneId === group.activePaneId) ? group.activePaneId : tabs[0]!.paneId;
  const activeIndex = tabs.findIndex((tab) => tab.paneId === activePaneId);
  const activePane = paneStateById.get(activePaneId) ?? paneStateById.get(tabs[0]!.paneId)!;
  const fallbackPane = paneStateById.get(tabs[0]!.paneId)!;

  return {
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    explicitWindowName: group.explicitWindowName,
    restoreAutomaticRename: group.restoreAutomaticRename,
    slotHeight: activePane.height || group.slotHeight || fallbackPane.height || 24,
    slotKey: group.slotKey,
    slotWidth: activePane.width || group.slotWidth || fallbackPane.width || 80,
    tabs,
    windowId: activePane.windowId || group.windowId || fallbackPane.windowId,
  };
}

export function didRuntimeGroupDrift(group: PaneTabGroup, runtimeGroup: PaneTabGroup): boolean {
  return (
    runtimeGroup.explicitWindowName !== group.explicitWindowName ||
    runtimeGroup.windowId !== group.windowId ||
    runtimeGroup.activeIndex !== group.activeIndex ||
    runtimeGroup.tabs.length !== group.tabs.length ||
    runtimeGroup.slotWidth !== group.slotWidth ||
    runtimeGroup.slotHeight !== group.slotHeight
  );
}

export function isPaneGone(paneId: string, paneState: PaneStateSummary): boolean {
  return paneState.deadPaneIds.has(paneId) || !paneState.livePaneIds.has(paneId);
}

export function parsePaneSnapshotOutput(output: string): Map<string, PaneSnapshot> {
  const panes = new Map<string, PaneSnapshot>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const hasSessionName = parts.length >= 7;
    const paneId = hasSessionName ? parts[1] : parts[0];
    if (!paneId) continue;
    const remoteHostRaw = hasSessionName ? (parts[7] ?? "") : "";
    panes.set(paneId, {
      active: (hasSessionName ? parts[6] : parts[5]) === "1",
      dead: (hasSessionName ? parts[2] : parts[1]) === "1",
      height: parseInt(hasSessionName ? (parts[5] ?? "0") : (parts[4] ?? "0"), 10) || 0,
      paneId,
      remoteHost: remoteHostRaw.length > 0 ? remoteHostRaw : undefined,
      sessionName: hasSessionName ? (parts[0] ?? "") : "",
      width: parseInt(hasSessionName ? (parts[4] ?? "0") : (parts[3] ?? "0"), 10) || 0,
      windowId: hasSessionName ? (parts[3] ?? "") : (parts[2] ?? ""),
    });
  }
  return panes;
}

export function planValidateGroup(
  slotKey: string,
  group: PaneTabGroup,
  paneStateById: Map<string, PaneSnapshot>,
  paneState: PaneStateSummary,
  windowPanesByWindowId: Map<string, WindowPaneSnapshot[]>,
): ValidateGroupPlan {
  const storedWindowPanes = windowPanesByWindowId.get(group.windowId) ?? [];
  const storedWindowHasSiblingPanes = storedWindowPanes.some(
    (pane) => !group.tabs.some((tab) => tab.paneId === pane.id),
  );
  const preferredVisiblePaneId = storedWindowHasSiblingPanes
    ? group.tabs.find((tab) => paneStateById.get(tab.paneId)?.windowId === group.windowId)?.paneId
    : undefined;

  const runtimeGroup = buildRuntimeGroup(
    {
      ...group,
      activePaneId: preferredVisiblePaneId ?? group.tabs[group.activeIndex]?.paneId,
    },
    paneStateById,
  );
  if (!runtimeGroup) {
    return { kind: "drop_missing", slotKey };
  }

  const drifted = didRuntimeGroupDrift(group, runtimeGroup);
  const activeTab = runtimeGroup.tabs[runtimeGroup.activeIndex];
  const deadTabs = runtimeGroup.tabs.filter((tab) => isPaneGone(tab.paneId, paneState));
  const activeTabGone = activeTab != null && deadTabs.some((tab) => tab.paneId === activeTab.paneId);

  if (activeTabGone) {
    const survivors = runtimeGroup.tabs.filter((tab) => !isPaneGone(tab.paneId, paneState));
    if (survivors.length === 0) {
      return { kind: "drop_empty", slotKey };
    }

    const targetWindowId =
      paneState.windowByPaneId.get(activeTab.paneId) ?? resolveGroupWindowId(runtimeGroup, paneState.windowByPaneId);
    const targetWindowPanes = windowPanesByWindowId.get(targetWindowId) ?? [];
    const survivorInWindowId =
      survivors.find((survivor) => targetWindowPanes.some((pane) => pane.id === survivor.paneId))?.paneId ?? null;
    const promotedIndex = runtimeGroup.activeIndex < survivors.length ? runtimeGroup.activeIndex : survivors.length - 1;
    const joinTargetPaneId = targetWindowPanes.length > 0 ? targetWindowPanes[targetWindowPanes.length - 1]!.id : null;
    const logMessage = `validateTabGroups: active tab ${activeTab.paneId} gone in group ${slotKey}, ${survivors.length} survivors`;

    if (survivorInWindowId) {
      const activeIndex = survivors.findIndex((tab) => tab.paneId === survivorInWindowId);
      return buildApplyTabsValidatePlan({
        activeIndex: activeIndex >= 0 ? activeIndex : 0,
        changed: true,
        logMessage,
        runtimeGroup,
        slotKey,
        tabs: survivors,
        tabsToKillBeforeApply: deadTabs,
        windowId: targetWindowId,
      });
    }

    return buildApplyTabsValidatePlan({
      activeIndex: promotedIndex,
      activeTabToKillAfterMaterialize: activeTab,
      changed: true,
      logMessage,
      materialization: {
        currentVisiblePaneId: activeTab.paneId,
        currentVisiblePaneIsLive: paneState.livePaneIds.has(activeTab.paneId),
        incomingPaneId: survivors[promotedIndex]!.paneId,
        joinTargetPaneId,
        kind: "promote_active",
        targetWindowId,
      },
      runtimeGroup,
      slotKey,
      tabs: survivors,
      tabsToKillBeforeApply: deadTabs.filter((tab) => tab.paneId !== activeTab.paneId),
      windowId: targetWindowId,
    });
  }

  if (deadTabs.length === 0) {
    return buildApplyTabsValidatePlan({
      activeIndex: runtimeGroup.activeIndex,
      changed: drifted,
      runtimeGroup,
      slotKey,
      tabs: runtimeGroup.tabs,
      tabsToKillBeforeApply: [],
      windowId: runtimeGroup.windowId,
    });
  }

  const survivingTabs = runtimeGroup.tabs.filter((tab) => !isPaneGone(tab.paneId, paneState));
  const newActiveIndex = survivingTabs.findIndex((tab) => tab.paneId === activeTab!.paneId);

  return buildApplyTabsValidatePlan({
    activeIndex: newActiveIndex >= 0 ? newActiveIndex : 0,
    changed: true,
    logMessage: `validateTabGroups: group ${slotKey} had ${runtimeGroup.tabs.length} tabs, ${survivingTabs.length} survive`,
    runtimeGroup,
    slotKey,
    tabs: survivingTabs,
    tabsToKillBeforeApply: deadTabs,
    windowId: runtimeGroup.windowId,
  });
}

export function resolveGroupWindowId(group: PaneTabGroup, windowByPaneId: Map<string, string>): string {
  const activePaneId = group.tabs[group.activeIndex]?.paneId;
  if (activePaneId) {
    const mapped = windowByPaneId.get(activePaneId);
    if (mapped) return mapped;
  }
  for (const tab of group.tabs) {
    const mapped = windowByPaneId.get(tab.paneId);
    if (mapped) return mapped;
  }
  return group.windowId;
}

export function restoreGroupsFromPersistence(
  savedGroups: PaneTabPersistGroup[],
  paneStateById: Map<string, PaneSnapshot>,
  activeWindowId: null | string,
): Map<string, PaneTabGroup> {
  const restoredGroups = new Map<string, PaneTabGroup>();
  for (const group of savedGroups) {
    const visibleActivePaneId =
      activeWindowId == null
        ? undefined
        : group.tabs.find((tab) => paneStateById.get(tab.paneId)?.windowId === activeWindowId)?.paneId;
    const restoredGroup = buildRuntimeGroup(
      {
        activePaneId: visibleActivePaneId ?? group.activePaneId,
        explicitWindowName: group.explicitWindowName,
        restoreAutomaticRename: group.restoreAutomaticRename,
        slotKey: group.slotKey,
        tabs: group.tabs,
      },
      paneStateById,
    );
    if (restoredGroup) restoredGroups.set(group.slotKey, restoredGroup);
  }
  return restoredGroups;
}
