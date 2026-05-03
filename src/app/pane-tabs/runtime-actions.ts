import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { ValidateGroupPlan } from "./reconcile.ts";
import type { TabRemovalPlan } from "./transitions.ts";
import type { PaneTab, PaneTabGroup } from "./types.ts";

import { quoteTmuxArg } from "../../tmux/escape.ts";
import {
  clearSiblingPaneFormats,
  collectVisibleTabbedPaneIds,
  disableRemainOnExit,
  installExitHook,
  setPaneFormatForTabs,
  uninstallExitHook,
} from "./pane-effects.ts";
import { planNewTabGroup } from "./transitions.ts";
import { resolveHostWindowRenameState } from "./window-policy.ts";

interface ApplyGroupTabsOptions {
  activeIndex: number;
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  group: PaneTabGroup;
  groups: Map<string, PaneTabGroup>;
  slotKey: string;
  tabs: PaneTab[];
  windowId?: string;
}

interface ApplyValidateGroupPlanOptions {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  groups: Map<string, PaneTabGroup>;
  killDeadPanes: (tabs: PaneTabGroup["tabs"]) => Promise<void>;
  log: (msg: string) => void;
  plan: ValidateGroupPlan;
}

interface BorderLinesState {
  current: string;
}

interface BuildHostedTabGroupOptions {
  client: TmuxControlClient;
  currentLabel: string;
  currentPaneId: string;
  existingGroup?: PaneTabGroup;
  groups: Map<string, PaneTabGroup>;
  height: number;
  hostWindowId: string;
  insertIndex?: number;
  newLabel: string;
  newPaneId: string;
  newUserLabel?: string;
  slotKey: string;
  width: number;
}

interface ExecuteTabRemovalOptions {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  group: PaneTabGroup;
  killRemovedPane?: boolean;
  removalPlan: TabRemovalPlan;
  resizePromotedPane?: boolean;
}

interface MaterializePaneTabsOptions {
  borderLinesRef: BorderLinesState;
  clearSiblingWindowId?: string;
  client: TmuxControlClient;
  incomingPaneId: string;
  log?: (msg: string) => void;
  logPaneBorderErrors?: boolean;
  refreshBorderLines?: boolean;
  resizeHeight?: number;
  resizeWidth?: number;
  setTopBorder?: boolean;
  tabActiveIndex: number;
  tabs: PaneTab[];
  visiblePaneId: string;
  visiblePaneIds?: Set<string>;
}

interface MaterializeWindowTabSwitchOptions {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  currentPaneId: string;
  currentWindowId: string;
  /**
   * Name to apply to the target (promoted) window as part of the atomic
   * swap.  When omitted, the window keeps whatever name it already has —
   * callers that pass undefined must be comfortable with a transient
   * `_hmx_tab` label appearing in status line and tree views until some
   * later sync step renames the window.
   */
  newTargetWindowName?: string;
  slotHeight: number;
  slotWidth: number;
  tabActiveIndex: number;
  tabs: PaneTab[];
  targetPaneId: string;
  targetWindowId: string;
}

interface PromotePaneIntoSlotOptions {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  currentVisiblePaneId: string;
  currentVisiblePaneIsLive: boolean;
  incomingPaneId: string;
  joinTargetPaneId: null | string;
  log: (msg: string) => void;
  slotHeight: number;
  slotWidth: number;
  tabActiveIndex: number;
  tabs: PaneTab[];
  targetWindowId: string;
}

interface PromotePaneIntoSlotResult {
  promotedIntoVisibleSlot: boolean;
  windowId: string;
}

interface RefreshValidatedWindowsOptions {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  groups: Map<string, PaneTabGroup>;
}

export async function applyGroupTabs({
  activeIndex,
  borderLinesRef,
  client,
  group,
  groups,
  slotKey,
  tabs,
  windowId,
}: ApplyGroupTabsOptions): Promise<void> {
  if (tabs.length === 0) {
    groups.delete(slotKey);
    return;
  }

  if (tabs.length === 1) {
    await reduceToSingleTabGroup({
      borderLinesRef,
      client,
      group,
      groups,
      slotKey,
      tab: tabs[0]!,
      windowId,
    });
    return;
  }

  const updatedGroup: PaneTabGroup = {
    ...group,
    activeIndex,
    tabs,
    windowId: windowId ?? group.windowId,
  };
  groups.set(slotKey, updatedGroup);
  await installExitHook(client, updatedGroup, borderLinesRef.current);
}

export async function applyValidateGroupPlan({
  borderLinesRef,
  client,
  groups,
  killDeadPanes,
  log,
  plan,
}: ApplyValidateGroupPlanOptions): Promise<boolean> {
  if (plan.kind === "drop_missing") {
    groups.delete(plan.slotKey);
    return true;
  }

  if (plan.kind === "drop_empty") {
    groups.delete(plan.slotKey);
    return true;
  }

  await killDeadPanes(plan.tabsToKillBeforeApply);
  if (plan.logMessage) log(plan.logMessage);

  let windowId = plan.windowId;
  if (plan.materialization) {
    const { promotedIntoVisibleSlot, windowId: materializedWindowId } = await promotePaneIntoSlot({
      borderLinesRef,
      client,
      currentVisiblePaneId: plan.materialization.currentVisiblePaneId,
      currentVisiblePaneIsLive: plan.materialization.currentVisiblePaneIsLive,
      incomingPaneId: plan.materialization.incomingPaneId,
      joinTargetPaneId: plan.materialization.joinTargetPaneId,
      log,
      slotHeight: plan.runtimeGroup.slotHeight,
      slotWidth: plan.runtimeGroup.slotWidth,
      tabActiveIndex: plan.activeIndex,
      tabs: plan.tabs,
      targetWindowId: plan.materialization.targetWindowId,
    });
    windowId = materializedWindowId;

    if (plan.activeTabToKillAfterMaterialize) {
      if (promotedIntoVisibleSlot) {
        try {
          await client.runCommand(`kill-pane -t ${plan.activeTabToKillAfterMaterialize.paneId}`);
        } catch {}
      } else {
        await killDeadPanes([plan.activeTabToKillAfterMaterialize]);
      }
    }
  }

  await applyGroupTabs({
    activeIndex: plan.activeIndex,
    borderLinesRef,
    client,
    group: plan.runtimeGroup,
    groups,
    slotKey: plan.slotKey,
    tabs: plan.tabs,
    windowId,
  });
  return plan.changed;
}

export async function buildHostedTabGroup({
  client,
  currentLabel,
  currentPaneId,
  existingGroup,
  groups,
  height,
  hostWindowId,
  insertIndex,
  newLabel,
  newPaneId,
  newUserLabel,
  slotKey,
  width,
}: BuildHostedTabGroupOptions): Promise<PaneTabGroup | null> {
  const inheritedHostWindowState = await resolveHostWindowRenameState(client, groups, hostWindowId, slotKey);
  const restoreAutomaticRename =
    existingGroup?.restoreAutomaticRename ?? inheritedHostWindowState.restoreAutomaticRename;
  const explicitWindowName = existingGroup?.explicitWindowName ?? inheritedHostWindowState.explicitWindowName;

  const newGroup = planNewTabGroup({
    currentLabel,
    currentPaneId,
    existingGroup,
    explicitWindowName,
    height,
    insertIndex,
    newLabel,
    newPaneId,
    newUserLabel,
    restoreAutomaticRename,
    slotKey,
    width,
    windowId: hostWindowId,
  });
  if (!newGroup) return null;

  return {
    ...newGroup,
    slotHeight: height,
    slotWidth: width,
    windowId: hostWindowId,
  };
}

export async function executeTabRemoval({
  borderLinesRef,
  client,
  group,
  killRemovedPane,
  removalPlan,
  resizePromotedPane,
}: ExecuteTabRemovalOptions): Promise<void> {
  if (removalPlan.removedWasActive) {
    if (!removalPlan.nextActivePaneId) return;
    await materializePaneTabs({
      borderLinesRef,
      client,
      incomingPaneId: removalPlan.nextActivePaneId,
      resizeHeight: resizePromotedPane ? group.slotHeight : undefined,
      resizeWidth: resizePromotedPane ? group.slotWidth : undefined,
      tabActiveIndex: removalPlan.nextActiveIndex,
      tabs: removalPlan.remainingTabs,
      visiblePaneId: removalPlan.removedTab.paneId,
    });
  }

  if (killRemovedPane ?? true) {
    try {
      await client.runCommand(`kill-pane -t ${removalPlan.removedTab.paneId}`);
    } catch {}
  }
}

export async function materializePaneTabs({
  borderLinesRef,
  clearSiblingWindowId,
  client,
  incomingPaneId,
  log,
  logPaneBorderErrors,
  refreshBorderLines,
  resizeHeight,
  resizeWidth,
  setTopBorder,
  tabActiveIndex,
  tabs,
  visiblePaneId,
  visiblePaneIds,
}: MaterializePaneTabsOptions): Promise<void> {
  if (resizeWidth != null && resizeHeight != null) {
    try {
      await client.resizePane(incomingPaneId, resizeWidth, resizeHeight);
    } catch {}
  }

  await client.swapPane(visiblePaneId, incomingPaneId);

  if (refreshBorderLines) {
    try {
      borderLinesRef.current = await client.getPaneBorderLines();
    } catch {}
  }

  await setPaneFormatForTabs(client, incomingPaneId, tabs, tabActiveIndex, resizeWidth ?? 80, borderLinesRef.current);

  if (setTopBorder) {
    try {
      await client.setPaneBorderStatus(incomingPaneId, "top");
    } catch {}
  }

  if (!clearSiblingWindowId) return;

  try {
    await clearSiblingPaneFormats(client, clearSiblingWindowId, visiblePaneIds ?? new Set([incomingPaneId]));
  } catch (err) {
    if (logPaneBorderErrors && log) log(`setPaneBorder failed: ${err}`);
  }
}

export async function materializeWindowTabSwitch({
  borderLinesRef,
  client,
  currentPaneId,
  currentWindowId,
  newTargetWindowName,
  slotHeight,
  slotWidth,
  tabActiveIndex,
  tabs,
  targetPaneId,
  targetWindowId,
}: MaterializeWindowTabSwitchOptions): Promise<void> {
  try {
    await client.resizePane(targetPaneId, slotWidth, slotHeight);
  } catch {}

  await setPaneFormatForTabs(client, targetPaneId, tabs, tabActiveIndex, slotWidth, borderLinesRef.current);

  try {
    await client.setPaneBorderStatus(targetPaneId, "top");
  } catch {}

  // Perform the window-status-format flip, both renames, and the swap as a
  // single atomic tmux command chain.  tmux buffers the resulting
  // %window-renamed / %session-window-changed notifications until the whole
  // block completes, so the tab bar and server tree observe only the final
  // state — the promoted window never appears with its transient _hmx_tab
  // name, and the currently-visible window never appears duplicated while
  // intermediate renames are in flight.
  const chain: string[] = [
    `set-option -wu -t ${targetWindowId} window-status-format`,
    `rename-window -t ${currentWindowId} _hmx_tab`,
    `set-option -w -t ${currentWindowId} window-status-format ''`,
  ];
  if (newTargetWindowName != null && newTargetWindowName.length > 0) {
    chain.push(`rename-window -t ${targetWindowId} ${quoteTmuxArg("newName", newTargetWindowName)}`);
    chain.push(`set-option -w -t ${targetWindowId} automatic-rename off`);
  }
  chain.push(`swap-window -s ${targetWindowId} -t ${currentWindowId}`);
  chain.push(`select-window -t ${targetWindowId}`);
  try {
    await client.runWindowSwapChain(chain);
  } catch {}

  try {
    await client.setPaneBorderStatus(currentPaneId, "off");
  } catch {}
}

export async function promotePaneIntoSlot({
  borderLinesRef,
  client,
  currentVisiblePaneId,
  currentVisiblePaneIsLive,
  incomingPaneId,
  joinTargetPaneId,
  log,
  slotHeight,
  slotWidth,
  tabActiveIndex,
  tabs,
  targetWindowId,
}: PromotePaneIntoSlotOptions): Promise<PromotePaneIntoSlotResult> {
  if (currentVisiblePaneIsLive) {
    try {
      await materializePaneTabs({
        borderLinesRef,
        client,
        incomingPaneId,
        resizeHeight: slotHeight,
        resizeWidth: slotWidth,
        tabActiveIndex,
        tabs,
        visiblePaneId: currentVisiblePaneId,
      });
      return { promotedIntoVisibleSlot: true, windowId: targetWindowId };
    } catch (err) {
      log(`swap-pane failed: ${err}`);
    }
  }

  await setPaneFormatForTabs(client, incomingPaneId, tabs, tabActiveIndex, slotWidth, borderLinesRef.current);

  let joined = false;
  let windowId = targetWindowId;
  if (joinTargetPaneId) {
    try {
      await client.runCommand(`join-pane -h -s ${incomingPaneId} -t ${joinTargetPaneId} -l ${slotWidth}`);
      joined = true;
    } catch (err) {
      log(`join-pane failed: ${err}`);
    }
  }

  if (!joined) {
    try {
      const output = await client.runCommand(`break-pane -P -F '#{window_id}' -s ${incomingPaneId}`);
      windowId = output.trim();
    } catch (err) {
      log(`break-pane failed: ${err}`);
    }
  }

  if (tabs.length > 1 && !joined) {
    try {
      await client.setPaneBorderStatus(incomingPaneId, "top");
    } catch {}
  }

  return { promotedIntoVisibleSlot: false, windowId };
}

export async function refreshValidatedWindows({
  borderLinesRef,
  client,
  groups,
}: RefreshValidatedWindowsOptions): Promise<boolean> {
  if (groups.size === 0) return false;

  let changed = false;
  const visiblePaneIds = collectVisibleTabbedPaneIds(groups);
  const windowIds = new Set([...groups.values()].map((group) => group.windowId));

  for (const windowId of windowIds) {
    try {
      const panes = await client.listPanesInWindow(windowId);
      await clearSiblingPaneFormats(client, windowId, visiblePaneIds);

      for (const [slotKey, group] of groups) {
        if (group.windowId !== windowId) continue;
        const activePaneId = group.tabs[group.activeIndex]!.paneId;
        const activePane = panes.find((pane) => pane.id === activePaneId);
        if (activePane && (activePane.width !== group.slotWidth || activePane.height !== group.slotHeight)) {
          const updatedGroup: PaneTabGroup = {
            ...group,
            slotHeight: activePane.height,
            slotWidth: activePane.width,
          };
          groups.set(slotKey, updatedGroup);
          void setPaneFormatForTabs(
            client,
            activePaneId,
            updatedGroup.tabs,
            updatedGroup.activeIndex,
            activePane.width,
            borderLinesRef.current,
          );
          changed = true;
        }
      }
    } catch {}
  }

  return changed;
}

async function reduceToSingleTabGroup(options: {
  borderLinesRef: BorderLinesState;
  client: TmuxControlClient;
  group: PaneTabGroup;
  groups: Map<string, PaneTabGroup>;
  slotKey: string;
  tab: PaneTab;
  windowId?: string;
}): Promise<void> {
  const { borderLinesRef, client, group, groups, slotKey, tab, windowId } = options;

  await uninstallExitHook(client, tab.paneId);
  await disableRemainOnExit(client, tab.paneId);

  const singleGroup: PaneTabGroup = {
    ...group,
    activeIndex: 0,
    tabs: [tab],
    windowId: windowId ?? group.windowId,
  };
  groups.set(slotKey, singleGroup);
  await setPaneFormatForTabs(client, tab.paneId, [tab], 0, group.slotWidth, borderLinesRef.current);
}
