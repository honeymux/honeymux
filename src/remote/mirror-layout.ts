import type { TmuxControlClient } from "../tmux/control-client.ts";
import type { RemoteControlClient } from "./remote-control-client.ts";

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
    // Query local windows
    const localWindows = await this.queryWindows(this.localClient);
    const remoteWindows = await this.queryRemoteWindows();

    // Create missing windows or remove extras on remote
    // Start by matching by position (index order)
    const localSorted = [...localWindows].sort((a, b) => a.index - b.index);
    const remoteSorted = [...remoteWindows].sort((a, b) => a.index - b.index);

    // If remote has more windows than local, kill extras
    for (let i = localSorted.length; i < remoteSorted.length; i++) {
      await this.remoteClient.sendCommand(`kill-window -t ${remoteSorted[i]!.id}`).catch(() => {});
    }

    // If remote has fewer windows than local, create new ones
    for (let i = remoteSorted.length; i < localSorted.length; i++) {
      await this.remoteClient.sendCommand("new-window -d").catch(() => {});
    }

    // Re-query remote after adjustments
    const updatedRemote = await this.queryRemoteWindows();
    const updatedRemoteSorted = [...updatedRemote].sort((a, b) => a.index - b.index);

    // Build window map and sync each window's pane count + layout
    this.windowMap.clear();
    this.paneMap.clear();

    for (let i = 0; i < localSorted.length && i < updatedRemoteSorted.length; i++) {
      const localWin = localSorted[i]!;
      const remoteWin = updatedRemoteSorted[i]!;
      this.windowMap.set(localWin.id, remoteWin.id);

      await this.syncWindowPanes(localWin.id, remoteWin.id, localWin.layout);
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
   */
  async onWindowAdd(localWindowId: string): Promise<void> {
    try {
      const output = await this.remoteClient.sendCommand("new-window -d -P -F '#{window_id}'");
      const remoteWindowId = output.trim();
      if (remoteWindowId) {
        this.windowMap.set(localWindowId, remoteWindowId);
        // Sync panes so the pane map is populated for the new window
        await this.syncWindowPanes(localWindowId, remoteWindowId, "");
      }
    } catch {
      // Remote may be disconnected
    }
  }

  /**
   * Handle local window-close: kill the matching remote window.
   */
  async onWindowClose(localWindowId: string): Promise<void> {
    const remoteWindowId = this.windowMap.get(localWindowId);
    if (!remoteWindowId) return;

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

  private async queryRemoteWindows(): Promise<Array<{ id: string; index: number; layout: string }>> {
    try {
      const output = await this.remoteClient.sendCommand(
        "list-windows -F '#{window_id} #{window_index} #{window_layout}'",
      );
      return output
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(" ");
          return { id: parts[0]!, index: parseInt(parts[1]!, 10), layout: parts[2]! };
        });
    } catch {
      return [];
    }
  }

  private async queryWindows(client: TmuxControlClient): Promise<Array<{ id: string; index: number; layout: string }>> {
    const output = await (client as any).sendCommand("list-windows -F '#{window_id} #{window_index} #{window_layout}'");
    return output
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        const parts = line.split(" ");
        return { id: parts[0]!, index: parseInt(parts[1]!, 10), layout: parts[2]! };
      });
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
      // Too many panes on remote — kill extras, but never kill active (converted) panes
      const toKill = remotePanes.slice(localPanes.length);
      for (const pane of toKill.reverse()) {
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
