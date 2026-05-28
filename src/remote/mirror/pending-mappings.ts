/**
 * Read-only overlay of mid-mutation pane pairings, consumed by the reconciler.
 *
 * Between issuing `split-window` to the remote and the resulting
 * `set-option @hmx-local-pane-id` ACK, a `%layout-change` could fire
 * referencing a remote pane that doesn't yet carry its tag. Supplying that
 * pairing in this overlay tells the reconciler to treat the pane as paired
 * rather than killing it as an untagged orphan.
 *
 * The convert and split flows tag synchronously within a serialized reconcile
 * pass, so production passes {@link EMPTY_PENDING_VIEW}; the overlay stays a
 * supported reconciler input for an async-tag flow that needs it.
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
