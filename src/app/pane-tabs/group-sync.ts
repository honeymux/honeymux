import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabGroup } from "./types.ts";

import { normalizeHiddenTabWindows, syncManagedWindowNamesForGroups } from "./window-policy.ts";

const PANE_TAB_ACTIVE_OPTION = "@hmx-pane-tab-active";
const PANE_TAB_MEMBER_OPTION = "@hmx-pane-tab-member";

interface CommitStructuralGroupsOptions {
  client: TmuxControlClient;
  commitGroups: (groups: Map<string, PaneTabGroup>) => void;
  nextGroups: Map<string, PaneTabGroup>;
  previousGroups: Map<string, PaneTabGroup>;
}

interface PaneTabMarkerState {
  active: Set<string>;
  members: Set<string>;
}

export async function commitStructuralGroups({
  client,
  commitGroups,
  nextGroups,
  previousGroups,
}: CommitStructuralGroupsOptions): Promise<void> {
  commitGroups(nextGroups);
  await syncPaneTabMarkers(client, previousGroups, nextGroups);
  await syncManagedWindowNamesForGroups(client, nextGroups);
  await normalizeHiddenTabWindows(client, nextGroups);
}

export function pruneShadowedSinglePaneGroups(groups: Map<string, PaneTabGroup>): boolean {
  const paneMembershipCounts = new Map<string, number>();
  for (const group of groups.values()) {
    for (const tab of group.tabs) {
      paneMembershipCounts.set(tab.paneId, (paneMembershipCounts.get(tab.paneId) ?? 0) + 1);
    }
  }

  let changed = false;
  for (const [slotKey, group] of groups) {
    if (group.tabs.length !== 1) continue;
    const paneId = group.tabs[0]?.paneId;
    if (!paneId) continue;
    if ((paneMembershipCounts.get(paneId) ?? 0) <= 1) continue;
    groups.delete(slotKey);
    changed = true;
  }
  return changed;
}

export async function syncPaneTabMarkers(
  client: TmuxControlClient,
  previousGroups: Map<string, PaneTabGroup>,
  nextGroups: Map<string, PaneTabGroup>,
): Promise<void> {
  const previous = collectPaneTabMarkerState(previousGroups);
  const next = collectPaneTabMarkerState(nextGroups);
  const previousIsEmpty = previous.active.size === 0 && previous.members.size === 0;

  await Promise.all([
    ...[...next.members]
      .filter((paneId) => !previous.members.has(paneId))
      .map(async (paneId) => {
        try {
          await client.runCommand(`set-option -p -t ${paneId} ${PANE_TAB_MEMBER_OPTION} 1`);
        } catch {}
      }),
    ...[...previous.members]
      .filter((paneId) => !next.members.has(paneId))
      .map(async (paneId) => {
        try {
          await client.runCommand(`set-option -up -t ${paneId} ${PANE_TAB_MEMBER_OPTION}`);
        } catch {}
      }),
    ...[...next.active]
      .filter((paneId) => !previous.active.has(paneId))
      .map(async (paneId) => {
        try {
          await client.runCommand(`set-option -p -t ${paneId} ${PANE_TAB_ACTIVE_OPTION} 1`);
        } catch {}
      }),
    ...[...previous.active]
      .filter((paneId) => !next.active.has(paneId))
      .map(async (paneId) => {
        try {
          await client.runCommand(`set-option -up -t ${paneId} ${PANE_TAB_ACTIVE_OPTION}`);
        } catch {}
      }),
    ...[...next.members]
      .filter((paneId) => previousIsEmpty && !next.active.has(paneId))
      .map(async (paneId) => {
        try {
          await client.runCommand(`set-option -up -t ${paneId} ${PANE_TAB_ACTIVE_OPTION}`);
        } catch {}
      }),
  ]);
}

function collectPaneTabMarkerState(groups: Map<string, PaneTabGroup>): PaneTabMarkerState {
  const members = new Set<string>();
  const active = new Set<string>();
  for (const group of groups.values()) {
    if (group.tabs.length <= 1) continue;
    for (const tab of group.tabs) members.add(tab.paneId);
    const activePaneId = group.tabs[group.activeIndex]?.paneId;
    if (activePaneId) active.add(activePaneId);
  }
  return { active, members };
}
