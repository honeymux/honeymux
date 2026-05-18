import type { RemotePaneMapping } from "../types.ts";
import type { MirrorSnapshot } from "./snapshot.ts";

import { REMOTE_HOST_TAG, REMOTE_PANE_TAG } from "./snapshot.ts";

/**
 * Derived view of the local-side mirror bindings: which local pane is the
 * proxy peer of which remote pane on which server.
 *
 * Source of truth is the local snapshot's `@hmx-remote-host` and
 * `@hmx-remote-pane` tags, refreshed via `rebuildForServer()` after every
 * successful reconcile. A separate `register()` API holds bindings the
 * executor has installed but not yet observed via snapshot — used during
 * the brief window between `convertPane`'s tmux-tag writes and the next
 * snapshot capture. The held registration is consulted on routing lookups
 * AS WELL AS being merged into the per-server rebuild output, so it
 * survives at least one reconcile after the explicit hold is released.
 *
 * Replaces `RemoteServerManager.paneMappings` from the pre-refactor design.
 */
export class RoutingCache {
  private byLocal = new Map<string, RemotePaneMapping>();
  /** key: `${serverName}:${remotePaneId}` */
  private byRemote = new Map<string, RemotePaneMapping>();
  /** Held registrations not yet observed in any snapshot. */
  private pending = new Map<string, RemotePaneMapping>();

  /**
   * Current bindings on the given server, keyed by remote pane id with
   * the bound local pane id as the value. Used by the reconciler's
   * active-proxy guard, which needs to know not just whether a remote
   * pane is bound, but WHICH local pane owns it — so it can compare
   * against the local panes in the window being reconciled.
   */
  activeBindings(serverName: string): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const [localId, mapping] of this.byLocal) {
      if (mapping.serverName === serverName) map.set(mapping.remotePaneId, localId);
    }
    return map;
  }

  /** Remove all bindings (used by stopAll). */
  clear(): void {
    this.byLocal.clear();
    this.byRemote.clear();
    this.pending.clear();
  }

  /** Drop a binding by local pane id, e.g. when the proxy is torn down. */
  delete(localPaneId: string): void {
    const mapping = this.byLocal.get(localPaneId);
    this.byLocal.delete(localPaneId);
    this.pending.delete(localPaneId);
    if (mapping) {
      this.byRemote.delete(remoteKey(mapping.serverName, mapping.remotePaneId));
    }
  }

  /** All bindings currently held. */
  *entries(): IterableIterator<RemotePaneMapping> {
    yield* this.byLocal.values();
  }

  /**
   * Remote pane id → local pane id, scoped by server (multi-remote can have
   * colliding remote ids across servers). Returns undefined when no
   * binding is known.
   */
  findLocalForRemote(serverName: string, remotePaneId: string): string | undefined {
    return this.byRemote.get(remoteKey(serverName, remotePaneId))?.localPaneId;
  }

  /** Bindings scoped to a particular server, in insertion order. */
  *forServer(serverName: string): IterableIterator<RemotePaneMapping> {
    for (const mapping of this.byLocal.values()) {
      if (mapping.serverName === serverName) yield mapping;
    }
  }

  /**
   * True while a binding for `localPaneId` is held in the pending overlay —
   * i.e. it was installed via `register()` and the snapshot has not yet
   * observed the corresponding `@hmx-remote-host`/`@hmx-remote-pane` tags.
   *
   * Callers that act on the routing cache between reconciles (e.g. the
   * post-reconcile cleanup that tears down local proxies whose remote peer
   * has vanished) MUST consult this to avoid destroying a binding that
   * `convertPane` is still in the middle of installing — the pre-mutation
   * remote snapshot of the in-flight reconcile pass can lag the actual
   * remote state by one cycle, which would otherwise classify a freshly
   * created or just-respawned remote pane as "dead".
   */
  isPending(localPaneId: string): boolean {
    return this.pending.has(localPaneId);
  }

  /**
   * Live binding for a local pane, or undefined when it's not remote.
   *
   * Hot-path lookup used by the proxy-server / status helpers. The cache
   * is rebuilt after each reconcile so this reflects the latest snapshot.
   */
  lookup(localPaneId: string): RemotePaneMapping | undefined {
    return this.byLocal.get(localPaneId);
  }

  /**
   * Refresh bindings for one server from its local snapshot. Local panes
   * carrying both `@hmx-remote-host` matching `serverName` and a non-empty
   * `@hmx-remote-pane` count as bound; any prior binding for `serverName`
   * not present in this snapshot is dropped (other servers' bindings are
   * untouched).
   *
   * Pending registrations are layered on top: those whose exact tuple is
   * already present in the snapshot are AUTO-RETIRED (their snapshot
   * presence has caught up to the eager registration). Pending entries
   * that aren't in the snapshot yet are re-applied so the binding
   * survives one more rebuild — necessary for the convert/recover flow
   * between tag write and tag observation.
   */
  rebuildForServer(serverName: string, local: MirrorSnapshot): void {
    // Drop the server's prior bindings first.
    for (const [localId, mapping] of [...this.byLocal]) {
      if (mapping.serverName !== serverName) continue;
      this.byLocal.delete(localId);
      this.byRemote.delete(remoteKey(serverName, mapping.remotePaneId));
    }

    // Re-derive from snapshot tags. Collect which pending tuples have
    // become snapshot-visible so we can retire them at the end.
    const observedPending = new Set<string>();
    for (const panes of local.panesByWindow.values()) {
      for (const pane of panes) {
        if (pane.tags.remoteHost !== serverName) continue;
        const remotePaneId = pane.tags.remotePaneId;
        if (!remotePaneId) continue;
        this.applyMapping({ localPaneId: pane.id, remotePaneId, serverName });
        const candidate = this.pending.get(pane.id);
        if (candidate && candidate.remotePaneId === remotePaneId && candidate.serverName === serverName) {
          observedPending.add(pane.id);
        }
      }
    }

    // Auto-retire pending registrations that the snapshot has caught up
    // to. Without this, a long-lived process would accumulate stale
    // pending entries that come back from the dead if the snapshot later
    // loses the tag (e.g. on revert).
    for (const localId of observedPending) {
      this.pending.delete(localId);
    }

    // Re-apply remaining pending registrations (not yet snapshot-visible)
    // for this server. Idempotent.
    for (const mapping of this.pending.values()) {
      if (mapping.serverName === serverName) this.applyMapping(mapping);
    }
  }

  /**
   * Eagerly install a binding the executor has just created, BEFORE its
   * snapshot tags have been observed. Returns a disposer the caller MUST
   * invoke once the binding is no longer in flight (e.g. on revert or
   * connection teardown) — without it, the binding stays sticky across
   * rebuilds even after the tags disappear.
   *
   * Idempotent in the sense that calling `register` twice for the same
   * (localPaneId, remotePaneId, serverName) tuple is a no-op.
   */
  register(mapping: RemotePaneMapping): () => void {
    this.pending.set(mapping.localPaneId, mapping);
    this.applyMapping(mapping);
    return () => {
      const held = this.pending.get(mapping.localPaneId);
      if (held && held.remotePaneId === mapping.remotePaneId && held.serverName === mapping.serverName) {
        this.pending.delete(mapping.localPaneId);
      }
    };
  }

  /**
   * Update an existing binding without creating a pending hold. Used by
   * callers that already own the registration's lifecycle elsewhere (e.g.
   * the post-reconcile sync that updates a binding's remotePaneId after
   * the mirror discovered a new pairing) — they don't need a new pending
   * entry that they'd then have to remember to dispose.
   *
   * If no prior binding exists for `mapping.localPaneId`, this is a no-op.
   */
  updateIfBound(mapping: RemotePaneMapping): void {
    if (!this.byLocal.has(mapping.localPaneId)) return;
    this.applyMapping(mapping);
    // If there's a pending hold for this localPaneId from a prior
    // register(), update it too — otherwise the next rebuild would
    // re-apply the stale pending tuple and undo this update.
    if (this.pending.has(mapping.localPaneId)) {
      this.pending.set(mapping.localPaneId, mapping);
    }
  }

  private applyMapping(mapping: RemotePaneMapping): void {
    // Evict the stale reverse-direction entry when ANY part of the prior
    // (serverName, remotePaneId) tuple has changed — not just the
    // remotePaneId. A cross-server remap (server-a → server-b with the
    // same remotePaneId) is also a stale-key case.
    const priorLocal = this.byLocal.get(mapping.localPaneId);
    if (priorLocal) {
      const priorKey = remoteKey(priorLocal.serverName, priorLocal.remotePaneId);
      const nextKey = remoteKey(mapping.serverName, mapping.remotePaneId);
      if (priorKey !== nextKey) {
        this.byRemote.delete(priorKey);
      }
    }
    // Evict a stale forward entry when the remote side is being remapped
    // to a different local.
    const priorRemote = this.byRemote.get(remoteKey(mapping.serverName, mapping.remotePaneId));
    if (priorRemote && priorRemote.localPaneId !== mapping.localPaneId) {
      this.byLocal.delete(priorRemote.localPaneId);
    }
    this.byLocal.set(mapping.localPaneId, mapping);
    this.byRemote.set(remoteKey(mapping.serverName, mapping.remotePaneId), mapping);
  }
}

function remoteKey(serverName: string, remotePaneId: string): string {
  return `${serverName}:${remotePaneId}`;
}

// Re-export tag constants for callers that consume the snapshot's tag schema.
export { REMOTE_HOST_TAG, REMOTE_PANE_TAG };
