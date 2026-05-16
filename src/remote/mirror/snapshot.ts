import { quoteTmuxArg } from "../../tmux/escape.ts";

/**
 * Minimal command-sender shape used by snapshot capture. Both
 * `TmuxControlClient.runCommand` and `RemoteControlClient.sendCommand`
 * satisfy this; passing the callable directly avoids coupling snapshot
 * code to either concrete class.
 */
export type RunTmuxCommand = (cmd: string) => Promise<string>;

/**
 * Persistent tmux user-options used to pair local panes/windows with their
 * remote mirror counterparts. These are the single source of mirror truth;
 * in-memory caches are derived views.
 */
export const LOCAL_PANE_ID_TAG = "@hmx-local-pane-id";
export const LOCAL_WINDOW_ID_TAG = "@hmx-local-window-id";
export const REMOTE_HOST_TAG = "@hmx-remote-host";
export const REMOTE_PANE_TAG = "@hmx-remote-pane";

/**
 * Immutable snapshot of one side's mirror-relevant tmux state.
 *
 * The reconciler consumes a pair of these (one local, one remote) plus the
 * pending overlay and produces a `MirrorPlan`. Snapshots are read-only by
 * convention — the reconciler MUST NOT mutate them. Callers building a
 * snapshot by hand (e.g. fixture-driven tests) should freeze the maps.
 */
export interface MirrorSnapshot {
  readonly panesByWindow: ReadonlyMap<string, ReadonlyArray<SnapshotPane>>;
  readonly windows: ReadonlyArray<SnapshotWindow>;
}

export interface SnapshotPane {
  readonly id: string;
  readonly index: number;
  readonly tags: SnapshotPaneTags;
  readonly windowId: string;
}

export interface SnapshotPaneTags {
  /** @hmx-local-pane-id — set on REMOTE panes to point at their paired local pane. */
  readonly localPaneId?: string;
  /** @hmx-remote-host — set on LOCAL panes whose owner is converted to a remote server. */
  readonly remoteHost?: string;
  /** @hmx-remote-pane — set on LOCAL panes to point at their paired remote pane. */
  readonly remotePaneId?: string;
}

export interface SnapshotWindow {
  readonly id: string;
  readonly index: number;
  readonly layout: string;
  /** @hmx-local-window-id — set on REMOTE windows to point at their paired local window. */
  readonly localWindowId?: string;
}

/**
 * Query the local tmux for its windows and panes, capturing the `@hmx-*`
 * tags relevant to mirror reconciliation.
 *
 * Pure-function callers (tests) construct `MirrorSnapshot` objects directly
 * by hand; this helper is for the executor's runtime path.
 */
export async function captureLocalMirrorSnapshot(run: RunTmuxCommand): Promise<MirrorSnapshot> {
  const windows = await queryLocalWindows(run);
  const panesByWindow = new Map<string, ReadonlyArray<SnapshotPane>>();
  for (const window of windows) {
    panesByWindow.set(window.id, await queryLocalPanes(run, window.id));
  }
  return { panesByWindow, windows };
}

/**
 * Query a remote tmux mirror session for its windows and panes, capturing
 * the `@hmx-*` tags relevant to mirror reconciliation. The `client` here is
 * the SSH-tunneled `TmuxControlClient` attached to the remote mirror.
 */
export async function captureRemoteMirrorSnapshot(run: RunTmuxCommand): Promise<MirrorSnapshot> {
  const windows = await queryRemoteWindows(run);
  const panesByWindow = new Map<string, ReadonlyArray<SnapshotPane>>();
  for (const window of windows) {
    panesByWindow.set(window.id, await queryRemotePanes(run, window.id));
  }
  return { panesByWindow, windows };
}

function parsePaneListOutput(output: string, windowId: string, side: "local" | "remote"): ReadonlyArray<SnapshotPane> {
  const panes: SnapshotPane[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const id = parts[0];
    const indexStr = parts[1];
    if (!id || indexStr === undefined) continue;
    const index = parseInt(indexStr, 10);
    if (!Number.isFinite(index)) continue;
    const tags: SnapshotPaneTags =
      side === "local"
        ? {
            remoteHost: parts[2] || undefined,
            remotePaneId: parts[3] || undefined,
          }
        : {
            localPaneId: parts[2] || undefined,
          };
    panes.push({ id, index, tags, windowId });
  }
  return panes;
}

function parseWindowListOutput(output: string, hasLocalWindowIdTag: boolean): ReadonlyArray<SnapshotWindow> {
  const windows: SnapshotWindow[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const id = parts[0];
    const indexStr = parts[1];
    const layout = parts[2] ?? "";
    if (!id || indexStr === undefined) continue;
    const index = parseInt(indexStr, 10);
    if (!Number.isFinite(index)) continue;
    const localWindowId = hasLocalWindowIdTag ? parts[3] || undefined : undefined;
    windows.push({ id, index, layout, localWindowId });
  }
  return windows;
}

async function queryLocalPanes(run: RunTmuxCommand, windowId: string): Promise<ReadonlyArray<SnapshotPane>> {
  const fmt = `#{pane_id}\t#{pane_index}\t#{${REMOTE_HOST_TAG}}\t#{${REMOTE_PANE_TAG}}`;
  const output = await run(`list-panes -t ${quoteTmuxArg("windowId", windowId)} -F ${quoteTmuxArg("format", fmt)}`);
  return parsePaneListOutput(output, windowId, "local");
}

async function queryLocalWindows(run: RunTmuxCommand): Promise<ReadonlyArray<SnapshotWindow>> {
  // No localWindowId tag on local windows — those live on the remote side
  // pointing back to local.
  const fmt = "#{window_id}\t#{window_index}\t#{window_layout}";
  const output = await run(`list-windows -a -F ${quoteTmuxArg("format", fmt)}`);
  return parseWindowListOutput(output, /* hasLocalWindowIdTag */ false);
}

async function queryRemotePanes(run: RunTmuxCommand, windowId: string): Promise<ReadonlyArray<SnapshotPane>> {
  const fmt = `#{pane_id}\t#{pane_index}\t#{${LOCAL_PANE_ID_TAG}}`;
  const output = await run(`list-panes -t ${quoteTmuxArg("windowId", windowId)} -F ${quoteTmuxArg("format", fmt)}`);
  return parsePaneListOutput(output, windowId, "remote");
}

async function queryRemoteWindows(run: RunTmuxCommand): Promise<ReadonlyArray<SnapshotWindow>> {
  const fmt = `#{window_id}\t#{window_index}\t#{window_layout}\t#{${LOCAL_WINDOW_ID_TAG}}`;
  const output = await run(`list-windows -F ${quoteTmuxArg("format", fmt)}`);
  return parseWindowListOutput(output, /* hasLocalWindowIdTag */ true);
}
