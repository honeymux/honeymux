import type { MutableRefObject } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabPersistState } from "../services/session-persistence.ts";
import type { PaneTab, PaneTabGroup } from "./types.ts";

import { commitStructuralGroups, pruneShadowedSinglePaneGroups, syncPaneTabMarkers } from "./group-sync.ts";
import {
  clearPaneBorderFormat,
  collectVisibleTabbedPaneIds,
  disableRemainOnExit,
  enableRemainOnExit,
  installExitHook,
  setPaneFormatForTabs,
  uninstallExitHook,
} from "./pane-effects.ts";
import {
  type PaneSnapshot,
  type WindowPaneSnapshot,
  buildPaneStateSummary,
  isPaneGone,
  parsePaneSnapshotOutput,
  planValidateGroup,
  restoreGroupsFromPersistence,
} from "./reconcile.ts";
import {
  applyGroupTabs,
  applyValidateGroupPlan,
  buildHostedTabGroup,
  executeTabRemoval,
  materializePaneTabs,
  materializeWindowTabSwitch,
  refreshValidatedWindows,
} from "./runtime-actions.ts";
import { findPaneTabGroupByPaneId, findPaneTabGroupEntriesByWindowId, groupOwnsHostWindowName } from "./selectors.ts";
import {
  type TabRemovalPlan,
  planGroupTabRemoval,
  planInsertTab,
  planReorderTabs,
  planSwitchTab,
} from "./transitions.ts";
import {
  applyAutomaticRenameModeForPane,
  hydrateAutomaticRenameModes,
  listPaneWindowIdMap,
  listWindowNameMap,
} from "./window-policy.ts";

export interface CreatePaneTabOpsOptions {
  activeWindowIdRef: MutableRefObject<null | string>;
  borderLinesRef: MutableRefObject<string>;
  clientRef: MutableRefObject<TmuxControlClient | null>;
  commitGroups: (groups: Map<string, PaneTabGroup>) => void;
  currentSessionName: string;
  emitLayoutChange: () => void;
  getActiveSlotKey: () => Promise<ActiveSlotInfo | null>;
  groupsRef: MutableRefObject<Map<string, PaneTabGroup>>;
  loadPaneTabState?: (session: string) => Promise<PaneTabPersistState | null>;
  log: (msg: string) => void;
}

export interface PaneTabOps {
  doBootstrapUngroupedPanes: () => Promise<void>;
  doClosePaneTabAt: (slotKey: string, tabIndex: number) => Promise<boolean>;
  doCloseTab: () => Promise<boolean>;
  doDissolveAll: () => Promise<void>;
  /**
   * Drop any single-tab pane-tab group whose only pane is `paneId`, without
   * clearing the pane's border format. Used when the pane is transitioning
   * to a different owner (e.g. remote conversion) that manages its own
   * border format.
   */
  doEvictPaneFromGroup: (paneId: string) => Promise<void>;
  doMovePaneTab: (fromSlotKey: string, fromTabIndex: number, toSlotKey: string, toInsertIndex: number) => Promise<void>;
  doMoveToUngroupedPane: (fromSlotKey: string, fromTabIndex: number, targetPaneId: string) => Promise<void>;
  doNewTab: () => Promise<void>;
  doRefreshLabels: () => Promise<void>;
  doRenameManagedWindow: (windowId: string, newName: string) => Promise<boolean>;
  doRenamePaneTab: (slotKey: string, tabIndex: number, newName: string) => Promise<void>;
  doReorderPaneTab: (slotKey: string, fromIndex: number, toIndex: number) => Promise<void>;
  doRestore: () => Promise<void>;
  doSwitchTab: (slotKey: string, tabIndex: number) => Promise<void>;
  doValidate: () => Promise<void>;
}

interface ActiveSlotInfo {
  height: number;
  paneId: string;
  slotKey: string;
  width: number;
}

export function createPaneTabOps({
  activeWindowIdRef,
  borderLinesRef,
  clientRef,
  commitGroups,
  currentSessionName,
  emitLayoutChange,
  getActiveSlotKey,
  groupsRef,
  loadPaneTabState = async () => null,
  log,
}: CreatePaneTabOpsOptions): PaneTabOps {
  async function refreshActiveTabLabel(client: TmuxControlClient, group: PaneTabGroup): Promise<PaneTabGroup> {
    const activeTab = group.tabs[group.activeIndex];
    if (!activeTab || activeTab.userLabel) return group;

    try {
      const commands = await client.getPaneCommands([activeTab.paneId]);
      const label = commands.get(activeTab.paneId);
      if (!label || label === activeTab.label) return group;
      return {
        ...group,
        tabs: group.tabs.map((tab, index) => (index === group.activeIndex ? { ...tab, label } : tab)),
      };
    } catch {
      return group;
    }
  }

  async function isPaneRemote(client: TmuxControlClient, paneId: string): Promise<boolean> {
    try {
      const output = await client.runCommand(`display-message -p -t ${paneId} '#{@hmx-remote-host}'`);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  async function listPaneSnapshot(client: TmuxControlClient): Promise<Map<string, PaneSnapshot> | null> {
    try {
      const output = await client.runCommand(
        "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{pane_dead}\t#{window_id}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{@hmx-remote-host}'",
      );
      return parsePaneSnapshotOutput(output);
    } catch {
      return null;
    }
  }

  async function listValidationWindowPanes(
    client: TmuxControlClient,
    groups: Map<string, PaneTabGroup>,
    paneStateById: Map<string, PaneSnapshot>,
  ): Promise<Map<string, WindowPaneSnapshot[]>> {
    const candidateWindowIds = new Set<string>();
    for (const group of groups.values()) candidateWindowIds.add(group.windowId);
    for (const pane of paneStateById.values()) candidateWindowIds.add(pane.windowId);

    const windowPanesByWindowId = new Map<string, WindowPaneSnapshot[]>();
    await Promise.all(
      [...candidateWindowIds]
        .filter((windowId) => windowId.length > 0)
        .map(async (windowId) => {
          try {
            windowPanesByWindowId.set(windowId, await client.listPanesInWindow(windowId));
          } catch {}
        }),
    );
    return windowPanesByWindowId;
  }

  async function dissolveTabGroup(
    client: TmuxControlClient,
    paneId: string,
    slotKey: string,
    groups: Map<string, PaneTabGroup>,
  ): Promise<void> {
    const group = groups.get(slotKey);
    await uninstallExitHook(client, paneId);
    await clearPaneBorderFormat(client, paneId);
    await disableRemainOnExit(client, paneId);
    await applyAutomaticRenameModeForPane(client, paneId, group?.restoreAutomaticRename);
    groups.delete(slotKey);
  }

  async function killDeadPanes(
    client: TmuxControlClient,
    tabs: PaneTab[],
    isGone: (id: string) => boolean,
    livePaneIds: Set<string>,
  ): Promise<void> {
    const toKill = tabs.filter((t) => isGone(t.paneId) && livePaneIds.has(t.paneId));
    await Promise.all(toKill.map((t) => client.runCommand(`kill-pane -t ${t.paneId}`).catch(() => {})));
  }

  async function applyRemovalPlanToGroups(
    client: TmuxControlClient,
    slotKey: string,
    removalPlan: TabRemovalPlan,
    groups: Map<string, PaneTabGroup>,
  ): Promise<void> {
    if (removalPlan.nextMode === "empty") {
      groups.delete(slotKey);
      return;
    }
    if (!removalPlan.updatedGroup) return;
    await applyGroupTabs({
      activeIndex: removalPlan.nextActiveIndex,
      borderLinesRef,
      client,
      group: removalPlan.updatedGroup,
      groups,
      slotKey,
      tabs: removalPlan.remainingTabs,
      windowId: removalPlan.updatedGroup.windowId,
    });
  }

  interface CloseTabOptions {
    preferredWindowId?: string;
    requireNextActivePaneId?: boolean;
    treatRemovedAsActive?: boolean;
    visiblePaneId?: string;
  }

  async function closeTabAt(slotKey: string, tabIndex: number, options: CloseTabOptions = {}): Promise<boolean> {
    const client = clientRef.current;
    if (!client) return false;

    const previousGroups = new Map(groupsRef.current);
    const group = groupsRef.current.get(slotKey);
    if (!group || group.tabs.length <= 1) return false;
    if (tabIndex < 0 || tabIndex >= group.tabs.length) return false;

    const removalPlan = planGroupTabRemoval(group, tabIndex, {
      preferredWindowId: options.preferredWindowId,
      treatRemovedAsActive: options.treatRemovedAsActive ?? tabIndex === group.activeIndex,
    });
    if (!removalPlan) return false;
    if (options.requireNextActivePaneId && !removalPlan.nextActivePaneId) return false;

    await uninstallExitHook(client, options.visiblePaneId ?? group.tabs[group.activeIndex]!.paneId);
    await executeTabRemoval({ borderLinesRef, client, group, removalPlan });

    const nextGroups = new Map(groupsRef.current);
    await applyRemovalPlanToGroups(client, slotKey, removalPlan, nextGroups);
    await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });

    return true;
  }

  interface PreparedMoveSource {
    fromGroup: PaneTabGroup;
    movingTab: PaneTab;
    previousGroups: Map<string, PaneTabGroup>;
    sourceRemovalPlan: TabRemovalPlan;
  }

  async function prepareMoveSource(
    client: TmuxControlClient,
    fromSlotKey: string,
    fromTabIndex: number,
  ): Promise<PreparedMoveSource | null> {
    const previousGroups = new Map(groupsRef.current);
    const fromGroup = groupsRef.current.get(fromSlotKey);
    if (!fromGroup) return null;
    if (fromTabIndex < 0 || fromTabIndex >= fromGroup.tabs.length) return null;

    const movingTab = fromGroup.tabs[fromTabIndex]!;
    const sourceRemovalPlan = planGroupTabRemoval(fromGroup, fromTabIndex, {
      treatRemovedAsActive: fromTabIndex === fromGroup.activeIndex,
    });
    if (!sourceRemovalPlan) return null;

    await uninstallExitHook(client, fromGroup.tabs[fromGroup.activeIndex]!.paneId);
    await executeTabRemoval({
      borderLinesRef,
      client,
      group: fromGroup,
      killRemovedPane: false,
      removalPlan: sourceRemovalPlan,
      resizePromotedPane: true,
    });

    return { fromGroup, movingTab, previousGroups, sourceRemovalPlan };
  }

  async function commitActiveGroupChange(
    client: TmuxControlClient,
    previousGroups: Map<string, PaneTabGroup>,
    nextGroups: Map<string, PaneTabGroup>,
    activeGroup: PaneTabGroup,
    options: {
      refreshPtyClient?: boolean;
    } = {},
  ): Promise<void> {
    await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });
    await installExitHook(client, activeGroup, borderLinesRef.current);
    if (!options.refreshPtyClient) return;
    try {
      await client.refreshPtyClient();
    } catch {}
  }

  async function refreshActiveGroupFormats(client: TmuxControlClient, groups: PaneTabGroup[]): Promise<void> {
    await Promise.all(
      groups.map(async (group) => {
        const activePaneId = group.tabs[group.activeIndex]?.paneId;
        if (!activePaneId) return;
        await setPaneFormatForTabs(
          client,
          activePaneId,
          group.tabs,
          group.activeIndex,
          group.slotWidth,
          borderLinesRef.current,
        );
      }),
    );
  }

  async function commitPassiveGroupChange(
    client: TmuxControlClient,
    previousGroups: Map<string, PaneTabGroup>,
    nextGroups: Map<string, PaneTabGroup>,
    groupsToRefresh: PaneTabGroup[] = [],
  ): Promise<void> {
    await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });
    await refreshActiveGroupFormats(client, groupsToRefresh);
  }

  async function doDissolveAll(): Promise<void> {
    const client = clientRef.current;
    if (!client || groupsRef.current.size === 0) return;

    const previousGroups = new Map(groupsRef.current);
    const nextGroups = new Map(groupsRef.current);
    for (const [slotKey, group] of nextGroups) {
      const activePaneId = group.tabs[group.activeIndex]?.paneId;
      for (let i = 0; i < group.tabs.length; i++) {
        if (i === group.activeIndex) continue;
        const paneId = group.tabs[i]!.paneId;
        try {
          await client.runCommand(`kill-pane -t ${paneId}`);
        } catch {}
      }
      if (activePaneId) {
        await dissolveTabGroup(client, activePaneId, slotKey, nextGroups);
      } else {
        nextGroups.delete(slotKey);
      }
    }

    await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });
  }

  async function doRefreshLabels(): Promise<void> {
    const client = clientRef.current;
    if (!client || groupsRef.current.size === 0) return;
    const previousGroups = new Map(groupsRef.current);

    const paneIds: string[] = [];
    for (const [, group] of groupsRef.current) {
      for (const tab of group.tabs) {
        if (!tab.userLabel) paneIds.push(tab.paneId);
      }
    }
    if (paneIds.length === 0) return;

    let cmdMap: Map<string, string>;
    try {
      cmdMap = await client.getPaneCommands(paneIds);
    } catch {
      return;
    }

    let changed = false;
    const nextGroups = new Map(groupsRef.current);
    const changedGroups: PaneTabGroup[] = [];
    for (const [slotKey, group] of nextGroups) {
      let groupChanged = false;
      const newTabs = group.tabs.map((tab) => {
        if (tab.userLabel) return tab;
        const cmd = cmdMap.get(tab.paneId);
        if (cmd && cmd !== tab.label) {
          groupChanged = true;
          return { ...tab, label: cmd };
        }
        return tab;
      });
      if (!groupChanged) continue;

      changed = true;
      const updatedGroup = { ...group, tabs: newTabs };
      nextGroups.set(slotKey, updatedGroup);
      changedGroups.push(updatedGroup);
    }

    if (changed) {
      await commitPassiveGroupChange(client, previousGroups, nextGroups, changedGroups);
    }
  }

  async function doNewTab(): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const activeInfo = await getActiveSlotKey();
    if (!activeInfo) return;

    const { height, paneId, slotKey, width } = activeInfo;
    const hostWindowId = activeWindowIdRef.current;
    if (!hostWindowId) return;

    // Remote panes own their own pane slot (managed by the remote manager),
    // so they cannot participate in pane-tab groups. Refuse to open a new tab
    // on a remote pane — doing so would swap the remote pane into a staging
    // window and tear down the proxy connection.
    if (await isPaneRemote(client, paneId)) {
      log(`doNewTab: refusing to create tab on remote pane ${paneId}`);
      return;
    }

    const previousGroups = new Map(groupsRef.current);
    const { paneId: newPaneId, windowId: newWindowId } = await client.newDetachedWindow("_hmx_tab");

    try {
      await client.disableAutomaticRename(newWindowId);
    } catch {}

    try {
      await client.runCommand(`set-option -w -t ${newPaneId} pane-border-status off`);
    } catch {}
    try {
      await client.runCommand(`set-option -w -t ${newWindowId} window-status-format ''`);
    } catch {}
    try {
      await client.resizePane(newPaneId, width, height);
    } catch {}

    log(`created tab: slotKey=${slotKey} paneId=${paneId} newPaneId=${newPaneId} windowId=${hostWindowId}`);

    const existing = groupsRef.current.get(slotKey);
    if (existing) {
      await uninstallExitHook(client, existing.tabs[existing.activeIndex]!.paneId);
    }

    await enableRemainOnExit(client, newPaneId);
    if (!existing || existing.tabs.length === 1) {
      await enableRemainOnExit(client, paneId);
    }

    let cmdMap: Map<string, string>;
    try {
      cmdMap = await client.getPaneCommands([paneId, newPaneId]);
    } catch {
      cmdMap = new Map();
    }

    const newGroup = await buildHostedTabGroup({
      client,
      currentLabel: cmdMap.get(paneId) ?? "shell",
      currentPaneId: paneId,
      existingGroup: existing,
      groups: groupsRef.current,
      height,
      hostWindowId,
      newLabel: cmdMap.get(newPaneId) ?? "shell",
      newPaneId,
      slotKey,
      width,
    });
    if (!newGroup) return;

    // Once a visible window hosts a pane-tab group, Honeymux owns its label.
    // Leaving tmux automatic rename enabled here allows a dead backing pane
    // to leak through as `bash[dead]` before validation reconciles the slot.
    try {
      await client.disableAutomaticRename(hostWindowId);
    } catch {}

    if (!existing) {
      const visiblePaneIds = collectVisibleTabbedPaneIds(groupsRef.current);
      visiblePaneIds.add(newPaneId);
      await materializePaneTabs({
        borderLinesRef,
        clearSiblingWindowId: hostWindowId,
        client,
        incomingPaneId: newPaneId,
        log,
        logPaneBorderErrors: true,
        refreshBorderLines: true,
        resizeHeight: height,
        resizeWidth: width,
        setTopBorder: true,
        tabActiveIndex: newGroup.activeIndex,
        tabs: newGroup.tabs,
        visiblePaneId: paneId,
        visiblePaneIds,
      });
    } else {
      await materializePaneTabs({
        borderLinesRef,
        client,
        incomingPaneId: newPaneId,
        resizeHeight: height,
        resizeWidth: width,
        setTopBorder: true,
        tabActiveIndex: newGroup.activeIndex,
        tabs: newGroup.tabs,
        visiblePaneId: paneId,
      });
    }

    const nextGroups = new Map(groupsRef.current);
    nextGroups.set(slotKey, newGroup);
    await commitActiveGroupChange(client, previousGroups, nextGroups, newGroup);

    // The source pane can still be transitioning to its new foreground
    // process while we build the group above. Re-query after the swap so a
    // soon-to-be-hidden tab does not get stuck with its stale shell label.
    await doRefreshLabels();
  }

  async function doSwitchTab(slotKey: string, tabIndex: number): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const previousGroups = new Map(groupsRef.current);
    const group = groupsRef.current.get(slotKey);
    if (!group) return;

    const currentPaneId = group.tabs[group.activeIndex]?.paneId;
    const targetPaneId = group.tabs[tabIndex]?.paneId;
    if (!currentPaneId || !targetPaneId) return;

    const paneWindowIds = await listPaneWindowIdMap(client);
    if (!paneWindowIds) return;
    const targetWindowId = paneWindowIds.get(targetPaneId);
    const currentWindowId = paneWindowIds.get(currentPaneId);
    if (!targetWindowId || !currentWindowId) return;

    const windowPanes = await client.listPanesInWindow(currentWindowId);
    const switchPlan = planSwitchTab(group, tabIndex, windowPanes.length > 1 ? currentWindowId : targetWindowId);
    if (!switchPlan) return;
    const updatedGroup = await refreshActiveTabLabel(client, switchPlan.updatedGroup);

    await uninstallExitHook(client, switchPlan.currentPaneId);
    if (windowPanes.length > 1) {
      await materializePaneTabs({
        borderLinesRef,
        client,
        incomingPaneId: switchPlan.targetPaneId,
        resizeHeight: group.slotHeight,
        resizeWidth: group.slotWidth,
        tabActiveIndex: updatedGroup.activeIndex,
        tabs: updatedGroup.tabs,
        visiblePaneId: switchPlan.currentPaneId,
      });
      try {
        await client.setPaneBorderStatus(switchPlan.currentPaneId, "off");
      } catch {}
    } else {
      // Compute the name the promoted (target) window should carry once the
      // swap finalizes.  Passing it into materializeWindowTabSwitch lets that
      // helper rename the staging window inside the atomic command chain
      // that performs the swap, so the tree and tab bar observe only the
      // final state — no transient _hmx_tab frame.
      const activeTabLabel = updatedGroup.tabs[updatedGroup.activeIndex]?.label;
      const newTargetWindowName = groupOwnsHostWindowName(updatedGroup)
        ? (updatedGroup.explicitWindowName ?? activeTabLabel ?? "shell")
        : undefined;
      await materializeWindowTabSwitch({
        borderLinesRef,
        client,
        currentPaneId: switchPlan.currentPaneId,
        currentWindowId,
        newTargetWindowName,
        slotHeight: group.slotHeight,
        slotWidth: group.slotWidth,
        tabActiveIndex: updatedGroup.activeIndex,
        tabs: updatedGroup.tabs,
        targetPaneId: switchPlan.targetPaneId,
        targetWindowId,
      });
    }

    const nextGroups = new Map(groupsRef.current);
    nextGroups.set(slotKey, updatedGroup);
    await commitActiveGroupChange(client, previousGroups, nextGroups, updatedGroup, { refreshPtyClient: true });
  }

  async function doCloseTab(): Promise<boolean> {
    const activeInfo = await getActiveSlotKey();
    if (!activeInfo) return false;

    const group = groupsRef.current.get(activeInfo.slotKey);
    if (!group || group.tabs.length <= 1) return false;

    // Determine which tab to close from the actual pane in the visible window,
    // not from group.activeIndex — the index can be stale if a previous close
    // partially executed (killed the pane but didn't commit the group update).
    let closingTabIndex = group.tabs.findIndex((t) => t.paneId === activeInfo.paneId);
    if (closingTabIndex < 0) closingTabIndex = group.activeIndex;
    return closeTabAt(activeInfo.slotKey, closingTabIndex, {
      preferredWindowId: activeWindowIdRef.current ?? undefined,
      requireNextActivePaneId: true,
      treatRemovedAsActive: true,
      visiblePaneId: activeInfo.paneId,
    });
  }

  async function doValidateOnce(): Promise<boolean> {
    const client = clientRef.current;
    if (!client || groupsRef.current.size === 0) return false;

    const paneStateById = await listPaneSnapshot(client);
    if (!paneStateById) return false;
    const paneState = buildPaneStateSummary(paneStateById);
    const windowPanesByWindowId = await listValidationWindowPanes(client, groupsRef.current, paneStateById);

    let changed = false;
    const nextGroups = new Map(groupsRef.current);
    if (pruneShadowedSinglePaneGroups(nextGroups)) changed = true;

    for (const [slotKey, group] of nextGroups) {
      const plan = planValidateGroup(slotKey, group, paneStateById, paneState, windowPanesByWindowId);
      if (
        await applyValidateGroupPlan({
          borderLinesRef,
          client,
          groups: nextGroups,
          killDeadPanes: (tabs) =>
            killDeadPanes(client, tabs, (paneId) => isPaneGone(paneId, paneState), paneState.livePaneIds),
          log,
          plan,
        })
      ) {
        changed = true;
      }
    }

    if (await refreshValidatedWindows({ borderLinesRef, client, groups: nextGroups })) {
      changed = true;
    }

    if (changed) {
      const previousGroups = new Map(groupsRef.current);
      await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });
    } else {
      await syncPaneTabMarkers(client, new Map(), nextGroups);
    }
    return changed;
  }

  async function doValidate(): Promise<void> {
    let anyChanges = false;
    while (true) {
      const madeChanges = await doValidateOnce();
      if (madeChanges) anyChanges = true;
      if (!madeChanges || groupsRef.current.size === 0) break;
    }
    if (anyChanges) emitLayoutChange();
  }

  async function doRestore(): Promise<void> {
    const client = clientRef.current;
    if (!client) return;
    if (groupsRef.current.size > 0) return;

    const previousGroups = new Map(groupsRef.current);
    const saved = await loadPaneTabState(currentSessionName);
    if (!saved || saved.groups.length === 0) return;

    const paneStateById = await listPaneSnapshot(client);
    if (!paneStateById) return;

    borderLinesRef.current = saved.borderLines;
    const restoredGroups = await hydrateAutomaticRenameModes(
      client,
      restoreGroupsFromPersistence(saved.groups, paneStateById, activeWindowIdRef.current),
    );
    pruneShadowedSinglePaneGroups(restoredGroups);

    await commitStructuralGroups({ client, commitGroups, nextGroups: restoredGroups, previousGroups });
    log(`restored ${restoredGroups.size} pane tab groups from disk`);
    if (restoredGroups.size > 0) {
      await doValidate();
    }
  }

  async function doReorderPaneTab(slotKey: string, fromIndex: number, toIndex: number): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const previousGroups = new Map(groupsRef.current);
    const group = groupsRef.current.get(slotKey);
    if (!group) return;
    const reorderPlan = planReorderTabs(group, fromIndex, toIndex);
    if (!reorderPlan) return;

    await uninstallExitHook(client, group.tabs[group.activeIndex]!.paneId);
    await setPaneFormatForTabs(
      client,
      reorderPlan.activePaneId,
      reorderPlan.updatedGroup.tabs,
      reorderPlan.updatedGroup.activeIndex,
      group.slotWidth,
      borderLinesRef.current,
    );

    const nextGroups = new Map(groupsRef.current);
    nextGroups.set(slotKey, reorderPlan.updatedGroup);
    await commitActiveGroupChange(client, previousGroups, nextGroups, reorderPlan.updatedGroup);
  }

  async function doMovePaneTab(
    fromSlotKey: string,
    fromTabIndex: number,
    toSlotKey: string,
    toInsertIndex: number,
  ): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const toGroup = groupsRef.current.get(toSlotKey);
    if (!toGroup) return;

    if (fromSlotKey === toSlotKey) {
      await doReorderPaneTab(fromSlotKey, fromTabIndex, toInsertIndex);
      return;
    }

    const source = await prepareMoveSource(client, fromSlotKey, fromTabIndex);
    if (!source) return;
    const { movingTab, previousGroups, sourceRemovalPlan } = source;
    const targetInsertPlan = planInsertTab(toGroup, movingTab, toInsertIndex);

    await uninstallExitHook(client, toGroup.tabs[toGroup.activeIndex]!.paneId);
    await materializePaneTabs({
      borderLinesRef,
      client,
      incomingPaneId: movingTab.paneId,
      resizeHeight: toGroup.slotHeight,
      resizeWidth: toGroup.slotWidth,
      tabActiveIndex: targetInsertPlan.updatedGroup.activeIndex,
      tabs: targetInsertPlan.updatedGroup.tabs,
      visiblePaneId: toGroup.tabs[toGroup.activeIndex]!.paneId,
    });

    const nextGroups = new Map(groupsRef.current);
    await applyRemovalPlanToGroups(client, fromSlotKey, sourceRemovalPlan, nextGroups);
    nextGroups.set(toSlotKey, targetInsertPlan.updatedGroup);
    await commitActiveGroupChange(client, previousGroups, nextGroups, targetInsertPlan.updatedGroup);
  }

  async function doMoveToUngroupedPane(fromSlotKey: string, fromTabIndex: number, targetPaneId: string): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const existingGroup = findPaneTabGroupByPaneId(groupsRef.current, targetPaneId);
    if (existingGroup && existingGroup.tabs.length > 1) {
      await doMovePaneTab(fromSlotKey, fromTabIndex, existingGroup.slotKey, existingGroup.tabs.length);
      return;
    }
    const existingSingleGroup = existingGroup && existingGroup.tabs.length === 1 ? existingGroup : undefined;

    const source = await prepareMoveSource(client, fromSlotKey, fromTabIndex);
    if (!source) return;
    const { movingTab, previousGroups, sourceRemovalPlan } = source;

    const hostWindowId = existingSingleGroup?.windowId ?? activeWindowIdRef.current;
    if (!hostWindowId) return;

    let targetWidth = 80;
    let targetHeight = 24;
    try {
      const panes = await client.listPanesInWindow(hostWindowId);
      const target = panes.find((p) => p.id === targetPaneId);
      if (target) {
        targetWidth = target.width;
        targetHeight = target.height;
      }
    } catch {}

    await enableRemainOnExit(client, targetPaneId);

    let targetLabel = existingSingleGroup?.tabs[0]?.label ?? "shell";
    try {
      const commands = await client.getPaneCommands([targetPaneId]);
      targetLabel = existingSingleGroup?.tabs[0]?.userLabel ?? commands.get(targetPaneId) ?? targetLabel;
    } catch {}

    const targetGroup =
      existingSingleGroup == null
        ? undefined
        : {
            ...existingSingleGroup,
            tabs: existingSingleGroup.tabs.map((tab) =>
              tab.paneId === targetPaneId && !tab.userLabel ? { ...tab, label: targetLabel } : tab,
            ),
          };
    const normalizedGroup = await buildHostedTabGroup({
      client,
      currentLabel: targetLabel,
      currentPaneId: targetPaneId,
      existingGroup: targetGroup,
      groups: groupsRef.current,
      height: targetHeight,
      hostWindowId,
      newLabel: movingTab.label,
      newPaneId: movingTab.paneId,
      slotKey: targetGroup?.slotKey ?? targetPaneId,
      width: targetWidth,
    });
    if (!normalizedGroup) return;
    await materializePaneTabs({
      borderLinesRef,
      clearSiblingWindowId: hostWindowId,
      client,
      incomingPaneId: movingTab.paneId,
      refreshBorderLines: true,
      resizeHeight: targetHeight,
      resizeWidth: targetWidth,
      setTopBorder: true,
      tabActiveIndex: normalizedGroup.activeIndex,
      tabs: normalizedGroup.tabs,
      visiblePaneId: targetPaneId,
    });

    const nextGroups = new Map(groupsRef.current);
    nextGroups.set(normalizedGroup.slotKey, normalizedGroup);

    await applyRemovalPlanToGroups(client, fromSlotKey, sourceRemovalPlan, nextGroups);
    await commitActiveGroupChange(client, previousGroups, nextGroups, normalizedGroup);
  }

  async function doRenamePaneTab(slotKey: string, tabIndex: number, newName: string): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const group = groupsRef.current.get(slotKey);
    if (!group || tabIndex < 0 || tabIndex >= group.tabs.length) return;

    const tab = group.tabs[tabIndex]!;
    const userLabel = newName.trim().length > 0 ? newName.trim() : undefined;
    const label = userLabel ?? tab.label;

    const newTabs = group.tabs.map((currentTab, index) =>
      index === tabIndex ? { ...currentTab, label, userLabel } : currentTab,
    );

    const previousGroups = new Map(groupsRef.current);
    const updatedGroup = { ...group, tabs: newTabs };
    const nextGroups = new Map(groupsRef.current);
    nextGroups.set(slotKey, updatedGroup);
    await commitPassiveGroupChange(client, previousGroups, nextGroups, [updatedGroup]);

    if (!userLabel) {
      await doRefreshLabels();
    }
  }

  async function doRenameManagedWindow(windowId: string, newName: string): Promise<boolean> {
    const client = clientRef.current;
    if (!client) return false;

    const entries = findPaneTabGroupEntriesByWindowId(groupsRef.current, windowId).filter(([, group]) =>
      groupOwnsHostWindowName(group),
    );
    if (entries.length === 0) return false;

    const explicitWindowName = newName.trim().length > 0 ? newName.trim() : undefined;
    const previousGroups = new Map(groupsRef.current);
    const nextGroups = new Map(groupsRef.current);
    const updatedGroups: PaneTabGroup[] = [];
    for (const [slotKey, group] of entries) {
      let updatedGroup: PaneTabGroup = { ...group, explicitWindowName };
      updatedGroup = await refreshActiveTabLabel(client, updatedGroup);
      nextGroups.set(slotKey, updatedGroup);
      updatedGroups.push(updatedGroup);
    }
    await commitPassiveGroupChange(client, previousGroups, nextGroups, updatedGroups);
    if (entries.length > 1 && explicitWindowName != null) {
      try {
        await client.renameWindow(windowId, explicitWindowName);
      } catch {}
      try {
        await client.disableAutomaticRename(windowId);
      } catch {}
    }
    return true;
  }

  async function doClosePaneTabAt(slotKey: string, tabIndex: number): Promise<boolean> {
    const group = groupsRef.current.get(slotKey);
    if (!group || group.tabs.length <= 1) return false;
    return closeTabAt(slotKey, tabIndex, {
      preferredWindowId: tabIndex === group.activeIndex ? (activeWindowIdRef.current ?? undefined) : undefined,
      treatRemovedAsActive: tabIndex === group.activeIndex,
    });
  }

  /**
   * Create single-tab groups for panes in the current session that don't
   * already belong to a tab group.  Skips panes in internal `_hmx_` windows
   * (staging windows for inactive tabs) and dead panes.
   */
  async function doBootstrapUngroupedPanes(): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    const paneStateById = await listPaneSnapshot(client);
    if (!paneStateById) return;

    const windowNameMap = await listWindowNameMap(client);
    if (!windowNameMap) return;

    // Collect all pane IDs already covered by a tab group.
    const groupedPaneIds = new Set<string>();
    for (const group of groupsRef.current.values()) {
      for (const tab of group.tabs) groupedPaneIds.add(tab.paneId);
    }

    // Find ungrouped, live, non-staging, non-remote panes.
    const ungrouped: PaneSnapshot[] = [];
    for (const pane of paneStateById.values()) {
      if (pane.dead) continue;
      if (pane.sessionName !== currentSessionName) continue;
      if (groupedPaneIds.has(pane.paneId)) continue;
      if (pane.remoteHost) continue;
      const windowName = windowNameMap.get(pane.windowId) ?? "";
      if (windowName.startsWith("_hmx_")) continue;
      ungrouped.push(pane);
    }

    if (ungrouped.length === 0) return;

    // Batch-fetch command labels.
    let cmdMap: Map<string, string>;
    try {
      cmdMap = await client.getPaneCommands(ungrouped.map((p) => p.paneId));
    } catch {
      cmdMap = new Map();
    }

    const nextGroups = new Map(groupsRef.current);
    const bootstrappedGroups: PaneTabGroup[] = [];
    for (const pane of ungrouped) {
      const label = cmdMap.get(pane.paneId) ?? "shell";
      const group: PaneTabGroup = {
        activeIndex: 0,
        slotHeight: pane.height,
        slotKey: pane.paneId,
        slotWidth: pane.width,
        tabs: [{ label, paneId: pane.paneId }],
        windowId: pane.windowId,
      };
      nextGroups.set(pane.paneId, group);
      bootstrappedGroups.push(group);
    }

    await commitPassiveGroupChange(client, new Map(groupsRef.current), nextGroups, bootstrappedGroups);

    log(`bootstrapped ${ungrouped.length} single-tab group(s)`);
  }

  async function doEvictPaneFromGroup(paneId: string): Promise<void> {
    const client = clientRef.current;
    if (!client) return;

    let matchingSlotKey: string | undefined;
    for (const [slotKey, group] of groupsRef.current) {
      if (group.tabs.length !== 1) continue;
      if (group.tabs[0]?.paneId !== paneId) continue;
      matchingSlotKey = slotKey;
      break;
    }
    if (!matchingSlotKey) return;

    const previousGroups = new Map(groupsRef.current);
    const nextGroups = new Map(groupsRef.current);
    nextGroups.delete(matchingSlotKey);

    await uninstallExitHook(client, paneId);
    await disableRemainOnExit(client, paneId);
    await commitStructuralGroups({ client, commitGroups, nextGroups, previousGroups });
    log(`evicted pane ${paneId} from single-tab group`);
  }

  return {
    doBootstrapUngroupedPanes,
    doClosePaneTabAt,
    doCloseTab,
    doDissolveAll,
    doEvictPaneFromGroup,
    doMovePaneTab,
    doMoveToUngroupedPane,
    doNewTab,
    doRefreshLabels,
    doRenameManagedWindow,
    doRenamePaneTab,
    doReorderPaneTab,
    doRestore,
    doSwitchTab,
    doValidate,
  };
}
