import { log } from "../../util/log.ts";
import { applyMutations } from "./mirror-executor.ts";
import { PendingMappings } from "./pending-mappings.ts";
import { ReconcileQueue } from "./reconcile-queue.ts";
import { type MirrorPlan, type MirrorWarning, reconcile } from "./reconciler.ts";
import {
  type MirrorSnapshot,
  type RunTmuxCommand,
  type SnapshotWindow,
  captureLocalMirrorSnapshot,
  captureRemoteMirrorSnapshot,
} from "./snapshot.ts";

const RECONCILE_DEBOUNCE_MS = 25;

export interface RemoteMirrorOptions {
  /**
   * Current routing bindings on this server, keyed by remote pane id with
   * the bound local pane id as the value. The reconciler uses this for
   * its active-proxy guard: an orphan is protected from kill only when
   * the bound local pane is in the local window being reconciled.
   *
   * Returns a fresh map on each call — RemoteMirror does not cache it
   * across reconciles.
   */
  activeBindings: () => ReadonlyMap<string, string>;
  /**
   * Invoked after each successful reconcile pass (zero or more mutations
   * applied) with both the local and remote snapshots that drove this
   * pass. Allows the higher-level manager to perform local-side
   * bookkeeping that depends on either side — for instance, rebuilding
   * the per-server routing cache from local-pane tags and killing local
   * proxy panes whose remote peer has vanished from the remote snapshot.
   */
  onReconciled?: (snapshots: { local: MirrorSnapshot; remote: MirrorSnapshot }) => void;
  /**
   * Diagnostic warning emitted by the reconciler. RemoteMirror surfaces
   * these so the higher-level manager can route them to its existing
   * `warning` event.
   */
  onWarning?: (warning: MirrorWarning) => void;
  runLocal: RunTmuxCommand;
  runRemote: RunTmuxCommand;
  serverName: string;
}

/**
 * High-level mirror controller for a single remote server.
 *
 * Wraps the pure reconciler, the snapshot capture functions, the
 * reconcile queue (with debounce + coalescing), and the executor.
 * Maintains the derived caches the executor and reconciler depend on:
 *   - lastAppliedLayoutByRemoteWindow (per-window dedup of select-layout)
 *   - pending mappings (mid-mutation pairings)
 *   - the latest local + remote snapshots (consumed by getters)
 *
 * Replaces `MirrorLayoutManager` from the pre-refactor design.
 */
export class RemoteMirror {
  readonly pending = new PendingMappings();
  private hasReconciledBefore = false;
  /**
   * Last `cols,rows` we pushed to the remote control client via
   * `refresh-client -C`. Dedup'd against the local session dimensions
   * derived from the latest local snapshot's window-layout strings (all
   * windows in a session share the same W×H). Resets to null on a
   * push failure so the next reconcile retries.
   */
  private lastAppliedClientSize: null | string = null;
  private lastAppliedLayoutByRemoteWindow = new Map<string, string>();
  private latestLocal: MirrorSnapshot = { panesByWindow: new Map(), windows: [] };
  private latestRemote: MirrorSnapshot = { panesByWindow: new Map(), windows: [] };
  /**
   * Derived pairings: localPaneId → remotePaneId and localWindowId → remoteWindowId,
   * rebuilt after each successful reconcile from snapshot tags + executor results.
   */
  private paneIndex = new Map<string, string>();
  private queue: ReconcileQueue;
  private windowIndex = new Map<string, string>();

  constructor(private options: RemoteMirrorOptions) {
    this.queue = new ReconcileQueue({
      debounceMs: RECONCILE_DEBOUNCE_MS,
      label: `mirror ${options.serverName}`,
      run: () => this.runReconcile(),
    });
  }

  /**
   * Drop the cached last-applied layout for the remote window paired
   * with the given local window. The next reconcile will then re-apply
   * the layout, kicking tmux to flush updated content to subscribers.
   *
   * Used by the convert flow after `respawn-pane` resets a pane's
   * content — without this, the layout dedup would skip the
   * `select-layout` that triggers the content flush.
   */
  invalidateLayoutForLocalWindow(localWindowId: string): void {
    const remoteWindowId = this.windowIndex.get(localWindowId);
    if (remoteWindowId) {
      this.lastAppliedLayoutByRemoteWindow.delete(remoteWindowId);
    }
  }

  /**
   * Remote pane id currently paired with the given local pane, derived
   * from the most recent reconcile pass. Returns undefined when no
   * pairing exists. Pending mid-mutation pairings are included.
   */
  remotePaneFor(localPaneId: string): string | undefined {
    return this.paneIndex.get(localPaneId) ?? this.pending.view().localToRemote.get(localPaneId);
  }

  /** Remote window id currently paired with the given local window. */
  remoteWindowFor(localWindowId: string): string | undefined {
    return this.windowIndex.get(localWindowId);
  }

  /**
   * Enqueue a reconcile pass. Returns synchronously; the actual work
   * runs on the queue. Use {@link whenIdle} when a caller (e.g. test)
   * needs to await the resulting mutations.
   */
  request(): void {
    this.queue.request();
  }

  /** Stop accepting new reconcile requests and wait for the current run to drain. */
  async stop(): Promise<void> {
    this.queue.stop();
    await this.queue.whenIdle();
  }

  /** Wait for any in-flight reconcile to finish. */
  async whenIdle(): Promise<void> {
    await this.queue.whenIdle();
  }

  /**
   * Capture both snapshots. Returns true on success; false if either
   * capture failed. A failed capture MUST abort the reconcile pass —
   * running reconcile against an empty snapshot mis-attributes the
   * "missing" side as truly empty, producing destructive plans (e.g.
   * killing every remote window when the local capture failed).
   */
  private async captureSnapshots(): Promise<boolean> {
    try {
      this.latestLocal = await captureLocalMirrorSnapshot(this.options.runLocal);
    } catch (err) {
      log(
        "remote",
        `mirror ${this.options.serverName}: local snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    try {
      this.latestRemote = await captureRemoteMirrorSnapshot(this.options.runRemote);
    } catch (err) {
      log(
        "remote",
        `mirror ${this.options.serverName}: remote snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Rebuild the local-side derived indexes from the snapshot pair plus
   * the executor's just-applied window/pane creations. The executor's
   * results matter only between snapshot capture and the next reconcile;
   * the next snapshot will reflect them and the windowIndex/paneIndex
   * stay consistent with tmux state.
   */
  private rebuildIndexes(
    plan: MirrorPlan,
    applied: {
      appliedCreateWindows: ReadonlyMap<string, string>;
      appliedSplits: ReadonlyMap<string, string>;
    },
  ): void {
    // windowIndex only includes pairings where the local-window id named
    // by `@hmx-local-window-id` actually exists locally. A remote window
    // whose tag points at a vanished local window is stale — the
    // reconciler will kill it on this pass — and must NOT be a valid
    // mirror destination. Otherwise mirror.remoteWindowFor() would name
    // a soon-to-be-dead window.
    const localWindowIds = new Set(this.latestLocal.windows.map((w) => w.id));
    const newWindowIndex = new Map<string, string>();
    for (const remoteWindow of this.latestRemote.windows) {
      if (remoteWindow.localWindowId && localWindowIds.has(remoteWindow.localWindowId)) {
        newWindowIndex.set(remoteWindow.localWindowId, remoteWindow.id);
      }
    }
    for (const [localId, remoteId] of applied.appliedCreateWindows) {
      newWindowIndex.set(localId, remoteId);
    }
    this.windowIndex = newWindowIndex;

    // paneIndex must be window-scoped: a remote pane with
    // `@hmx-local-pane-id=%50` only counts as the peer for local %50
    // when both are in paired windows. If local %50 has been moved to
    // a different local window since the tag was set, the old remote
    // pane is stale and a new remote peer lives in %50's current
    // window's mirror (created via split-window). Returning the stale
    // one from `remotePaneFor(%50)` would feed the recovery / convert
    // paths a doomed pane and prevent the active-proxy guard from ever
    // unblocking the original mirror window's apply-layout.
    const localPaneToWindow = new Map<string, string>();
    for (const [windowId, panes] of this.latestLocal.panesByWindow) {
      for (const pane of panes) {
        localPaneToWindow.set(pane.id, windowId);
      }
    }
    const remoteToLocalWindow = new Map<string, string>();
    for (const remoteWindow of this.latestRemote.windows) {
      if (remoteWindow.localWindowId && localWindowIds.has(remoteWindow.localWindowId)) {
        remoteToLocalWindow.set(remoteWindow.id, remoteWindow.localWindowId);
      }
    }
    for (const [localId, remoteId] of applied.appliedCreateWindows) {
      remoteToLocalWindow.set(remoteId, localId);
    }

    const newPaneIndex = new Map<string, string>();
    for (const [remoteWindowId, panes] of this.latestRemote.panesByWindow) {
      const pairedLocalWindowId = remoteToLocalWindow.get(remoteWindowId);
      if (!pairedLocalWindowId) continue;
      for (const pane of panes) {
        const tag = pane.tags.localPaneId;
        if (!tag) continue;
        if (localPaneToWindow.get(tag) !== pairedLocalWindowId) continue;
        // Only the FIRST tag wins (matches reconciler's deterministic
        // pairing). Subsequent duplicates are orphans, not pairs.
        if (!newPaneIndex.has(tag)) {
          newPaneIndex.set(tag, pane.id);
        }
      }
    }
    for (const [localId, remoteId] of applied.appliedSplits) {
      newPaneIndex.set(localId, remoteId);
    }
    this.paneIndex = newPaneIndex;

    // Prune layout-cache entries for windows the reconciler decided to kill
    // and for windows that no longer have a paired local window. Keeping
    // stale entries is harmless (next reconcile would skip apply-layout
    // for a window that no longer exists) but wastes memory long-term.
    const killWindowIds = new Set(plan.mutations.filter((m) => m.kind === "kill-window").map((m) => m.remoteWindowId));
    for (const remoteWindowId of [...this.lastAppliedLayoutByRemoteWindow.keys()]) {
      if (killWindowIds.has(remoteWindowId)) {
        this.lastAppliedLayoutByRemoteWindow.delete(remoteWindowId);
      }
    }
  }

  private async runReconcile(): Promise<void> {
    const captured = await this.captureSnapshots();
    if (!captured) {
      // Abort: acting on a partial or empty snapshot would produce
      // destructive plans (e.g. kill-window for every remote window if
      // the local capture failed). Do NOT re-arm here — re-arming on
      // sustained transport failure busy-loops at the debounce floor.
      // The next user-driven event or the reconnect handler in
      // RemoteServerManager will trigger another reconcile when the
      // transport recovers.
      return;
    }

    // Sync remote client size from the local session's window dimensions
    // BEFORE the executor runs apply-layout mutations, so select-layout
    // produces pane sizes that match the local layout exactly. The remote
    // window-size policy (`smallest`) re-evaluates against the new client
    // dimensions, resizing the mirror windows to match.
    await this.syncRemoteClientSize();

    const plan = reconcile({
      activeBindings: this.options.activeBindings(),
      hasReconciledBefore: this.hasReconciledBefore,
      lastAppliedLayoutByRemoteWindow: this.lastAppliedLayoutByRemoteWindow,
      local: this.latestLocal,
      pending: this.pending.view(),
      remote: this.latestRemote,
      serverName: this.options.serverName,
    });

    for (const warning of plan.warnings) {
      this.options.onWarning?.(warning);
    }

    if (plan.mutations.length === 0) {
      this.hasReconciledBefore = true;
      this.rebuildIndexes(plan, { appliedCreateWindows: new Map(), appliedSplits: new Map() });
      this.options.onReconciled?.({ local: this.latestLocal, remote: this.latestRemote });
      return;
    }

    const result = await applyMutations(plan.mutations, {
      label: `mirror ${this.options.serverName}`,
      runLocal: this.options.runLocal,
      runRemote: this.options.runRemote,
    });

    // Update the layout cache for successful applies. The cache
    // intentionally only tracks layouts that we know stuck on the
    // remote; failed mutations leave the cache untouched so the next
    // reconcile retries.
    for (const [remoteWindowId, layout] of result.appliedLayouts) {
      this.lastAppliedLayoutByRemoteWindow.set(remoteWindowId, layout);
    }

    this.rebuildIndexes(plan, {
      appliedCreateWindows: result.appliedCreateWindows,
      appliedSplits: result.appliedSplits,
    });

    this.hasReconciledBefore = true;

    // Any per-mutation failure re-arms the queue; the next pass will
    // observe the partially-applied state and finish the job.
    if (result.failures.length > 0) {
      this.queue.request();
    }

    this.options.onReconciled?.({ local: this.latestLocal, remote: this.latestRemote });
  }

  /**
   * Push the local session's dimensions to the remote control client
   * before applying any layout, so `select-layout` produces matching
   * pane sizes. Dedup'd via `lastAppliedClientSize` — a fresh resize
   * only re-fires when the dimensions actually change.
   *
   * The size is sourced from a local window that contains at least one
   * pane mirrored to this server. Under `window-size smallest` all
   * windows in a session share the same W×H, so any such window's
   * layout encodes the correct dims. Scoping by mirrored-pane is
   * required because the local snapshot comes from `list-windows -a`,
   * which spans every session on the local `-L honeymux` server,
   * including detached sessions whose layout strings stay frozen at
   * their last-attached size — picking an arbitrary window would
   * occasionally land on one of those and push stale dims that then
   * become the remote session size (visible via `stty size` in remote
   * panes).
   *
   * If no local pane is mirrored to this server yet, skip the push;
   * the next reconcile after `convertPane` will run before any
   * apply-layout.
   *
   * Best-effort: a failed push resets the dedup so the next reconcile
   * retries.
   */
  private async syncRemoteClientSize(): Promise<void> {
    let mirroredWindow: SnapshotWindow | undefined;
    for (const window of this.latestLocal.windows) {
      const panes = this.latestLocal.panesByWindow.get(window.id) ?? [];
      if (panes.some((pane) => pane.tags.remoteHost === this.options.serverName)) {
        mirroredWindow = window;
        break;
      }
    }
    if (!mirroredWindow) return;
    const match = mirroredWindow.layout.match(/^[^,]*,(\d+)x(\d+),/);
    if (!match) return;
    const size = `${match[1]},${match[2]}`;
    if (size === this.lastAppliedClientSize) return;
    this.lastAppliedClientSize = size;
    try {
      await this.options.runRemote(`refresh-client -C ${size}`);
    } catch {
      this.lastAppliedClientSize = null;
    }
  }
}
