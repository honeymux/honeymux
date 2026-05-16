import type { PendingView } from "./pending-mappings.ts";
import type { MirrorSnapshot, SnapshotPane, SnapshotWindow } from "./snapshot.ts";

export type KillPaneReason = "orphan" | "stale-tag";

export interface MirrorPlan {
  readonly mutations: ReadonlyArray<Mutation>;
  readonly warnings: ReadonlyArray<MirrorWarning>;
}

export interface MirrorWarning {
  readonly kind: "stale-tag-pane" | "stale-tag-window" | "untagged-remote-pane" | "untagged-remote-window";
  readonly message: string;
  readonly remotePaneId?: string;
  readonly remoteWindowId?: string;
  readonly staleTagValue?: string;
}

/**
 * A single executable change. Mutations are emitted in a contractually
 * ordered list (see `MirrorPlan.mutations`); consumers MUST apply them in
 * array order. Do not topologically sort externally.
 */
export type Mutation =
  | { initialLocalPaneId: string; kind: "create-window"; localWindowId: string }
  | { kind: "apply-layout"; layout: string; remoteWindowId: string }
  | { kind: "kill-pane"; reason: KillPaneReason; remotePaneId: string }
  | { kind: "kill-window"; remoteWindowId: string }
  | { kind: "split-window"; localPaneId: string; remoteWindowId: string };

export interface ReconcileInput {
  /**
   * Remote panes that are the active proxy peer of a live local pane. The
   * reconciler MUST NOT emit `kill-pane` for any pane in this set — killing
   * it while a live proxy is rendering its output tears down user-visible
   * work.
   *
   * Computed by the executor by looking up `@hmx-remote-pane` on each
   * local pane that currently hosts a live proxy process. Only panes that
   * ARE the active peer get the guard — a duplicate-tagged orphan does
   * not, even if its (stale) tag matches an active local pane.
   */
  readonly activeRemotePaneIds: ReadonlySet<string>;
  /**
   * True if any prior reconcile has committed mutations against this
   * server. Gates "bootstrap window" warnings on the very first sync:
   * tmux's freshly-created mirror session has one untagged default window
   * which is benign on first connect, and an orphan warning anytime after.
   */
  readonly hasReconciledBefore: boolean;
  /**
   * Last-applied layout per remote window. When the new `apply-layout`
   * mutation would carry the same string, skip it — tmux re-emits
   * `%layout-change` for every `select-layout` call and re-paints pane
   * content to control-mode subscribers, which the local proxy renders
   * as duplicate prompt rows.
   *
   * Caller owns the lifecycle: after each successful plan execution, the
   * caller updates this map from the mutations it actually applied.
   */
  readonly lastAppliedLayoutByRemoteWindow: ReadonlyMap<string, string>;
  readonly local: MirrorSnapshot;
  /**
   * Mid-mutation pairings established by the executor's convert/split flow.
   * Remote panes referenced here are treated as paired even if their
   * `@hmx-local-pane-id` tag has not yet been committed.
   */
  readonly pending: PendingView;
  readonly remote: MirrorSnapshot;
  /** Server identity, used for warning messages and per-server scoping. */
  readonly serverName: string;
}

interface PanePairing {
  /** Remote panes that have no matching local pane (untagged or stale-tagged). */
  orphanRemote: ReadonlyArray<{ localPaneId?: string; remotePaneId: string }>;
  /** Local panes that have no matching remote pane → need a split. */
  unpairedLocal: ReadonlyArray<string>;
}

/**
 * Compute the ordered plan that brings the remote mirror into structural
 * agreement with the local layout.
 *
 * Mutation ordering contract (preserved by this function):
 *   1. `create-window`      windows local has but remote lacks
 *   2. `split-window`       panes local has but remote lacks (splits are
 *                            immediately tagged by the executor, so the
 *                            kill-pane phase cannot misclassify them)
 *   3. `kill-pane`          orphan/stale remote panes (BEFORE apply-layout
 *                            so the remote window's pane count matches
 *                            what the layout encodes — otherwise tmux's
 *                            `select-layout` rejects with "have N panes
 *                            but need M" and the orphan churn would
 *                            need a second pass to clear)
 *   4. `apply-layout`       resize/reflow the remote window
 *   5. `kill-window`        stale remote windows (last, after pane cleanup)
 *
 * Pure: no I/O, no time, no globals. Same input → same output. Two-arg
 * comparison only; the function does not observe `Date.now`, environment,
 * or any other ambient state.
 */
export function reconcile(input: ReconcileInput): MirrorPlan {
  const mutations: Mutation[] = [];
  const warnings: MirrorWarning[] = [];

  const localWindowIds = new Set(input.local.windows.map((w) => w.id));

  // Pair remote windows to local windows by @hmx-local-window-id.
  const remoteWindowByLocalId = new Map<string, SnapshotWindow>();
  const unpairedRemoteWindows: SnapshotWindow[] = [];
  for (const remoteWindow of input.remote.windows) {
    const tag = remoteWindow.localWindowId;
    if (tag && localWindowIds.has(tag) && !remoteWindowByLocalId.has(tag)) {
      remoteWindowByLocalId.set(tag, remoteWindow);
    } else {
      unpairedRemoteWindows.push(remoteWindow);
    }
  }

  // Phase 1: create-window for local windows without a remote pair.
  for (const localWindow of input.local.windows) {
    if (remoteWindowByLocalId.has(localWindow.id)) continue;
    const localPanes = input.local.panesByWindow.get(localWindow.id) ?? [];
    const initialLocalPaneId = localPanes[0]?.id;
    if (!initialLocalPaneId) continue;
    mutations.push({
      initialLocalPaneId,
      kind: "create-window",
      localWindowId: localWindow.id,
    });
  }

  // Phase 2-5: walk each paired window once, accumulate mutations into
  // phase buckets, then concatenate the buckets in the ordering contract.
  // Per-phase grouping (not per-window grouping) is what the executor
  // contract guarantees: never apply-layout for window A before split-window
  // for window B, etc.
  const splits: Mutation[] = [];
  const applyLayouts: Mutation[] = [];
  const paneKills: Mutation[] = [];
  for (const localWindow of input.local.windows) {
    const remoteWindow = remoteWindowByLocalId.get(localWindow.id);
    if (!remoteWindow) continue;

    const localPanes = input.local.panesByWindow.get(localWindow.id) ?? [];
    const remotePanes = input.remote.panesByWindow.get(remoteWindow.id) ?? [];
    const pairing = pairPanes(localPanes, remotePanes, input.pending);

    // Stale-tag warnings fire ALWAYS, including first sync: a stale tag is
    // evidence of an interrupted prior session, never benign bootstrap noise.
    // Untagged warnings are suppressed on first sync because tmux's freshly
    // created mirror session has one untagged default window that's benign.
    for (const orphan of pairing.orphanRemote) {
      if (orphan.localPaneId) {
        warnings.push({
          kind: "stale-tag-pane",
          message: `remote pane ${orphan.remotePaneId} in mirror window ${remoteWindow.id} has stale ${tagDisplay("local-pane-id", orphan.localPaneId)} (no current local pane)`,
          remotePaneId: orphan.remotePaneId,
          remoteWindowId: remoteWindow.id,
          staleTagValue: orphan.localPaneId,
        });
      } else if (input.hasReconciledBefore) {
        warnings.push({
          kind: "untagged-remote-pane",
          message: `unexpected untagged remote pane ${orphan.remotePaneId} in mirror window ${remoteWindow.id}`,
          remotePaneId: orphan.remotePaneId,
          remoteWindowId: remoteWindow.id,
        });
      }
    }

    for (const localId of pairing.unpairedLocal) {
      splits.push({ kind: "split-window", localPaneId: localId, remoteWindowId: remoteWindow.id });
    }

    const desiredLayout = localWindow.layout;
    const lastApplied = input.lastAppliedLayoutByRemoteWindow.get(remoteWindow.id);
    const splitsHappening = pairing.unpairedLocal.length > 0;
    const killsHappening = pairing.orphanRemote.some((o) => !input.activeRemotePaneIds.has(o.remotePaneId));
    // Apply when: layout changed, OR we mutated the pane set (which
    // invalidates any cached "no-op" judgment regardless of string equality).
    if (desiredLayout && (lastApplied !== desiredLayout || splitsHappening || killsHappening)) {
      applyLayouts.push({ kind: "apply-layout", layout: desiredLayout, remoteWindowId: remoteWindow.id });
    }

    // Active-proxy guard checks the orphan's OWN id against the set of
    // active remote panes. A duplicate-tagged interloper has a different
    // remote id from the genuine paired peer, so the guard does not
    // protect it.
    for (const orphan of pairing.orphanRemote) {
      if (input.activeRemotePaneIds.has(orphan.remotePaneId)) continue;
      paneKills.push({
        kind: "kill-pane",
        reason: orphan.localPaneId ? "stale-tag" : "orphan",
        remotePaneId: orphan.remotePaneId,
      });
    }
  }

  mutations.push(...splits, ...paneKills, ...applyLayouts);

  // Phase 6: kill-window for remote windows with no local pair. Stale-tag
  // warnings fire always (evidence of an interrupted prior session);
  // untagged-window warnings are suppressed on first sync because the
  // freshly-created mirror session always has one untagged default window.
  for (const remoteWindow of unpairedRemoteWindows) {
    const tag = remoteWindow.localWindowId;
    if (tag) {
      warnings.push({
        kind: "stale-tag-window",
        message: `remote window ${remoteWindow.id} has stale ${tagDisplay("local-window-id", tag)} (no current local window)`,
        remoteWindowId: remoteWindow.id,
        staleTagValue: tag,
      });
    } else if (input.hasReconciledBefore) {
      warnings.push({
        kind: "untagged-remote-window",
        message: `unexpected untagged remote window ${remoteWindow.id}`,
        remoteWindowId: remoteWindow.id,
      });
    }
    mutations.push({ kind: "kill-window", remoteWindowId: remoteWindow.id });
  }

  return { mutations, warnings };
}

function pairPanes(
  localPanes: ReadonlyArray<SnapshotPane>,
  remotePanes: ReadonlyArray<SnapshotPane>,
  pending: PendingView,
): PanePairing {
  const localIds = new Set(localPanes.map((p) => p.id));
  const matchedLocalIds = new Set<string>();
  const orphanRemote: { localPaneId?: string; remotePaneId: string }[] = [];

  // Pair remote → local by @hmx-local-pane-id tag. The pending overlay
  // fills in only when the tag is absent — that's the mid-mutation window
  // between `split-window` returning a new remote id and the matching
  // `set-option @hmx-local-pane-id` ACK landing. A stale or duplicate tag
  // does NOT defer to pending; the executor isn't holding that pairing,
  // so the only correct action is to treat the remote pane as an orphan.
  for (const remote of remotePanes) {
    const tag = remote.tags.localPaneId;

    if (tag) {
      if (localIds.has(tag) && !matchedLocalIds.has(tag)) {
        matchedLocalIds.add(tag);
        continue;
      }
      // Stale (points at a vanished local) or duplicate (some other remote
      // already paired with this local). Either way, an orphan.
      orphanRemote.push({ localPaneId: tag, remotePaneId: remote.id });
      continue;
    }

    const pendingPaired = pending.remoteToLocal.get(remote.id);
    if (pendingPaired && localIds.has(pendingPaired) && !matchedLocalIds.has(pendingPaired)) {
      matchedLocalIds.add(pendingPaired);
      continue;
    }

    // Untagged with no pending fallback — orphan.
    orphanRemote.push({ remotePaneId: remote.id });
  }

  const unpairedLocal = localPanes.filter((p) => !matchedLocalIds.has(p.id)).map((p) => p.id);

  return { orphanRemote, unpairedLocal };
}

function tagDisplay(name: "local-pane-id" | "local-window-id", value: string): string {
  return `@hmx-${name}=${value}`;
}
