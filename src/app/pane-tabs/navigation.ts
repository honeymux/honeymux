import type { PaneTabGroup } from "./types.ts";

export interface PaneCycleEntry {
  paneId: string;
  slotKey?: string;
  tabIndex?: number;
}

export interface PaneCycleModel {
  currentIndex: number;
  entries: PaneCycleEntry[];
}

interface BuildPaneCycleModelOptions {
  activePaneIndex: number;
  enabled: boolean;
  groups: Map<string, PaneTabGroup>;
  panes: Array<{ id: string }>;
}

export function buildPaneCycleModel({
  activePaneIndex,
  enabled,
  groups,
  panes,
}: BuildPaneCycleModelOptions): PaneCycleModel {
  const entries: PaneCycleEntry[] = [];
  let currentIndex = -1;

  const groupEntriesByPaneId = enabled ? indexPaneTabGroupsByPaneId(groups) : new Map<string, [string, PaneTabGroup]>();

  for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
    const pane = panes[paneIndex]!;
    const groupEntry = groupEntriesByPaneId.get(pane.id);
    const slotKey = groupEntry?.[0];
    const group = groupEntry?.[1];

    if (group && slotKey && group.tabs.length > 1) {
      for (let tabIndex = 0; tabIndex < group.tabs.length; tabIndex++) {
        if (paneIndex === activePaneIndex && tabIndex === group.activeIndex) {
          currentIndex = entries.length;
        }
        entries.push({ paneId: group.tabs[tabIndex]!.paneId, slotKey, tabIndex });
      }
      continue;
    }

    if (paneIndex === activePaneIndex) currentIndex = entries.length;
    entries.push({ paneId: pane.id });
  }

  return { currentIndex, entries };
}

function indexPaneTabGroupsByPaneId(groups: Map<string, PaneTabGroup>): Map<string, [string, PaneTabGroup]> {
  const groupEntriesByPaneId = new Map<string, [string, PaneTabGroup]>();
  for (const [slotKey, group] of groups) {
    for (const tab of group.tabs) {
      groupEntriesByPaneId.set(tab.paneId, [slotKey, group]);
    }
  }
  return groupEntriesByPaneId;
}
