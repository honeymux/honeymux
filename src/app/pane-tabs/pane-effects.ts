import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTab, PaneTabGroup } from "./types.ts";

import { borderMaxWidth, buildBorderFormat } from "./layout.ts";

export async function clearPaneBorderFormat(client: TmuxControlClient, paneId: string): Promise<void> {
  try {
    await client.runCommand(`set-option -up -t ${paneId} pane-border-format`);
  } catch {}
}

export async function clearSiblingPaneFormats(
  client: TmuxControlClient,
  windowId: string,
  visiblePaneIds: Set<string>,
): Promise<void> {
  const panes = await client.listPanesInWindow(windowId);
  await Promise.all(
    panes
      .filter((pane) => !visiblePaneIds.has(pane.id))
      .map((pane) => client.runCommand(`set-option -up -t ${pane.id} pane-border-format`).catch(() => {})),
  );
}

export function collectVisibleTabbedPaneIds(groups: Map<string, PaneTabGroup>): Set<string> {
  const paneIds = new Set<string>();
  for (const group of groups.values()) {
    paneIds.add(group.tabs[group.activeIndex]!.paneId);
  }
  return paneIds;
}

export async function disableRemainOnExit(client: TmuxControlClient, paneId: string): Promise<void> {
  try {
    await client.runCommand(`set-option -p -t ${paneId} remain-on-exit off`);
  } catch {}
}

export async function enableRemainOnExit(client: TmuxControlClient, paneId: string): Promise<void> {
  try {
    await client.runCommand(`set-option -p -t ${paneId} remain-on-exit on`);
    await client.runCommand(`set-option -p -t ${paneId} remain-on-exit-format ' '`);
  } catch {}
}

export async function installExitHook(
  client: TmuxControlClient,
  group: PaneTabGroup,
  borderLines: string,
): Promise<void> {
  if (group.tabs.length <= 1) return;

  const activePaneId = group.tabs[group.activeIndex]!.paneId;
  await setPaneFormatForTabs(client, activePaneId, group.tabs, group.activeIndex, group.slotWidth, borderLines);
  await enableRemainOnExit(client, activePaneId);
  await Promise.all(group.tabs.map((tab) => uninstallExitHook(client, tab.paneId)));
}

export async function setPaneFormatForTabs(
  client: TmuxControlClient,
  paneId: string,
  tabs: PaneTab[],
  activeIndex: number,
  slotWidth: number,
  borderLines: string,
): Promise<void> {
  try {
    await client.setPaneBorderFormat(
      paneId,
      buildBorderFormat(tabs, activeIndex, borderLines, borderMaxWidth(slotWidth)),
    );
  } catch {}
}

export async function uninstallExitHook(client: TmuxControlClient, paneId: string): Promise<void> {
  try {
    await client.runCommand(`set-hook -up -t ${paneId} pane-died`);
  } catch {}
}
