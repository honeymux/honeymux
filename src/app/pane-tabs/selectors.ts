import type { PaneTabGroup } from "./types.ts";

export function findPaneTabGroupByPaneId(groups: Map<string, PaneTabGroup>, paneId: string): PaneTabGroup | undefined {
  return findPaneTabGroupEntryByPaneId(groups, paneId)?.[1];
}

export function findPaneTabGroupEntriesByWindowId(
  groups: Map<string, PaneTabGroup>,
  windowId: string,
): Array<[string, PaneTabGroup]> {
  const entries: Array<[string, PaneTabGroup]> = [];
  for (const [slotKey, group] of groups) {
    if (group.windowId !== windowId) continue;
    entries.push([slotKey, group]);
  }
  return entries;
}

export function findPaneTabGroupEntryByPaneId(
  groups: Map<string, PaneTabGroup>,
  paneId: string,
): [string, PaneTabGroup] | undefined {
  for (const entry of groups) {
    if (entry[1].tabs.some((tab) => tab.paneId === paneId)) return entry;
  }
  return undefined;
}

export function findPaneTabGroupForWindow(
  groups: Map<string, PaneTabGroup>,
  windowId: string,
): PaneTabGroup | undefined {
  return findPaneTabGroupEntriesByWindowId(groups, windowId)[0]?.[1];
}

export function groupOwnsHostWindowName(group: PaneTabGroup): boolean {
  return group.explicitWindowName != null || group.restoreAutomaticRename != null;
}

export function hasRefreshablePaneTabLabels(groups: Map<string, PaneTabGroup>): boolean {
  for (const group of groups.values()) {
    if (group.tabs.some((tab) => !tab.userLabel)) return true;
  }
  return false;
}

export function paneNeedsPaneTabLabelRefresh(groups: Map<string, PaneTabGroup>, paneId: string): boolean {
  for (const group of groups.values()) {
    if (group.tabs.some((tab) => tab.paneId === paneId && !tab.userLabel)) return true;
  }
  return false;
}
