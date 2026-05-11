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
  setActivePaneId: (paneId: null | string) => void;
  windowId?: null | string;
}

export function resolveActivePaneId(panes: ActivePaneInfo[]): null | string {
  return panes.find((pane) => pane.active)?.id ?? null;
}

export async function syncActivePaneRef({
  activePaneIdRef,
  client,
  fallbackPaneId = null,
  setActivePaneId,
  windowId,
}: SyncActivePaneRefOptions): Promise<void> {
  const startingPaneId = activePaneIdRef.current;
  try {
    const panes = windowId ? await client.listPanesInWindow(windowId) : await client.getAllPaneInfo();
    const nextPaneId = resolveActivePaneId(panes) ?? fallbackPaneId;
    if (activePaneIdRef.current === startingPaneId) {
      setActivePaneId(nextPaneId);
    }
  } catch {
    if (activePaneIdRef.current === startingPaneId) {
      setActivePaneId(fallbackPaneId);
    }
  }
}
