import type { MutableRefObject } from "react";

interface ActivePaneInfo {
  active: boolean;
  id: string;
}

interface ActivePaneSyncClient {
  getAllPaneInfo: () => Promise<ActivePaneInfo[]>;
  listPanesInWindow: (windowId: string) => Promise<ActivePaneInfo[]>;
}

interface SyncActivePaneRefOptions {
  activePaneIdRef: MutableRefObject<null | string>;
  client: ActivePaneSyncClient;
  fallbackPaneId?: null | string;
  windowId?: null | string;
}

export function resolveActivePaneId(panes: ActivePaneInfo[]): null | string {
  return panes.find((pane) => pane.active)?.id ?? null;
}

export async function syncActivePaneRef({
  activePaneIdRef,
  client,
  fallbackPaneId = null,
  windowId,
}: SyncActivePaneRefOptions): Promise<void> {
  try {
    const panes = windowId ? await client.listPanesInWindow(windowId) : await client.getAllPaneInfo();
    activePaneIdRef.current = resolveActivePaneId(panes) ?? fallbackPaneId;
  } catch {
    activePaneIdRef.current = fallbackPaneId;
  }
}
