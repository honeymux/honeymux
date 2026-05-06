import type { TmuxControlClient } from "../tmux/control-client.ts";
import type { RemoteControlClient } from "./remote-control-client.ts";

import { quoteTmuxArg } from "../tmux/escape.ts";

const LOCAL_PANE_ID_OPTION = "@hmx-local-pane-id";
const LOCAL_WINDOW_ID_OPTION = "@hmx-local-window-id";

interface LocalPane {
  id: string;
  index: number;
}

interface MirrorWindow {
  id: string;
  index: number;
  layout: string;
  localWindowId?: string;
}

interface PaneMatch {
  localId: string;
  needsTagUpdate: boolean;
  remoteId: string;
}

interface PaneSyncPlan {
  matched: PaneMatch[];
  /**
   * Remote panes that don't pair with any current local pane: untagged or
   * tagged with a value that no longer matches any local pane. The
   * `localPaneId` field carries the stale tag value when present so the
   * caller can distinguish "external/untagged" from "stale-tagged" in
   * integrity logging. Subject to `isRemotePaneActive` before being killed.
   */
  orphanRemotePanes: Array<{ id: string; localPaneId?: string }>;
  /** Local panes that need a brand-new remote pane via `split-window`. */
  unpairedLocalIds: string[];
}

interface RemotePane {
  id: string;
  index: number;
  localPaneId?: string;
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
  /** remoteWindowId → last layout string applied via select-layout. */
  private lastLayoutByRemoteWindow = new Map<string, string>();
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

    // Untagged windows on the very first sync are the bootstrap default
    // tmux creates with `new-session` — they're hmx's responsibility, not
    // external interference. Use windowMap as a "have we already
    // established mirror state with this server" sentinel.
    const hadPriorMirrorState = this.windowMap.size > 0;

    // paneMap is rebuilt per-window from `@hmx-local-pane-id` tags inside
    // syncWindowPanes; we leave existing entries in place across the loop
    // so a syncWindowPanes failure mid-iteration doesn't blank routing for
    // windows that haven't been re-synced yet.
    this.windowMap.clear();

    for (const localWindow of localWindows) {
      let remoteWindow = remoteWindowsByLocalId.get(localWindow.id);
      if (!remoteWindow) {
        const initialLocalPaneId = await this.firstLocalPaneId(localWindow.id);
        if (!initialLocalPaneId) continue;
        remoteWindow = await this.createRemoteWindow(localWindow.id, initialLocalPaneId);
      }
      if (!remoteWindow) continue;

      this.windowMap.set(localWindow.id, remoteWindow.id);

      await this.syncWindowPanes(localWindow.id, remoteWindow.id, localWindow.layout);
    }

    // hmx owns the mirror session, so any remote window without a
    // matching local window is stale and gets dropped.
    for (const remoteWindow of unassignedRemoteWindows) {
      // A stale tag (option set, points at a missing local window) is a
      // strong signal regardless of sync history — we set the tag, so its
      // presence with no matching local id means either the local window
      // died while we weren't watching or someone overwrote our tag. An
      // untagged window only counts as "unexpected" once we've established
      // some mirror state; on first sync the bootstrap default window from
      // `new-session` is always untagged and is hmx's responsibility.
      if (remoteWindow.localWindowId || hadPriorMirrorState) {
        const reason = remoteWindow.localWindowId
          ? `stale @hmx-local-window-id=${remoteWindow.localWindowId} (no current local window)`
          : "no @hmx-local-window-id tag";
        this.onIntegrityWarning(`unexpected remote window ${remoteWindow.id} in mirror session: ${reason}`);
      }
      this.lastLayoutByRemoteWindow.delete(remoteWindow.id);
      await this.remoteClient.sendCommand(`kill-window -t ${remoteWindow.id}`).catch(() => {});
    }
  }

  /** Get the remote pane ID for a local pane. */
  getRemotePaneId(localPaneId: string): string | undefined {
    return this.paneMap.get(localPaneId);
  }

  /**
   * Drop the cached layout for the mirror window that mirrors `localWindowId`,
   * so the next `syncWindowPanes` call re-applies `select-layout` even when
   * the layout string is unchanged. Use after externally resetting a remote
   * pane (e.g., `respawn-pane`); the kick re-asserts pane geometry against
   * the current client size and lets tmux flush the post-reset content to
   * control-mode subscribers.
   */
  invalidateLayoutForLocalWindow(localWindowId: string): void {
    const remoteWindowId = this.windowMap.get(localWindowId);
    if (remoteWindowId) {
      this.lastLayoutByRemoteWindow.delete(remoteWindowId);
    }
  }

  /** Callback to check if a remote pane is actively in use (has a local proxy). */
  isRemotePaneActive: (remotePaneId: string) => boolean = () => false;

  /**
   * Callback fired when the sync logic encounters mirror state that hmx
   * didn't create — untagged panes, untagged windows, or panes/windows
   * tagged with a value that no longer matches any local id. The caller
   * decides how loud to be: log, surface as a UI warning, or escalate.
   * The orphan/unassigned cleanup runs regardless of this callback, so
   * by the time it fires the inconsistency is already healed.
   */
  onIntegrityWarning: (message: string) => void = () => {};

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
      const initialLocalPaneId = await this.firstLocalPaneId(localWindowId);
      if (!initialLocalPaneId) return;
      const remoteWindow = await this.createRemoteWindow(localWindowId, initialLocalPaneId);
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
    this.lastLayoutByRemoteWindow.delete(remoteWindowId);

    // We can't easily tell which panes belonged to this window,
    // so rebuild pane map on next fullSync or layout change.
  }

  // --- Private helpers ---

  private async createRemoteWindow(
    localWindowId: string,
    initialLocalPaneId: string,
  ): Promise<MirrorWindow | undefined> {
    try {
      // Capture the new window id and its initial pane id so we can tag
      // both before this method returns.
      const output = await this.remoteClient.sendCommand("new-window -d -P -F '#{window_id} #{pane_id}'");
      const [remoteWindowId, remotePaneId] = output.trim().split(/\s+/);
      if (!remoteWindowId || !remotePaneId) return undefined;
      await this.setRemoteWindowLocalId(remoteWindowId, localWindowId);
      await this.setRemotePaneLocalId(remotePaneId, initialLocalPaneId);
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

  /** Lowest-index pane of `localWindowId`, or undefined if the window is empty/gone. */
  private async firstLocalPaneId(localWindowId: string): Promise<string | undefined> {
    const localPanes = await this.queryPanesInWindow(this.localClient, localWindowId);
    if (localPanes.length === 0) return undefined;
    return [...localPanes].sort((a, b) => a.index - b.index)[0]?.id;
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

  private async queryRemotePanesInWindow(windowId: string): Promise<RemotePane[]> {
    try {
      const output = await this.remoteClient.sendCommand(
        `list-panes -t ${windowId} -F '#{pane_id}\t#{pane_index}\t#{${LOCAL_PANE_ID_OPTION}}'`,
      );
      return output
        .split("\n")
        .map((line) => line.replace(/\r$/, ""))
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          return {
            id: parts[0]!,
            index: parseInt(parts[1]!, 10),
            localPaneId: parts[2] ? parts[2] : undefined,
          };
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

  private setRemotePaneLocalId(remotePaneId: string, localPaneId: string): Promise<string> {
    return this.remoteClient.sendCommand(
      `set-option -p -t ${quoteTmuxArg("remote pane id", remotePaneId)} ${LOCAL_PANE_ID_OPTION} ${quoteTmuxArg("local pane id", localPaneId)}`,
    );
  }

  private setRemoteWindowLocalId(remoteWindowId: string, localWindowId: string): Promise<string> {
    return this.remoteClient.sendCommand(
      `set-option -w -t ${quoteTmuxArg("window id", remoteWindowId)} ${LOCAL_WINDOW_ID_OPTION} ${quoteTmuxArg("local window id", localWindowId)}`,
    );
  }

  /**
   * Parse the window dimensions from a tmux layout string (format: "checksum,WxH,...")
   * and resize the remote control client to match, so that select-layout applies
   * pane dimensions matching the local layout.
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
   *
   * Pairing assumes every remote pane carries `@hmx-local-pane-id`: tag
   * matching pairs each remote pane with its local counterpart, untagged
   * panes are treated as orphans and killed, and any local pane without a
   * matching remote gets a freshly split (and immediately tagged) one.
   * Initial panes from `new-window` are tagged inside `createRemoteWindow`,
   * so this routine never sees a legitimate untagged remote pane.
   */
  private async syncWindowPanes(localWindowId: string, remoteWindowId: string, layoutStr: string): Promise<void> {
    const localPanes = await this.queryPanesInWindow(this.localClient, localWindowId);
    const remotePanes = await this.queryRemotePanesInWindow(remoteWindowId);

    const plan = planPanePairings(localPanes, remotePanes);

    // Kill orphaned remote panes (with active-pane safety net).
    let remoteModified = false;
    for (const orphan of plan.orphanRemotePanes) {
      if (this.isRemotePaneActive(orphan.id)) continue;
      const reason = orphan.localPaneId
        ? `stale @hmx-local-pane-id=${orphan.localPaneId} (no current local pane)`
        : "no @hmx-local-pane-id tag";
      this.onIntegrityWarning(`unexpected remote pane ${orphan.id} in mirror window ${remoteWindowId}: ${reason}`);
      await this.remoteClient.sendCommand(`kill-pane -t ${orphan.id}`).catch(() => {});
      remoteModified = true;
    }

    // Split for unpaired local panes; capture each new pane ID so we can
    // tag it immediately, before any layout-change races could shuffle it.
    const newPairs: PaneMatch[] = [];
    for (const localId of plan.unpairedLocalIds) {
      try {
        const output = await this.remoteClient.sendCommand(`split-window -t ${remoteWindowId} -d -P -F '#{pane_id}'`);
        const newRemoteId = output.trim();
        if (newRemoteId) {
          newPairs.push({ localId, needsTagUpdate: true, remoteId: newRemoteId });
          remoteModified = true;
        }
      } catch {
        // Split failed — local pane stays unpaired this round; next sync retries.
      }
    }

    // Mutating the remote pane set invalidates any cached layout assertion
    // for this window; the next select-layout below will re-apply.
    if (remoteModified) {
      this.lastLayoutByRemoteWindow.delete(remoteWindowId);
    }

    // Sync remote client size and apply the layout, but skip select-layout
    // when the layout string matches what we last applied to this window
    // and nothing in our control mutated the pane set. This avoids the
    // %layout-change burst tmux emits per call, which the local proxy
    // turns into a redundant pane re-paint (visible as duplicated prompts
    // after a session-window-changed). External pane mutations like
    // `respawn-pane` invalidate via `invalidateLayoutForLocalWindow`
    // because there's no other signal we can latch onto.
    await this.syncClientSize(layoutStr);
    if (layoutStr && this.lastLayoutByRemoteWindow.get(remoteWindowId) !== layoutStr) {
      this.lastLayoutByRemoteWindow.set(remoteWindowId, layoutStr);
      await this.remoteClient.sendCommand(`select-layout -t ${remoteWindowId} '${layoutStr}'`).catch(() => {});
    }

    const allMatches: PaneMatch[] = [...plan.matched, ...newPairs];
    const pairedRemoteByLocal = new Map<string, string>();
    for (const match of allMatches) {
      pairedRemoteByLocal.set(match.localId, match.remoteId);
    }

    // Update paneMap for this window's local panes only — entries for panes
    // in other windows are owned by their own syncWindowPanes runs.
    for (const localPane of localPanes) {
      const remoteId = pairedRemoteByLocal.get(localPane.id);
      if (remoteId) {
        this.paneMap.set(localPane.id, remoteId);
      } else {
        this.paneMap.delete(localPane.id);
      }
    }

    // Write the tag for every pair that doesn't already have it correct.
    for (const match of allMatches) {
      if (!match.needsTagUpdate) continue;
      await this.setRemotePaneLocalId(match.remoteId, match.localId).catch(() => {});
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

/**
 * Plan local↔remote pane pairings for a single window.
 *
 * Pure function: returns the plan; the caller performs IO (split-window,
 * kill-pane, set-option). Every remote pane is expected to carry
 * `@hmx-local-pane-id` — `createRemoteWindow` and the split path inside
 * `syncWindowPanes` both tag at creation. Anything untagged here is a
 * stray that hmx didn't create, and is killed as an orphan.
 */
function planPanePairings(localPanes: LocalPane[], remotePanes: RemotePane[]): PaneSyncPlan {
  const localPaneIds = new Set(localPanes.map((p) => p.id));

  const matched: PaneMatch[] = [];
  const matchedLocalIds = new Set<string>();
  const usedRemoteIds = new Set<string>();

  for (const rp of remotePanes) {
    if (!rp.localPaneId) continue;
    if (!localPaneIds.has(rp.localPaneId)) continue;
    if (matchedLocalIds.has(rp.localPaneId)) continue;
    matched.push({ localId: rp.localPaneId, needsTagUpdate: false, remoteId: rp.id });
    matchedLocalIds.add(rp.localPaneId);
    usedRemoteIds.add(rp.id);
  }

  return {
    matched,
    orphanRemotePanes: remotePanes
      .filter((p) => !usedRemoteIds.has(p.id))
      .map((p) => ({ id: p.id, localPaneId: p.localPaneId })),
    unpairedLocalIds: localPanes.filter((p) => !matchedLocalIds.has(p.id)).map((p) => p.id),
  };
}

function toTmuxIdNumber(id: string): number | undefined {
  const match = id.match(/^[@%](\d+)$/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
