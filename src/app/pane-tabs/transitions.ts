import type { PaneTab, PaneTabGroup } from "./types.ts";

export interface InsertTabPlan {
  insertIndex: number;
  updatedGroup: PaneTabGroup;
}

export interface NewTabGroupPlanInput {
  currentLabel: string;
  currentPaneId: string;
  existingGroup?: PaneTabGroup;
  explicitWindowName?: string;
  height: number;
  newLabel: string;
  newPaneId: string;
  newUserLabel?: string;
  restoreAutomaticRename?: boolean;
  slotKey: string;
  width: number;
  windowId: null | string;
}

export interface ReorderTabsPlan {
  activePaneId: string;
  updatedGroup: PaneTabGroup;
}

export interface TabRemovalPlan {
  nextActiveIndex: number;
  nextActivePaneId: null | string;
  nextMode: "empty" | "multi" | "single";
  remainingTabs: PaneTab[];
  removedIndex: number;
  removedTab: PaneTab;
  removedWasActive: boolean;
  updatedGroup: PaneTabGroup | null;
}

export interface TabSwitchPlan {
  currentPaneId: string;
  targetPaneId: string;
  updatedGroup: PaneTabGroup;
}

export function planGroupTabRemoval(
  group: PaneTabGroup,
  tabIndex: number,
  options: {
    preferredWindowId?: null | string;
    treatRemovedAsActive?: boolean;
  } = {},
): TabRemovalPlan | null {
  if (tabIndex < 0 || tabIndex >= group.tabs.length) return null;

  const removedTab = group.tabs[tabIndex]!;
  const remainingTabs = group.tabs.filter((_, index) => index !== tabIndex);
  const removedWasActive = options.treatRemovedAsActive ?? tabIndex === group.activeIndex;

  if (remainingTabs.length === 0) {
    return {
      nextActiveIndex: -1,
      nextActivePaneId: null,
      nextMode: "empty",
      remainingTabs,
      removedIndex: tabIndex,
      removedTab,
      removedWasActive,
      updatedGroup: null,
    };
  }

  let nextActiveIndex: number;
  if (removedWasActive) {
    nextActiveIndex = tabIndex < remainingTabs.length ? tabIndex : remainingTabs.length - 1;
  } else if (tabIndex < group.activeIndex) {
    nextActiveIndex = group.activeIndex - 1;
  } else {
    nextActiveIndex = group.activeIndex;
  }

  const nextActivePaneId = remainingTabs[nextActiveIndex]!.paneId;
  const updatedGroup: PaneTabGroup = {
    ...group,
    activeIndex: remainingTabs.length === 1 ? 0 : nextActiveIndex,
    tabs: remainingTabs,
    windowId: options.preferredWindowId ?? group.windowId,
  };

  return {
    nextActiveIndex,
    nextActivePaneId,
    nextMode: remainingTabs.length === 1 ? "single" : "multi",
    remainingTabs,
    removedIndex: tabIndex,
    removedTab,
    removedWasActive,
    updatedGroup,
  };
}

export function planInsertTab(group: PaneTabGroup, tab: PaneTab, toInsertIndex: number): InsertTabPlan {
  const newTabs = [...group.tabs];
  const insertIndex = Math.max(0, Math.min(toInsertIndex, newTabs.length));
  newTabs.splice(insertIndex, 0, tab);

  return {
    insertIndex,
    updatedGroup: {
      ...group,
      activeIndex: insertIndex,
      tabs: newTabs,
    },
  };
}

export function planNewTabGroup(input: NewTabGroupPlanInput): PaneTabGroup | null {
  const {
    currentLabel,
    currentPaneId,
    existingGroup,
    explicitWindowName,
    height,
    newLabel,
    newPaneId,
    newUserLabel,
    restoreAutomaticRename,
    slotKey,
    width,
    windowId,
  } = input;

  const newTab: PaneTab = newUserLabel
    ? { label: newLabel, paneId: newPaneId, userLabel: newUserLabel }
    : { label: newLabel, paneId: newPaneId };

  if (existingGroup) {
    return {
      ...existingGroup,
      activeIndex: existingGroup.tabs.length,
      explicitWindowName: existingGroup.explicitWindowName ?? explicitWindowName,
      restoreAutomaticRename: existingGroup.restoreAutomaticRename ?? restoreAutomaticRename,
      tabs: [...existingGroup.tabs, newTab],
      windowId: windowId ?? existingGroup.windowId,
    };
  }

  if (!windowId) return null;
  return {
    activeIndex: 1,
    explicitWindowName,
    restoreAutomaticRename,
    slotHeight: height,
    slotKey,
    slotWidth: width,
    tabs: [{ label: currentLabel, paneId: currentPaneId }, newTab],
    windowId,
  };
}

export function planReorderTabs(group: PaneTabGroup, fromIndex: number, toIndex: number): ReorderTabsPlan | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || fromIndex >= group.tabs.length) return null;
  if (toIndex < 0 || toIndex >= group.tabs.length) return null;

  const newTabs = [...group.tabs];
  const [moved] = newTabs.splice(fromIndex, 1);
  newTabs.splice(toIndex, 0, moved!);

  let newActiveIndex = group.activeIndex;
  if (group.activeIndex === fromIndex) {
    newActiveIndex = toIndex;
  } else if (fromIndex < group.activeIndex && toIndex >= group.activeIndex) {
    newActiveIndex--;
  } else if (fromIndex > group.activeIndex && toIndex <= group.activeIndex) {
    newActiveIndex++;
  }

  return {
    activePaneId: newTabs[newActiveIndex]!.paneId,
    updatedGroup: {
      ...group,
      activeIndex: newActiveIndex,
      tabs: newTabs,
    },
  };
}

export function planSwitchTab(group: PaneTabGroup, tabIndex: number, nextWindowId: string): TabSwitchPlan | null {
  if (tabIndex < 0 || tabIndex >= group.tabs.length) return null;
  if (tabIndex === group.activeIndex) return null;

  return {
    currentPaneId: group.tabs[group.activeIndex]!.paneId,
    targetPaneId: group.tabs[tabIndex]!.paneId,
    updatedGroup: {
      ...group,
      activeIndex: tabIndex,
      windowId: nextWindowId,
    },
  };
}
