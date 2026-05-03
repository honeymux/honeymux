/**
 * Harness-only helper for bulk-renaming every pane-tab to `${prefix}${i+1}`
 * inside a target tmux window. Consumed by the pane-tabs docs screenshot so
 * the script can focus on creating the right number of tabs via keystrokes
 * and leave labeling to the app.
 *
 * The returned ref points at an async function that polls until the per-group
 * tab count in the active window is stable (and each group has at least
 * `minTabsPerGroup` tabs) before emitting renames. This lets the harness
 * script trigger the rename immediately after startup and rely on the polling
 * loop to absorb the ~10s of subsequent async tab creation.
 *
 * In production (HMX_HARNESS unset) the ref is assigned on every render but
 * never invoked, so the cost is just the closure allocation.
 */
import type { MutableRefObject } from "react";

import { useRef } from "react";

import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";

type RenameAllPaneTabsFn = (prefix: string, minTabsPerGroup: number) => Promise<void>;

type RenameAllPaneTabsRef = MutableRefObject<RenameAllPaneTabsFn | null>;

interface UseHarnessRenamePaneTabsRefOptions {
  activeWindowIdRef: MutableRefObject<null | string>;
  paneTabsApi: PaneTabsApi;
}

/** Poll interval while waiting for the per-group tab count to stabilize. */
const POLL_INTERVAL_MS = 250;
/** Number of consecutive matching snapshots required to declare stability. */
const STABILITY_SAMPLES = 4;
/** Absolute ceiling on the polling wait before renames fire anyway. */
const WAIT_DEADLINE_MS = 30_000;

export function useHarnessRenamePaneTabsRef({
  activeWindowIdRef,
  paneTabsApi,
}: UseHarnessRenamePaneTabsRefOptions): RenameAllPaneTabsRef {
  // Mirror the latest paneTabsApi into a ref so the long-running async
  // callback below reads fresh groups on every poll, independent of the
  // render that created it.
  const paneTabsApiRef = useRef(paneTabsApi);
  paneTabsApiRef.current = paneTabsApi;

  const renameAllPaneTabsRef = useRef<RenameAllPaneTabsFn | null>(null);
  renameAllPaneTabsRef.current = async (prefix, minTabsPerGroup) => {
    const deadline = Date.now() + WAIT_DEADLINE_MS;
    let lastSnapshot = "";
    let stableCount = 0;
    while (Date.now() < deadline) {
      const values = scopedGroupValues(paneTabsApiRef.current, activeWindowIdRef.current);
      const allAboveMin = values.length > 0 && values.every((g) => g.tabs.length >= minTabsPerGroup);
      const snapshot = values
        .map((g) => g.tabs.length)
        .sort()
        .join(",");
      if (allAboveMin && snapshot === lastSnapshot) {
        stableCount++;
        if (stableCount >= STABILITY_SAMPLES) break;
      } else {
        stableCount = 0;
        lastSnapshot = snapshot;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    for (const [slotKey, group] of scopedGroupEntries(paneTabsApiRef.current, activeWindowIdRef.current)) {
      for (let i = 0; i < group.tabs.length; i++) {
        await paneTabsApiRef.current.handleRenamePaneTab(slotKey, i, `${prefix}${i + 1}`);
      }
    }
  };

  return renameAllPaneTabsRef;
}

/**
 * Filter pane-tab groups down to the active window so bootstrapped panes in
 * other tmux windows (e.g. logs, notes) don't keep the stability check from
 * ever succeeding.
 */
function scopedGroupEntries(paneTabsApi: PaneTabsApi, activeWindowId: null | string) {
  return [...paneTabsApi.paneTabGroups.entries()].filter(
    ([, group]) => activeWindowId === null || group.windowId === activeWindowId,
  );
}

function scopedGroupValues(paneTabsApi: PaneTabsApi, activeWindowId: null | string) {
  return scopedGroupEntries(paneTabsApi, activeWindowId).map(([, g]) => g);
}
