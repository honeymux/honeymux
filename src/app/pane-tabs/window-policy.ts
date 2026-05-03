import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabGroup } from "./types.ts";

import { parsePaneWindowIdMap, parseWindowNameMap } from "./queries.ts";
import { findPaneTabGroupEntriesByWindowId, groupOwnsHostWindowName } from "./selectors.ts";

interface WindowRenameState {
  explicitWindowName?: string;
  restoreAutomaticRename: boolean;
}

export async function applyAutomaticRenameModeForPane(
  client: TmuxControlClient,
  paneId: string,
  restoreAutomaticRename: boolean | undefined,
): Promise<void> {
  if (restoreAutomaticRename == null) return;
  try {
    await client.runCommand(`set-option -w -t ${paneId} automatic-rename ${restoreAutomaticRename ? "on" : "off"}`);
  } catch {}
}

export async function hydrateAutomaticRenameModes(
  client: TmuxControlClient,
  groups: Map<string, PaneTabGroup>,
): Promise<Map<string, PaneTabGroup>> {
  const nextGroups = new Map(groups);
  await Promise.all(
    [...nextGroups.entries()].map(async ([slotKey, group]) => {
      if (group.restoreAutomaticRename != null || group.tabs.length <= 1) return;
      nextGroups.set(slotKey, {
        ...group,
        restoreAutomaticRename: await resolveAutomaticRenameMode(client, group.windowId),
      });
    }),
  );
  return nextGroups;
}

export async function listPaneWindowIdMap(client: TmuxControlClient): Promise<Map<string, string> | null> {
  try {
    const output = await client.runCommand("list-panes -a -F ' #{pane_id} #{window_id}'");
    return parsePaneWindowIdMap(output);
  } catch {
    return null;
  }
}

export async function listWindowNameMap(client: TmuxControlClient): Promise<Map<string, string> | null> {
  try {
    const output = await client.runCommand("list-windows -F '#{window_id} #{window_name}'");
    return parseWindowNameMap(output);
  } catch {
    return null;
  }
}

export async function normalizeHiddenTabWindows(
  client: TmuxControlClient,
  groups: Map<string, PaneTabGroup>,
): Promise<void> {
  const paneWindowIds = await listPaneWindowIdMap(client);
  if (!paneWindowIds) return;

  const visibleWindowIds = new Set([...groups.values()].map((group) => group.windowId));
  const hiddenWindowIds = new Set<string>();

  for (const group of groups.values()) {
    for (let index = 0; index < group.tabs.length; index++) {
      if (index === group.activeIndex) continue;
      const windowId = paneWindowIds.get(group.tabs[index]!.paneId);
      if (!windowId || visibleWindowIds.has(windowId)) continue;
      hiddenWindowIds.add(windowId);
    }
  }

  await Promise.all(
    [...hiddenWindowIds].map(async (windowId) => {
      try {
        await client.renameWindow(windowId, "_hmx_tab");
      } catch {}
      try {
        await client.disableAutomaticRename(windowId);
      } catch {}
      try {
        await client.runCommand(`set-option -w -t ${windowId} window-status-format ''`);
      } catch {}
    }),
  );
}

export async function resolveHostWindowRenameState(
  client: TmuxControlClient,
  groups: Map<string, PaneTabGroup>,
  windowId: string,
  excludeSlotKey?: string,
): Promise<WindowRenameState> {
  const inherited = findManagedWindowRenameState(groups, windowId, excludeSlotKey);
  if (inherited) return inherited;

  const restoreAutomaticRename = await resolveAutomaticRenameMode(client, windowId);
  return {
    explicitWindowName: await resolveInitialExplicitWindowName(client, restoreAutomaticRename, windowId),
    restoreAutomaticRename,
  };
}

export async function syncManagedWindowNamesForGroups(
  client: TmuxControlClient,
  groups: Map<string, PaneTabGroup>,
): Promise<void> {
  const managedByWindow = new Map<string, PaneTabGroup[]>();
  for (const group of groups.values()) {
    if (!groupOwnsHostWindowName(group)) continue;
    const windowGroups = managedByWindow.get(group.windowId) ?? [];
    windowGroups.push(group);
    managedByWindow.set(group.windowId, windowGroups);
  }

  await Promise.all(
    [...managedByWindow.entries()].map(async ([, windowGroups]) => {
      if (windowGroups.length !== 1) return;
      await syncManagedWindowName(client, windowGroups[0]!);
    }),
  );
}

function findManagedWindowRenameState(
  groups: Map<string, PaneTabGroup>,
  windowId: string,
  excludeSlotKey?: string,
): WindowRenameState | null {
  for (const [slotKey, group] of findPaneTabGroupEntriesByWindowId(groups, windowId)) {
    if (slotKey === excludeSlotKey) continue;
    if (!groupOwnsHostWindowName(group)) continue;
    return {
      explicitWindowName: group.explicitWindowName,
      restoreAutomaticRename: group.restoreAutomaticRename ?? false,
    };
  }
  return null;
}

async function resolveAutomaticRenameMode(client: TmuxControlClient, windowId: null | string): Promise<boolean> {
  if (!windowId) return false;
  try {
    return await client.getAutomaticRename(windowId);
  } catch {
    // Fail safe: keep custom names sticky if tmux option lookup fails.
    return false;
  }
}

async function resolveInitialExplicitWindowName(
  client: TmuxControlClient,
  restoreAutomaticRename: boolean,
  windowId: string,
): Promise<string | undefined> {
  if (restoreAutomaticRename) return undefined;
  const windowNames = await listWindowNameMap(client);
  return windowNames?.get(windowId);
}

async function syncManagedWindowName(
  client: TmuxControlClient,
  group: PaneTabGroup,
  windowId: string = group.windowId,
): Promise<void> {
  if (!groupOwnsHostWindowName(group)) return;
  const activeTab = group.tabs[group.activeIndex];
  if (!activeTab) return;

  const nextWindowName = group.explicitWindowName ?? activeTab.label;
  try {
    await client.renameWindow(windowId, nextWindowName);
  } catch {}
  try {
    await client.disableAutomaticRename(windowId);
  } catch {}
}
