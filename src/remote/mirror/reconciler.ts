import type { PendingView } from "./pending-mappings.ts";
import type { MirrorSnapshot, SnapshotPane, SnapshotWindow } from "./snapshot.ts";

export type KillPaneReason = "orphan" | "stale-tag";

export interface MirrorPlan {
  readonly mutations: ReadonlyArray<Mutation>;
  /**
   * Local-pane id → remote-pane id for every pane already paired in this
   * snapshot: tagged (converted) panes by identity, untagged phantom panes
   * positionally. The mirror feeds this straight into its pane index so
   * `remotePaneFor()` resolves un-converted panes — the convert-to-remote
   * readiness signal — without the executor having to tag phantoms (tagging
   * them churns the mirror when local-only panes swap windows).
   */
  readonly panePairs: ReadonlyMap<string, string>;
  readonly warnings: ReadonlyArray<MirrorWarning>;
  /**
   * Local-window id → remote-window id for every window paired in this
   * snapshot. The mirror feeds this into its window index so
   * `remoteWindowFor()` agrees with the reconciler's first-wins pairing — an
   * index that re-derived this from `@hmx-local-window-id` tags independently
   * could pick a different (last-wins) duplicate the reconciler is killing.
   */
  readonly windowPairs: ReadonlyMap<string, string>;
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
  | {
      /** See {@link Mutation} create-window's `initialPaneIsRemoteBacked`. */
      isRemoteBacked: boolean;
      kind: "split-window";
      localPaneId: string;
      remoteWindowId: string;
    }
  | {
      initialLocalPaneId: string;
      /**
       * True when the initial pane should be tagged with `@hmx-local-pane-id`.
       * False for layout-only phantom panes mirroring a local-only pane —
       * those carry no routing identity and don't need (and shouldn't have) a
       * tag that would invalidate when local-only panes swap windows.
       */
      initialPaneIsRemoteBacked: boolean;
      kind: "create-window";
      localWindowId: string;
    }
  | { kind: "apply-layout"; layout: string; remoteWindowId: string }
  | { kind: "kill-pane"; reason: KillPaneReason; remotePaneId: string }
  | { kind: "kill-window"; remoteWindowId: string }
  | { kind: "swap-pane"; remoteWindowId: string; sourcePaneId: string; targetPaneId: string };

export interface ReconcileInput {
  /**
   * Current routing bindings keyed by remote pane id, with the bound local
   * pane id as the value. Derived from `@hmx-remote-pane` on local panes.
   *
   * Used by the active-proxy guard: an orphan remote pane is protected
   * from kill ONLY when (a) some local pane is bound to it AND (b) that
   * local pane is in the local window currently being reconciled. The
   * window check is essential — without it, a remote pane whose bound
   * local pane has moved to a different window stays protected forever,
   * blocking `select-layout` for the original mirror window with "have N
   * panes but need M".
   *
   * A duplicate-tagged orphan in the SAME mirror window is still killed:
   * the binding maps remote → ONE local pane, so duplicate interlopers
   * are not in the map and fail the guard.
   */
  readonly activeBindings: ReadonlyMap<string, string>;
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
  /** Local-pane id → remote-pane id for every pane paired in this window. */
  pairs: ReadonlyMap<string, string>;
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
  // Local-pane id → remote-pane id, accumulated across all paired windows.
  // A local pane lives in exactly one window, so per-window merges never
  // collide. Surfaced on the plan so the mirror's pane index agrees with the
  // reconciler's pairing instead of re-deriving it from snapshot tags.
  const panePairs = new Map<string, string>();

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
    const initial = localPanes[0];
    if (!initial) continue;
    mutations.push({
      initialLocalPaneId: initial.id,
      initialPaneIsRemoteBacked: initial.tags.remoteHost === input.serverName,
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
  const swaps: Mutation[] = [];
  for (const localWindow of input.local.windows) {
    const remoteWindow = remoteWindowByLocalId.get(localWindow.id);
    if (!remoteWindow) continue;

    const localPanes = input.local.panesByWindow.get(localWindow.id) ?? [];
    const remotePanes = input.remote.panesByWindow.get(remoteWindow.id) ?? [];
    const pairing = pairPanes(localPanes, remotePanes, input.pending, input.serverName);
    for (const [localId, remoteId] of pairing.pairs) {
      panePairs.set(localId, remoteId);
    }

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

    const localById = new Map(localPanes.map((p) => [p.id, p]));
    for (const localId of pairing.unpairedLocal) {
      splits.push({
        isRemoteBacked: localById.get(localId)?.tags.remoteHost === input.serverName,
        kind: "split-window",
        localPaneId: localId,
        remoteWindowId: remoteWindow.id,
      });
    }

    const localIds = new Set(localPanes.map((p) => p.id));
    const desiredLayout = localWindow.layout;
    const lastApplied = input.lastAppliedLayoutByRemoteWindow.get(remoteWindow.id);
    const splitsHappening = pairing.unpairedLocal.length > 0;
    const killsHappening = pairing.orphanRemote.some((o) => {
      const owner = input.activeBindings.get(o.remotePaneId);
      return !owner || !localIds.has(owner);
    });

    // Reorder the remote panes to match the local pane order BEFORE the
    // positional select-layout below. tmux assigns layout cells to panes by
    // index — it ignores the pane ids in the layout string — so a mirror pane
    // only lands on its own cell when remote index k holds the pane mirroring
    // local index k. Panes converted incrementally, or reordered locally via
    // pane tabs, drift out of that order and scramble pane sizes. Only reorder
    // once the pane set is settled: while splits/kills are pending this
    // snapshot can't yet see the final pane set.
    let swapsHappening = false;
    if (!splitsHappening && !killsHappening && remotePanes.length > 1) {
      const currentOrder = [...remotePanes].sort((a, b) => a.index - b.index).map((p) => p.id);
      const desiredOrder = localPanes
        .map((p) => pairing.pairs.get(p.id))
        .filter((id): id is string => id !== undefined);
      if (desiredOrder.length === currentOrder.length) {
        const windowSwaps = computePaneSwaps(remoteWindow.id, currentOrder, desiredOrder);
        if (windowSwaps.length > 0) {
          swaps.push(...windowSwaps);
          swapsHappening = true;
        }
      }
    }

    // Apply when: layout changed, OR we mutated/reordered the pane set (which
    // invalidates any cached "no-op" judgment regardless of string equality).
    if (desiredLayout && (lastApplied !== desiredLayout || splitsHappening || killsHappening || swapsHappening)) {
      applyLayouts.push({ kind: "apply-layout", layout: desiredLayout, remoteWindowId: remoteWindow.id });
    }

    // Active-proxy guard. Protect an orphan ONLY when its owner local pane
    // (per the routing cache) is in THIS local window's pane list — the
    // genuine "live proxy is talking to this remote pane" case. If the
    // owner has been moved to a different local window, the binding is
    // stale: kill the orphan so apply-layout can succeed for this window.
    for (const orphan of pairing.orphanRemote) {
      const owner = input.activeBindings.get(orphan.remotePaneId);
      if (owner && localIds.has(owner)) continue;
      paneKills.push({
        kind: "kill-pane",
        reason: orphan.localPaneId ? "stale-tag" : "orphan",
        remotePaneId: orphan.remotePaneId,
      });
    }
  }

  mutations.push(...splits, ...paneKills, ...swaps, ...applyLayouts);

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

  const windowPairs = new Map<string, string>();
  for (const [localWindowId, remoteWindow] of remoteWindowByLocalId) {
    windowPairs.set(localWindowId, remoteWindow.id);
  }

  return { mutations, panePairs, warnings, windowPairs };
}

/**
 * Selection-sort `current` into `desired` with the minimum number of
 * `swap-pane` mutations. Each step swaps the pane at position k with the pane
 * that belongs there; the executor applies them in sequence, so the simulated
 * array tracks the running remote state. `current` and `desired` must be
 * permutations of the same id set.
 */
function computePaneSwaps(
  remoteWindowId: string,
  current: ReadonlyArray<string>,
  desired: ReadonlyArray<string>,
): Mutation[] {
  const swaps: Mutation[] = [];
  const arr = [...current];
  for (let k = 0; k < desired.length; k++) {
    const want = desired[k]!;
    if (arr[k] === want) continue;
    const j = arr.indexOf(want, k + 1);
    if (j === -1) continue;
    swaps.push({ kind: "swap-pane", remoteWindowId, sourcePaneId: arr[k]!, targetPaneId: want });
    [arr[k], arr[j]] = [arr[j]!, arr[k]!];
  }
  return swaps;
}

function pairPanes(
  localPanes: ReadonlyArray<SnapshotPane>,
  remotePanes: ReadonlyArray<SnapshotPane>,
  pending: PendingView,
  serverName: string,
): PanePairing {
  const localIds = new Set(localPanes.map((p) => p.id));
  const matchedLocalIds = new Set<string>();
  const pairs = new Map<string, string>();
  const taggedOrphans: { localPaneId: string; remotePaneId: string }[] = [];
  const untaggedRemotes: string[] = [];

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
        pairs.set(tag, remote.id);
        continue;
      }
      // Stale (points at a vanished local) or duplicate (some other remote
      // already paired with this local). Either way, an orphan.
      taggedOrphans.push({ localPaneId: tag, remotePaneId: remote.id });
      continue;
    }

    const pendingPaired = pending.remoteToLocal.get(remote.id);
    if (pendingPaired && localIds.has(pendingPaired) && !matchedLocalIds.has(pendingPaired)) {
      matchedLocalIds.add(pendingPaired);
      pairs.set(pendingPaired, remote.id);
      continue;
    }

    untaggedRemotes.push(remote.id);
  }

  // Phantom pairing: an untagged remote pane in a paired mirror window is
  // a layout-only placeholder for some local-only pane (one without
  // @hmx-remote-host pointing at this server). Match by order against
  // unpaired local-only panes so swap-pane between local windows — used
  // by pane-tabs — doesn't churn the mirror with split/kill cycles.
  const localOnlyUnpaired = localPanes.filter((p) => !matchedLocalIds.has(p.id) && p.tags.remoteHost !== serverName);
  const phantomPairs = Math.min(untaggedRemotes.length, localOnlyUnpaired.length);
  for (let i = 0; i < phantomPairs; i++) {
    matchedLocalIds.add(localOnlyUnpaired[i]!.id);
    pairs.set(localOnlyUnpaired[i]!.id, untaggedRemotes[i]!);
  }

  const orphanRemote: { localPaneId?: string; remotePaneId: string }[] = [
    ...taggedOrphans,
    ...untaggedRemotes.slice(phantomPairs).map((remotePaneId) => ({ remotePaneId })),
  ];
  const unpairedLocal = localPanes.filter((p) => !matchedLocalIds.has(p.id)).map((p) => p.id);

  return { orphanRemote, pairs, unpairedLocal };
}

function tagDisplay(name: "local-pane-id" | "local-window-id", value: string): string {
  return `@hmx-${name}=${value}`;
}
