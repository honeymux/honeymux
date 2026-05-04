import type { TmuxControlClient } from "../tmux/control-client.ts";
import type { RemoteControlClient } from "./remote-control-client.ts";

import { quoteTmuxArg } from "../tmux/escape.ts";

const LOCAL_WINDOW_ID_OPTION = "@hmx-local-window-id";

interface MirrorWindow {
  id: string;
  index: number;
  layout: string;
  localWindowId?: string;
}

/**
 * Keeps a remote tmux mirror session in sync with the local layout.
 *
 * The mirror has the same window/pane structure as the local session,
 * ensuring remote panes always have correct dimensions. On layout changes,
 * pane counts are adjusted and the layout string is replicated.
 */
export class MirrorLayoutManager {
  /** Last remote client size we set, to avoid redundant refresh-client calls. */
  private lastClientSize = "";
  /** localPaneId → remotePaneId (positional correspondence within each window) */
  private paneMap = new Map<string, string>();
  /** localWindowId → remoteWindowId */
  private windowMap = new Map<string, string>();

  constructor(
    private localClient: TmuxControlClient,
    private remoteClient: RemoteControlClient,
  ) {}

  /**
   * Full sync: query local layout and ensure the remote mirror matches.
   * Called on initial connection and after reconnection.
   */
  async fullSync(): Promise<void> {
    const localWindows = await this.queryWindows(this.localClient);
    const remoteWindows = await this.queryRemoteWindows();

    const localWindowIds = new Set(localWindows.map((window) => window.id));
    const remoteWindowsByLocalId = new Map<string, MirrorWindow>();
    const unassignedRemoteWindows: MirrorWindow[] = [];

    // Prefer explicit remote window metadata so mirror window identity stays
    // stable across detached session creation, session switches, and reconnects.
    for (const remoteWindow of remoteWindows) {
      const localWindowId = remoteWindow.localWindowId;
      if (localWindowId && localWindowIds.has(localWindowId) && !remoteWindowsByLocalId.has(localWindowId)) {
        remoteWindowsByLocalId.set(localWindowId, remoteWindow);
        continue;
      }
      unassignedRemoteWindows.push(remoteWindow);
    }

    this.windowMap.clear();
    this.paneMap.clear();

    for (const localWindow of localWindows) {
      let remoteWindow = remoteWindowsByLocalId.get(localWindow.id) ?? unassignedRemoteWindows.shift();
      if (!remoteWindow) {
        remoteWindow = await this.createRemoteWindow(localWindow.id);
      } else if (remoteWindow.localWindowId !== localWindow.id) {
        await this.setRemoteWindowLocalId(remoteWindow.id, localWindow.id).catch(() => {});
      }
      if (!remoteWindow) continue;

      this.windowMap.set(localWindow.id, remoteWindow.id);

      await this.syncWindowPanes(localWindow.id, remoteWindow.id, localWindow.layout);
    }

    // Any remote window left unassigned no longer corresponds to a local
    // window and can be dropped from the mirror session.
    for (const remoteWindow of unassignedRemoteWindows) {
      await this.remoteClient.sendCommand(`kill-window -t ${remoteWindow.id}`).catch(() => {});
    }
  }

  /** Get the remote pane ID for a local pane. */
  getRemotePaneId(localPaneId: string): string | undefined {
    return this.paneMap.get(localPaneId);
  }

  /** Callback to check if a remote pane is actively in use (has a local proxy). */
  isRemotePaneActive: (remotePaneId: string) => boolean = () => false;

  /**
   * Incremental sync on local %layout-change.
   * Adjusts pane count and applies the new layout to the remote window.
   */
  async onLayoutChange(localWindowId: string, layoutStr: string): Promise<void> {
    const remoteWindowId = this.windowMap.get(localWindowId);
    if (!remoteWindowId) return;

    await this.syncWindowPanes(localWindowId, remoteWindowId, layoutStr);
  }

  /**
   * Handle local window-add: create a matching window on the remote.
   *
   * Idempotent: tmux re-emits `%window-add` for every existing window when a
   * new session joins their session group (e.g. the agent zoom overlay
   * created via `new-session -d -t <target>`). Without this guard, those
   * spurious adds would create duplicate empty mirror windows, overwrite
   * `windowMap`, and corrupt `paneMap` to point at placeholder remote panes,
   * which `fullSync` would later kill — taking the real proxy panes with
   * them. Reconciliation of any genuine drift is handled by `fullSync`.
   */
  async onWindowAdd(localWindowId: string): Promise<void> {
    if (this.windowMap.has(localWindowId)) return;
    try {
      const remoteWindow = await this.createRemoteWindow(localWindowId);
      if (remoteWindow) {
        this.windowMap.set(localWindowId, remoteWindow.id);
        // Sync panes so the pane map is populated for the new window
        await this.syncWindowPanes(localWindowId, remoteWindow.id, "");
      }
    } catch {
      // Remote may be disconnected
    }
  }

  /**
   * Handle local window-close: kill the matching remote window.
   *
   * tmux emits `%window-close` whenever a winlink is removed, not only when
   * the window is destroyed. When a session group member is killed (e.g. the
   * agent zoom overlay created via `new-session -d -t <target>`), all of its
   * winlinks are removed and the notifications fan to our control client
   * even though the windows still exist in the user's main session. Verify
   * the local window is actually gone before tearing down the mirror.
   */
  async onWindowClose(localWindowId: string): Promise<void> {
    const remoteWindowId = this.windowMap.get(localWindowId);
    if (!remoteWindowId) return;

    if (await this.localWindowExists(localWindowId)) return;

    try {
      await this.remoteClient.sendCommand(`kill-window -t ${remoteWindowId}`);
    } catch {
      // Window may already be gone
    }
    this.windowMap.delete(localWindowId);

    // We can't easily tell which panes belonged to this window,
    // so rebuild pane map on next fullSync or layout change.
  }

  // --- Private helpers ---

  private async createRemoteWindow(localWindowId: string): Promise<MirrorWindow | undefined> {
    try {
      const output = await this.remoteClient.sendCommand("new-window -d -P -F '#{window_id}'");
      const remoteWindowId = output.trim();
      if (!remoteWindowId) return undefined;
      await this.setRemoteWindowLocalId(remoteWindowId, localWindowId);
      return {
        id: remoteWindowId,
        index: Number.MAX_SAFE_INTEGER,
        layout: "",
        localWindowId,
      };
    } catch {
      return undefined;
    }
  }

  private async localWindowExists(localWindowId: string): Promise<boolean> {
    try {
      const output = await (this.localClient as any).sendCommand(
        `display-message -p -t ${quoteTmuxArg("local window id", localWindowId)} '#{window_id}'`,
      );
      return output.trim() === localWindowId;
    } catch {
      return false;
    }
  }

  private parseMirrorWindows(output: string): MirrorWindow[] {
    const windows: MirrorWindow[] = [];
    for (const line of output.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      const id = parts[0];
      const index = Number.parseInt(parts[1] ?? "", 10);
      if (!id || !Number.isFinite(index)) continue;
      windows.push({
        id,
        index,
        layout: parts[2] ?? "",
        localWindowId: parts[3] || undefined,
      });
    }
    return windows;
  }

  private async queryPanesInWindow(
    client: TmuxControlClient,
    windowId: string,
  ): Promise<Array<{ id: string; index: number }>> {
    const output = await (client as any).sendCommand(`list-panes -t ${windowId} -F ' #{pane_id} #{pane_index}'`);
    return output
      .split("\n")
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => {
        const parts = line.split(" ");
        return { id: parts[0]!, index: parseInt(parts[1]!, 10) };
      });
  }

  private async queryRemotePanesInWindow(windowId: string): Promise<Array<{ id: string; index: number }>> {
    try {
      const output = await this.remoteClient.sendCommand(`list-panes -t ${windowId} -F ' #{pane_id} #{pane_index}'`);
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(" ");
          return { id: parts[0]!, index: parseInt(parts[1]!, 10) };
        });
    } catch {
      return [];
    }
  }

  private async queryRemoteWindows(): Promise<MirrorWindow[]> {
    try {
      const output = await this.remoteClient.sendCommand(
        `list-windows -F '#{window_id}\t#{window_index}\t#{window_layout}\t#{${LOCAL_WINDOW_ID_OPTION}}'`,
      );
      return this.parseMirrorWindows(output).sort(compareMirrorWindows);
    } catch {
      return [];
    }
  }

  private async queryWindows(client: TmuxControlClient): Promise<MirrorWindow[]> {
    const output = await (client as any).sendCommand(
      "list-windows -a -F '#{window_id}\t#{window_index}\t#{window_layout}'",
    );
    const windowsById = new Map<string, MirrorWindow>();
    for (const window of this.parseMirrorWindows(output)) {
      if (!windowsById.has(window.id)) {
        windowsById.set(window.id, window);
      }
    }
    return [...windowsById.values()].sort(compareMirrorWindows);
  }

  private setRemoteWindowLocalId(remoteWindowId: string, localWindowId: string): Promise<string> {
    return this.remoteClient.sendCommand(
      `set-option -w -t ${quoteTmuxArg("window id", remoteWindowId)} ${LOCAL_WINDOW_ID_OPTION} ${quoteTmuxArg("local window id", localWindowId)}`,
    );
  }

  /**
   * Parse the window dimensions from a tmux layout string (format: "checksum,WxH,...")
   * and resize the remote control client to match, so that select-layout applies
   * pane dimensions correctly instead of scaling to the old 300x300 default.
   */
  private async syncClientSize(layoutStr: string): Promise<void> {
    if (!layoutStr) return;
    // Layout format: "checksum,WxH,xoff,yoff[,paneId|{...}]"
    const match = layoutStr.match(/^[^,]*,(\d+)x(\d+),/);
    if (!match) return;
    const size = `${match[1]},${match[2]}`;
    if (size === this.lastClientSize) return;
    this.lastClientSize = size;
    await this.remoteClient.sendCommand(`refresh-client -C ${size}`).catch(() => {});
  }

  /**
   * Sync a single window's pane count and layout between local and remote.
   */
  private async syncWindowPanes(localWindowId: string, remoteWindowId: string, layoutStr: string): Promise<void> {
    // Count panes in each
    const localPanes = await this.queryPanesInWindow(this.localClient, localWindowId);
    const remotePanes = await this.queryRemotePanesInWindow(remoteWindowId);

    const diff = localPanes.length - remotePanes.length;

    if (diff > 0) {
      // Need more panes on remote — split the last pane repeatedly
      for (let i = 0; i < diff; i++) {
        await this.remoteClient.sendCommand(`split-window -t ${remoteWindowId} -d`).catch(() => {});
      }
    } else if (diff < 0) {
      // Too many panes on remote — kill any remote pane that isn't mapped to
      // a current local pane. Positional slicing is unsafe: tmux's
      // `split-window` inserts the new pane adjacent to the split source,
      // which can push existing panes (including the active mirror) to a
      // later index. Slicing the trailing N panes can therefore pick the
      // active mirror and skip the real orphan.
      const liveRemoteIds = new Set<string>();
      for (const localPane of localPanes) {
        const remoteId = this.paneMap.get(localPane.id);
        if (remoteId) liveRemoteIds.add(remoteId);
      }
      for (const pane of remotePanes) {
        if (liveRemoteIds.has(pane.id)) continue;
        // Defense in depth: never kill an active converted pane, even if its
        // mapping is somehow missing from paneMap.
        if (this.isRemotePaneActive(pane.id)) continue;
        await this.remoteClient.sendCommand(`kill-pane -t ${pane.id}`).catch(() => {});
      }
    }

    // Sync remote client size to match the local window dimensions encoded
    // in the layout string, so select-layout produces matching pane sizes.
    await this.syncClientSize(layoutStr);

    // Apply the local layout string to the remote window
    if (layoutStr) {
      await this.remoteClient.sendCommand(`select-layout -t ${remoteWindowId} '${layoutStr}'`).catch(() => {});
    }

    // Update pane map for this window, preserving existing stable mappings.
    // We can't rely on positional index correspondence because split-window
    // on the remote splits the active pane (which may differ from the locally
    // split pane), causing indices to diverge.
    const updatedRemotePanes = await this.queryRemotePanesInWindow(remoteWindowId);
    const remoteIdSet = new Set(updatedRemotePanes.map((p) => p.id));

    // Preserve existing mappings where both local and remote pane still exist
    const mappedRemoteIds = new Set<string>();
    for (const localPane of localPanes) {
      const existingRemote = this.paneMap.get(localPane.id);
      if (existingRemote && remoteIdSet.has(existingRemote)) {
        mappedRemoteIds.add(existingRemote);
      } else {
        this.paneMap.delete(localPane.id);
      }
    }

    // Assign unmapped local panes to unmapped remote panes by index order
    const unmappedLocal = [...localPanes].filter((p) => !this.paneMap.has(p.id)).sort((a, b) => a.index - b.index);
    const unmappedRemote = [...updatedRemotePanes]
      .filter((p) => !mappedRemoteIds.has(p.id))
      .sort((a, b) => a.index - b.index);
    for (let i = 0; i < unmappedLocal.length && i < unmappedRemote.length; i++) {
      this.paneMap.set(unmappedLocal[i]!.id, unmappedRemote[i]!.id);
    }
  }
}

function compareMirrorWindows(left: MirrorWindow, right: MirrorWindow): number {
  const leftId = toTmuxIdNumber(left.id);
  const rightId = toTmuxIdNumber(right.id);
  if (leftId !== undefined && rightId !== undefined && leftId !== rightId) return leftId - rightId;
  if (leftId !== undefined && rightId === undefined) return -1;
  if (leftId === undefined && rightId !== undefined) return 1;
  if (left.index !== right.index) return left.index - right.index;
  return left.id.localeCompare(right.id, "en-US");
}

function toTmuxIdNumber(id: string): number | undefined {
  const match = id.match(/^[@%](\d+)$/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
