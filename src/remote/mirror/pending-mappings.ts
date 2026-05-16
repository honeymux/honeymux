/**
 * Read-only view of mid-mutation pairings captured at reconcile-time.
 *
 * Between issuing `split-window` to the remote and the resulting
 * `set-option @hmx-local-pane-id` ACK, a `%layout-change` event could fire
 * referencing a remote pane that doesn't yet carry its tag. Without this
 * overlay, the reconciler would mark such a pane as untagged-and-orphaned
 * and emit `kill-pane`. The executor's convert/split flows therefore
 * register their in-flight pairings here and release them once the tag
 * commit is observed.
 *
 * MUST NOT be mutated by the reconciler — pass a frozen view.
 */
export interface PendingView {
  readonly localToRemote: ReadonlyMap<string, string>;
  readonly remoteToLocal: ReadonlyMap<string, string>;
}

export const EMPTY_PENDING_VIEW: PendingView = Object.freeze({
  localToRemote: new Map<string, string>(),
  remoteToLocal: new Map<string, string>(),
});

/**
 * Mutable executor-side scratch state for mid-mutation pairings.
 *
 * Owned by the reconcile executor (typically `RemoteServerManager`). Each
 * `hold()` reserves a (localPaneId, remotePaneId) pair for the duration of
 * convert/split; release it via the returned disposer once the tag commit
 * has been ACKed by the remote.
 */
export class PendingMappings {
  private localToRemote = new Map<string, string>();
  private remoteToLocal = new Map<string, string>();

  clear(): void {
    this.localToRemote.clear();
    this.remoteToLocal.clear();
  }

  hold(localPaneId: string, remotePaneId: string): () => void {
    // Maintain the bijection: if either side already pointed somewhere
    // else, evict the stale reverse-direction entry so the maps can't
    // disagree. Overwriting localToRemote[%10] from %200 → %201 must
    // also clear remoteToLocal[%200] = %10.
    const priorRemote = this.localToRemote.get(localPaneId);
    if (priorRemote !== undefined && priorRemote !== remotePaneId) {
      this.remoteToLocal.delete(priorRemote);
    }
    const priorLocal = this.remoteToLocal.get(remotePaneId);
    if (priorLocal !== undefined && priorLocal !== localPaneId) {
      this.localToRemote.delete(priorLocal);
    }
    this.localToRemote.set(localPaneId, remotePaneId);
    this.remoteToLocal.set(remotePaneId, localPaneId);
    return () => {
      if (this.localToRemote.get(localPaneId) === remotePaneId) {
        this.localToRemote.delete(localPaneId);
      }
      if (this.remoteToLocal.get(remotePaneId) === localPaneId) {
        this.remoteToLocal.delete(remotePaneId);
      }
    };
  }

  /** Capture a frozen snapshot of the current pending state. */
  view(): PendingView {
    const localToRemote = new Map(this.localToRemote);
    const remoteToLocal = new Map(this.remoteToLocal);
    return Object.freeze({ localToRemote, remoteToLocal });
  }
}
