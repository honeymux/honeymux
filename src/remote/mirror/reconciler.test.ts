import { describe, expect, test } from "bun:test";

import type { Mutation, ReconcileInput } from "./reconciler.ts";
import type { MirrorSnapshot, SnapshotPane, SnapshotPaneTags, SnapshotWindow } from "./snapshot.ts";

import { EMPTY_PENDING_VIEW } from "./pending-mappings.ts";
import { reconcile } from "./reconciler.ts";

// ============================================================================
// Fixture helpers
// ============================================================================

interface SnapshotInit {
  panesByWindow: Record<string, ReadonlyArray<SnapshotPane>>;
  windows: ReadonlyArray<SnapshotWindow>;
}

function baseInput(overrides: Partial<ReconcileInput>): ReconcileInput {
  return {
    activeBindings: new Map(),
    hasReconciledBefore: false,
    lastAppliedLayoutByRemoteWindow: new Map(),
    local: makeSnapshot({ panesByWindow: {}, windows: [] }),
    pending: EMPTY_PENDING_VIEW,
    remote: makeSnapshot({ panesByWindow: {}, windows: [] }),
    serverName: "dev-box",
    ...overrides,
  };
}

function makePane(id: string, index: number, windowId: string, tags: SnapshotPaneTags = {}): SnapshotPane {
  return { id, index, tags, windowId };
}

function makeSnapshot(init: SnapshotInit): MirrorSnapshot {
  return {
    panesByWindow: new Map(Object.entries(init.panesByWindow)),
    windows: init.windows,
  };
}

function makeWindow(id: string, index: number, layout = "fakelayout", localWindowId?: string): SnapshotWindow {
  return { id, index, layout, localWindowId };
}

function mutationsOfKind<K extends Mutation["kind"]>(
  plan: { mutations: ReadonlyArray<Mutation> },
  kind: K,
): Array<Extract<Mutation, { kind: K }>> {
  return plan.mutations.filter((m): m is Extract<Mutation, { kind: K }> => m.kind === kind);
}

// ============================================================================
// Cases ported from mirror-layout.test.ts
// ============================================================================

describe("reconciler — ported mirror-layout cases", () => {
  test("full sync creates remote windows for every local window and drops untagged stale windows", () => {
    const input = baseInput({
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1")],
          "@2": [makePane("%20", 0, "@2"), makePane("%21", 1, "@2"), makePane("%22", 2, "@2")],
        },
        windows: [makeWindow("@1", 0, "layout1"), makeWindow("@2", 1, "layout2")],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100")] },
        windows: [makeWindow("@100", 0, "remotelayout")],
      }),
    });

    const plan = reconcile(input);

    // Local @1, @2 both need new remote windows.
    expect(mutationsOfKind(plan, "create-window")).toEqual([
      { initialLocalPaneId: "%10", initialPaneIsRemoteBacked: false, kind: "create-window", localWindowId: "@1" },
      { initialLocalPaneId: "%20", initialPaneIsRemoteBacked: false, kind: "create-window", localWindowId: "@2" },
    ]);
    // The stale untagged remote @100 must be killed.
    expect(mutationsOfKind(plan, "kill-window")).toEqual([{ kind: "kill-window", remoteWindowId: "@100" }]);
    // First sync — bootstrap window doesn't warn.
    expect(plan.warnings).toEqual([]);
  });

  test("create-window for a single local window with one pane", () => {
    const input = baseInput({
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "create-window")).toEqual([
      { initialLocalPaneId: "%10", initialPaneIsRemoteBacked: false, kind: "create-window", localWindowId: "@1" },
    ]);
  });

  test("simple split-then-close removes the orphan remote pane", () => {
    // After a split: local has %10, %11; remote has paired %200 + stale %201.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0, "bbbb,80x24,0,0,10")],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100", { localPaneId: "%11" }),
          ],
        },
        windows: [makeWindow("@100", 0, "remote-bbbb", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%201" },
    ]);
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
    expect(mutationsOfKind(plan, "create-window")).toEqual([]);
  });

  test("onWindowClose skips remote teardown when local window still exists (spurious %window-close)", () => {
    // tmux can spuriously fire %window-close when winlinks shuffle (e.g.
    // agent zoom overlay). The reconciler must observe the local snapshot
    // as truth: if local @1 still exists, the remote pair must stay.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "remote-layout", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-window")).toEqual([]);
  });

  test("kills remote window when its paired local window is gone", () => {
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({ panesByWindow: {}, windows: [] }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-window")).toEqual([{ kind: "kill-window", remoteWindowId: "@100" }]);
    // Stale-tag warning fires after first sync.
    expect(plan.warnings).toEqual([
      expect.objectContaining({ kind: "stale-tag-window", remoteWindowId: "@100", staleTagValue: "@1" }),
    ]);
  });

  test("onWindowAdd is idempotent for an already-mapped local window", () => {
    // After local @1 mirrored to remote @100, a spurious %window-add for
    // @1 must NOT create a duplicate remote window.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "y", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "create-window")).toEqual([]);
    expect(mutationsOfKind(plan, "kill-window")).toEqual([]);
  });

  test("recovers pane mappings from @hmx-local-pane-id tags even when remote pane order diverges", () => {
    // Storage order intentionally diverges from local. Tags drive pairing.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1"), makePane("%12", 2, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%202", 0, "@100", { localPaneId: "%12" }),
            makePane("%201", 1, "@100", { localPaneId: "%11" }),
            makePane("%200", 2, "@100", { localPaneId: "%10" }),
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    // All locals paired by tag; no splits, no kills.
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([]);
    // panePairs follows the tags, not snapshot order, so remotePaneFor() can
    // resolve each local pane to its true remote peer.
    expect(plan.panePairs.get("%10")).toBe("%200");
    expect(plan.panePairs.get("%11")).toBe("%201");
    expect(plan.panePairs.get("%12")).toBe("%202");
  });

  test("exposes panePairs for an untagged phantom so an un-converted pane resolves to its remote peer", () => {
    // The mirror pre-creates an untagged remote phantom for every local pane,
    // including un-converted ones (no @hmx-remote-host for this server). The
    // convert-to-remote readiness check reads mirror.remotePaneFor(), built
    // from plan.panePairs — so the phantom MUST be paired here by order even
    // though it carries no tag. Regression (81d8b4b): phantom tagging was
    // removed but the pairing was not surfaced, leaving un-converted panes
    // stuck on "Convert to remote (please wait)" forever.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100")] }, // untagged phantom
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.panePairs.get("%10")).toBe("%200");
    // No churn: the untagged phantom is neither killed nor re-split.
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([]);
  });

  test("a converted (remote-backed) pane pairs by its committed tag, not positionally", () => {
    // After convertPane claims the phantom (set-option @hmx-local-pane-id) the
    // local pane becomes remote-backed. Positional phantom pairing covers only
    // local-only panes, so the converted pane MUST keep pairing to its remote
    // peer by identity — otherwise the reconciler would read it as unpaired,
    // split a second remote pane, and orphan the one the proxy is bound to.
    const input = baseInput({
      activeBindings: new Map([["%200", "%10"]]),
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1", { remoteHost: "dev-box", remotePaneId: "%200" })] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.panePairs.get("%10")).toBe("%200");
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([]);
  });

  test("emits split-window for a new local pane after a local split", () => {
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1")],
        },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "split-window")).toEqual([
      { isRemoteBacked: false, kind: "split-window", localPaneId: "%11", remoteWindowId: "@100" },
    ]);
  });

  test("skips apply-layout when the layout string matches the last applied and the pane set is stable", () => {
    const layout = "aaaa,80x24,0,0,200";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map([["@100", layout]]),
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "apply-layout")).toEqual([]);
  });

  test("re-applies select-layout after a split mutates the pane set, even when the layout string matches the last applied", () => {
    const layout = "aaaa,80x24,0,0,200";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map([["@100", layout]]),
      local: makeSnapshot({
        // local just split: 2 panes
        panesByWindow: { "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1")] },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "split-window")).toHaveLength(1);
    expect(mutationsOfKind(plan, "apply-layout")).toEqual([{ kind: "apply-layout", layout, remoteWindowId: "@100" }]);
  });

  test("forces apply-layout when lastApplied is absent (cache invalidated externally)", () => {
    // Equivalent to MirrorLayoutManager.invalidateLayoutForLocalWindow — when
    // the executor clears the cache entry (e.g. after a respawn-pane that
    // reset content) the next reconcile must re-apply the layout to nudge
    // tmux to flush the updated content to subscribers.
    const layout = "aaaa,80x24,0,0,200";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map(),
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "apply-layout")).toEqual([{ kind: "apply-layout", layout, remoteWindowId: "@100" }]);
  });

  test("reorders remote panes (and forces apply-layout) when their index order doesn't match local", () => {
    // tmux assigns layout cells to panes by index, so the remote panes must be
    // ordered to mirror the local pane order. Here the remote panes mirror the
    // locals in a rotated order; the reconciler must swap them back into place.
    const layout = "aaaa,80x24,0,0,10";
    const input = baseInput({
      hasReconciledBefore: true,
      // Layout already applied — so apply-layout fires only because of the swaps.
      lastAppliedLayoutByRemoteWindow: new Map([["@100", layout]]),
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1"), makePane("%12", 2, "@1")],
        },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%12" }),
            makePane("%201", 1, "@100", { localPaneId: "%10" }),
            makePane("%202", 2, "@100", { localPaneId: "%11" }),
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    // Desired order [%201, %202, %200] from current [%200, %201, %202].
    expect(mutationsOfKind(plan, "swap-pane")).toEqual([
      { kind: "swap-pane", remoteWindowId: "@100", sourcePaneId: "%200", targetPaneId: "%201" },
      { kind: "swap-pane", remoteWindowId: "@100", sourcePaneId: "%200", targetPaneId: "%202" },
    ]);
    // The reorder forces a re-apply so the now-correctly-ordered panes get
    // their cells, and the swaps must precede the layout.
    expect(mutationsOfKind(plan, "apply-layout")).toHaveLength(1);
    const kinds = plan.mutations.map((m) => m.kind);
    expect(kinds.lastIndexOf("swap-pane")).toBeLessThan(kinds.indexOf("apply-layout"));
  });

  test("emits no swap-pane when the remote pane order already matches local", () => {
    const layout = "aaaa,80x24,0,0,10";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map([["@100", layout]]),
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1"), makePane("%12", 2, "@1")],
        },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100", { localPaneId: "%11" }),
            makePane("%202", 2, "@100", { localPaneId: "%12" }),
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "swap-pane")).toEqual([]);
    // Order already correct and layout unchanged — nothing to do.
    expect(mutationsOfKind(plan, "apply-layout")).toEqual([]);
  });

  test("defers reorder while a split is still pending (pane set not yet settled)", () => {
    const layout = "aaaa,80x24,0,0,10";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map([["@100", layout]]),
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1")],
        },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        // Only one of the two local panes is mirrored yet — a split is pending.
        panesByWindow: { "@100": [makePane("%201", 0, "@100", { localPaneId: "%11" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "split-window")).toHaveLength(1);
    expect(mutationsOfKind(plan, "swap-pane")).toEqual([]);
  });

  test("warns on an untagged pane that appears in an established mirror window", () => {
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%999", 1, "@100"), // untagged intruder
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.warnings).toEqual([
      expect.objectContaining({
        kind: "untagged-remote-pane",
        remotePaneId: "%999",
        remoteWindowId: "@100",
      }),
    ]);
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([{ kind: "kill-pane", reason: "orphan", remotePaneId: "%999" }]);
  });

  test("does NOT warn for the bootstrap default window on first sync", () => {
    const input = baseInput({
      hasReconciledBefore: false,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100")] }, // untagged bootstrap
        windows: [makeWindow("@100", 0)],
      }),
    });

    const plan = reconcile(input);

    expect(plan.warnings).toEqual([]);
    // The bootstrap window is still scheduled for removal; just no warning.
    expect(mutationsOfKind(plan, "kill-window")).toEqual([{ kind: "kill-window", remoteWindowId: "@100" }]);
  });

  test("warns on a stale-tagged remote window after we've established mirror state", () => {
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })],
          "@101": [makePane("%201", 0, "@101")], // stale-window-tag below
        },
        // @101 has a tag pointing at @99, which no longer exists locally.
        windows: [makeWindow("@100", 0, "x", "@1"), makeWindow("@101", 1, "y", "@99")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.warnings).toEqual([
      expect.objectContaining({
        kind: "stale-tag-window",
        remoteWindowId: "@101",
        staleTagValue: "@99",
      }),
    ]);
    expect(mutationsOfKind(plan, "kill-window")).toEqual([{ kind: "kill-window", remoteWindowId: "@101" }]);
  });

  test("close after split-induced index shuffle kills the orphan, not the active mirror", () => {
    // Local @1 has %0, %1; remote has %11(→%0), %13(→stale %2), %12(→%1).
    // %13's local target vanished; %12 is the active proxy peer for local %1.
    const input = baseInput({
      activeBindings: new Map([
        ["%11", "%0"],
        ["%12", "%1"],
      ]),
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%0", 0, "@1"), makePane("%1", 1, "@1")] },
        windows: [makeWindow("@1", 0, "ef09,136x46,0,0{68x46,0,0,0,67x46,69,0,1}")],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%11", 0, "@100", { localPaneId: "%0" }),
            makePane("%13", 1, "@100", { localPaneId: "%2" }),
            makePane("%12", 2, "@100", { localPaneId: "%1" }),
          ],
        },
        windows: [makeWindow("@100", 0, "remote-layout", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%13" },
    ]);
    // %11 and %12 must survive: both are paired with their respective
    // local panes in @1, so the active-proxy guard isn't even hit for them.
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
  });
});

// ============================================================================
// New fixtures the original test file did not cover
// ============================================================================

describe("reconciler — additional invariants", () => {
  test("is idempotent: applying a plan brings remote into agreement, and re-reconciling yields an empty plan", () => {
    // Start: local has @1[%10]; remote is empty.
    const local = makeSnapshot({
      panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
      windows: [makeWindow("@1", 0, "aaaa,80x24,0,0,10")],
    });
    let remote = makeSnapshot({ panesByWindow: {}, windows: [] });

    // First reconcile: should propose create-window.
    const firstPlan = reconcile(baseInput({ local, remote }));
    expect(mutationsOfKind(firstPlan, "create-window")).toHaveLength(1);

    // Simulate execution: remote now has the paired window/pane and the layout cache is populated.
    remote = makeSnapshot({
      panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })] },
      windows: [makeWindow("@100", 0, local.windows[0]!.layout, "@1")],
    });
    const lastApplied = new Map([["@100", local.windows[0]!.layout]]);

    // Second reconcile: nothing left to do.
    const secondPlan = reconcile(
      baseInput({
        hasReconciledBefore: true,
        lastAppliedLayoutByRemoteWindow: lastApplied,
        local,
        remote,
      }),
    );
    expect(secondPlan.mutations).toEqual([]);
    expect(secondPlan.warnings).toEqual([]);
  });

  test("kill-pane precedes apply-layout when an extra stale pane is present and the desired layout has fewer panes", () => {
    // Local has 1 pane; remote has the paired pane + 1 stale orphan. The
    // ordering contract is `... split → kill-pane → apply-layout ...`: tmux's
    // select-layout rejects with "have N panes but need M" when the live
    // pane count doesn't match the layout's encoded count, so the orphan
    // MUST be killed first. Splits are immediately tagged in the executor,
    // so the cleanup phase cannot misclassify them.
    const layout = "aaaa,80x24,0,0,10";
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map(),
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0, layout)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100"), // untagged orphan
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    const kinds = plan.mutations.map((m) => m.kind);
    const applyIdx = kinds.indexOf("apply-layout");
    const killIdx = kinds.indexOf("kill-pane");
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(applyIdx).toBeGreaterThan(killIdx);
  });

  test("treats duplicate tags deterministically: first by snapshot order wins, others marked stale", () => {
    // Two remote panes carry @hmx-local-pane-id=%10. Pair the first one
    // (in snapshot iteration order) and treat the rest as stale-tag
    // orphans. Snapshot order mirrors tmux's list-panes output order so
    // the choice is reproducible.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100", { localPaneId: "%10" }), // duplicate tag
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%201" },
    ]);
    // No splits — %200 paired %10 deterministically; %201 is the dupe.
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
  });

  test("windowPairs names the surviving window on duplicate window tags (first-wins)", () => {
    // Two remote windows both tagged @hmx-local-window-id=@1. The reconciler
    // pairs the first and kills the second; windowPairs must name the SAME
    // (surviving) window so remoteWindowFor() can't return the doomed dupe.
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })],
          "@101": [makePane("%201", 0, "@101", { localPaneId: "%10" })],
        },
        windows: [makeWindow("@100", 0, "x", "@1"), makeWindow("@101", 1, "y", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.windowPairs.get("@1")).toBe("@100");
    expect(mutationsOfKind(plan, "kill-window")).toEqual([{ kind: "kill-window", remoteWindowId: "@101" }]);
  });

  test("treats stale tags pointing at vanished local panes as orphans", () => {
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] }, // %99 vanished
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100", { localPaneId: "%99" }), // stale
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%201" },
    ]);
    expect(plan.warnings).toEqual([
      expect.objectContaining({ kind: "stale-tag-pane", remotePaneId: "%201", staleTagValue: "%99" }),
    ]);
  });

  test("pending overlay: in-flight split is paired even when the remote tag has not yet been committed", () => {
    // Mid-convertPane: split-window returned %201 for local %11, but the
    // `set-option @hmx-local-pane-id=%11` has not yet ACKed. If a
    // %layout-change arrives now, the reconciler must NOT mark %201 as
    // orphan.
    const pendingLocalToRemote = new Map([["%11", "%201"]]);
    const pendingRemoteToLocal = new Map([["%201", "%11"]]);
    const input = baseInput({
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      pending: Object.freeze({
        localToRemote: pendingLocalToRemote,
        remoteToLocal: pendingRemoteToLocal,
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100"), // tag not yet committed
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([]);
    expect(mutationsOfKind(plan, "split-window")).toEqual([]);
    // No warning either — pending pairing is a known mid-mutation state.
    expect(plan.warnings).toEqual([]);
  });

  test("active-pane guard protects only the genuine proxy peer, not duplicate-tagged interlopers", () => {
    // Local @1[%10] has a live proxy talking to remote %200.
    // activeBindings names the %200 → %10 pairing. A duplicate-tagged
    // interloper %201 (same stale @hmx-local-pane-id=%10) is still an
    // orphan and must be killed: %201 is not the proxy peer, and leaving
    // it alive lets duplicates accumulate indefinitely.
    const input = baseInput({
      activeBindings: new Map([["%200", "%10"]]),
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%201", 1, "@100", { localPaneId: "%10" }), // duplicate
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    // %200 (active peer) survives; %201 (duplicate interloper) gets killed.
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%201" },
    ]);
  });

  test("phase ordering is global, not per-window: ALL splits precede ALL pane kills which precede ALL apply-layouts", () => {
    // Window @1 needs a split (%11 new); window @2 needs an apply-layout +
    // an orphan kill. The contract guarantees: split-window for @1 fires
    // BEFORE kill-pane for @2, which fires BEFORE apply-layout for @2 —
    // because select-layout rejects layouts that don't match the live
    // pane count, so the orphan kill must precede the layout application.
    const input = baseInput({
      hasReconciledBefore: true,
      lastAppliedLayoutByRemoteWindow: new Map(),
      local: makeSnapshot({
        panesByWindow: {
          "@1": [makePane("%10", 0, "@1"), makePane("%11", 1, "@1")],
          "@2": [makePane("%20", 0, "@2")],
        },
        windows: [makeWindow("@1", 0, "layout-1"), makeWindow("@2", 1, "layout-2")],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [makePane("%200", 0, "@100", { localPaneId: "%10" })],
          "@200": [
            makePane("%300", 0, "@200", { localPaneId: "%20" }),
            makePane("%301", 1, "@200"), // orphan
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1"), makeWindow("@200", 1, "y", "@2")],
      }),
    });

    const plan = reconcile(input);
    const kinds = plan.mutations.map((m) => m.kind);

    const firstSplit = kinds.indexOf("split-window");
    const lastSplit = kinds.lastIndexOf("split-window");
    const firstKill = kinds.indexOf("kill-pane");
    const lastKill = kinds.lastIndexOf("kill-pane");
    const firstApply = kinds.indexOf("apply-layout");

    expect(firstSplit).toBeGreaterThanOrEqual(0);
    expect(lastSplit).toBeLessThan(firstKill);
    expect(firstKill).toBeGreaterThanOrEqual(0);
    expect(lastKill).toBeLessThan(firstApply);
  });

  test("stale-tag warnings fire on first sync (evidence of an interrupted prior session)", () => {
    // Reconnecting to a Honeymux remote that previously synced and then
    // crashed: tags survive across SSH restarts. The bootstrap-window
    // exemption is specifically about untagged artifacts; tagged-stale
    // artifacts are meaningful diagnostics on first sync too.
    const input = baseInput({
      hasReconciledBefore: false,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%99" })] },
        windows: [makeWindow("@100", 0, "x", "@99")], // stale window-tag
      }),
    });

    const plan = reconcile(input);

    expect(plan.warnings).toEqual([expect.objectContaining({ kind: "stale-tag-window", staleTagValue: "@99" })]);
  });

  test("stale-tag-pane warning fires on first sync too", () => {
    const input = baseInput({
      hasReconciledBefore: false,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%200", 0, "@100", { localPaneId: "%10" }),
            makePane("%999", 1, "@100", { localPaneId: "%88" }), // stale, in a tagged window
          ],
        },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(plan.warnings).toEqual([
      expect.objectContaining({ kind: "stale-tag-pane", remotePaneId: "%999", staleTagValue: "%88" }),
    ]);
  });

  test("active-pane guard suppresses kill for a stale-tagged orphan that IS the active proxy peer", () => {
    // After tmux on the remote restarted the pane's shell (respawn-pane),
    // the @hmx-local-pane-id tag remained but now points at a vanished
    // local id. The orphan IS the active peer per the executor's record
    // of @hmx-remote-pane on local panes (activeBindings has %200 → %10),
    // and %10 is in the paired local window — do not kill.
    const input = baseInput({
      activeBindings: new Map([["%200", "%10"]]),
      hasReconciledBefore: true,
      local: makeSnapshot({
        panesByWindow: { "@1": [makePane("%10", 0, "@1")] },
        windows: [makeWindow("@1", 0)],
      }),
      remote: makeSnapshot({
        panesByWindow: { "@100": [makePane("%200", 0, "@100", { localPaneId: "%99" })] },
        windows: [makeWindow("@100", 0, "x", "@1")],
      }),
    });

    const plan = reconcile(input);

    expect(mutationsOfKind(plan, "kill-pane")).toEqual([]);
  });

  test("active-pane guard does NOT protect an orphan whose owner local pane is in a different window", () => {
    // Regression for the "moved pane" bug: local %10 was originally
    // converted to remote %200 in mirror window @100 (paired with local
    // @1). The user then moved %10 to local @2 (e.g. via move-pane).
    // The reconciler ran for @2's mirror and split a new remote pane
    // %300 there; %10's @hmx-remote-pane on the local side has not been
    // refreshed yet, so activeBindings still has %200 → %10.
    //
    // When reconcile runs for local @1, remote %200 is an orphan in
    // @100. The window-blind guard would protect %200 (its id is in
    // activeBindings) and apply-layout would then fail forever with
    // "have 2 panes but need 1". The window-aware guard sees that %10
    // is in @2's local panes, NOT @1's, so it allows the kill.
    const input = baseInput({
      activeBindings: new Map([["%200", "%10"]]),
      hasReconciledBefore: true,
      local: makeSnapshot({
        // %10 currently lives in @2, not @1.
        panesByWindow: {
          "@1": [makePane("%11", 0, "@1")],
          "@2": [makePane("%10", 0, "@2")],
        },
        windows: [makeWindow("@1", 0, "aaaa,80x24,0,0,11"), makeWindow("@2", 1, "bbbb,80x24,0,0,10")],
      }),
      remote: makeSnapshot({
        panesByWindow: {
          "@100": [
            makePane("%150", 0, "@100", { localPaneId: "%11" }),
            // Stale orphan: %200's @hmx-local-pane-id=%10 from before
            // the move, but %10 is now in @2.
            makePane("%200", 1, "@100", { localPaneId: "%10" }),
          ],
          "@200": [makePane("%300", 0, "@200", { localPaneId: "%10" })],
        },
        windows: [makeWindow("@100", 0, "x", "@1"), makeWindow("@200", 1, "y", "@2")],
      }),
    });

    const plan = reconcile(input);

    // %200 MUST be killed despite the stale activeBindings entry —
    // otherwise apply-layout for @100 would fail with the wrong pane count.
    expect(mutationsOfKind(plan, "kill-pane")).toEqual([
      { kind: "kill-pane", reason: "stale-tag", remotePaneId: "%200" },
    ]);
  });
});
