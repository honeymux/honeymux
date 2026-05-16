import { describe, expect, test } from "bun:test";

import type { MirrorSnapshot, SnapshotPane, SnapshotWindow } from "./snapshot.ts";

import { RoutingCache } from "./routing-cache.ts";

function makeLocalSnapshot(
  windows: ReadonlyArray<SnapshotWindow>,
  panes: Record<string, ReadonlyArray<SnapshotPane>>,
): MirrorSnapshot {
  return { panesByWindow: new Map(Object.entries(panes)), windows };
}

function makePane(id: string, windowId: string, remoteHost?: string, remotePaneId?: string): SnapshotPane {
  return { id, index: 0, tags: { remoteHost, remotePaneId }, windowId };
}

describe("RoutingCache", () => {
  test("rebuilds from snapshot tags for a single server", () => {
    const cache = new RoutingCache();
    const snapshot = makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
      "@1": [
        makePane("%10", "@1", "dev-box", "%200"),
        makePane("%11", "@1"), // local-only
        makePane("%12", "@1", "dev-box", "%201"),
      ],
    });

    cache.rebuildForServer("dev-box", snapshot);

    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    expect(cache.lookup("%11")).toBeUndefined();
    expect(cache.lookup("%12")).toEqual({ localPaneId: "%12", remotePaneId: "%201", serverName: "dev-box" });
    expect(cache.findLocalForRemote("dev-box", "%200")).toBe("%10");
    expect(cache.findLocalForRemote("dev-box", "%201")).toBe("%12");
  });

  test("scopes bindings by server: rebuilding one server does not affect others", () => {
    const cache = new RoutingCache();
    cache.rebuildForServer(
      "server-a",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "server-a", "%200")],
      }),
    );
    cache.rebuildForServer(
      "server-b",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%11", "@1", "server-b", "%300")],
      }),
    );

    // Server-a still bound after server-b rebuild.
    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%200", serverName: "server-a" });
    expect(cache.lookup("%11")).toEqual({ localPaneId: "%11", remotePaneId: "%300", serverName: "server-b" });

    // findLocalForRemote is server-scoped even with matching remote ids.
    cache.rebuildForServer(
      "server-c",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%20", "@1", "server-c", "%200")],
      }),
    );
    expect(cache.findLocalForRemote("server-a", "%200")).toBe("%10");
    expect(cache.findLocalForRemote("server-c", "%200")).toBe("%20");
  });

  test("rebuildForServer drops bindings absent from the new snapshot", () => {
    const cache = new RoutingCache();
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-box", "%200"), makePane("%11", "@1", "dev-box", "%201")],
      }),
    );
    expect(cache.lookup("%10")).toBeDefined();
    expect(cache.lookup("%11")).toBeDefined();

    // %11 reverted: no longer carries the tags.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-box", "%200"), makePane("%11", "@1")],
      }),
    );

    expect(cache.lookup("%10")).toBeDefined();
    expect(cache.lookup("%11")).toBeUndefined();
  });

  test("register survives rebuild until disposer is called", () => {
    const cache = new RoutingCache();
    // No snapshot data — register installs the binding eagerly.
    const release = cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    expect(cache.lookup("%10")).toBeDefined();

    // Rebuild for an empty snapshot: registration survives.
    cache.rebuildForServer("dev-box", makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], { "@1": [] }));
    expect(cache.lookup("%10")).toBeDefined();

    // Release the hold; the next rebuild drops it.
    release();
    cache.rebuildForServer("dev-box", makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], { "@1": [] }));
    expect(cache.lookup("%10")).toBeUndefined();
  });

  test("activeRemotePaneIds returns the set bound to a specific server", () => {
    const cache = new RoutingCache();
    cache.rebuildForServer(
      "dev-a",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-a", "%200"), makePane("%11", "@1", "dev-a", "%201")],
      }),
    );
    cache.rebuildForServer(
      "dev-b",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%20", "@1", "dev-b", "%300")],
      }),
    );

    const setA = cache.activeRemotePaneIds("dev-a");
    expect(setA).toEqual(new Set(["%200", "%201"]));
    expect(cache.activeRemotePaneIds("dev-b")).toEqual(new Set(["%300"]));
    expect(cache.activeRemotePaneIds("server-missing")).toEqual(new Set());
  });

  test("delete removes a binding from both directions", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    cache.delete("%10");

    expect(cache.lookup("%10")).toBeUndefined();
    expect(cache.findLocalForRemote("dev-box", "%200")).toBeUndefined();
  });

  test("clear wipes all servers' bindings", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-a" });
    cache.register({ localPaneId: "%11", remotePaneId: "%300", serverName: "dev-b" });

    cache.clear();

    expect(cache.lookup("%10")).toBeUndefined();
    expect(cache.lookup("%11")).toBeUndefined();
  });

  test("register is a structural no-op for an identical existing binding", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    // Counting through entries() should yield exactly one tuple.
    expect([...cache.entries()]).toHaveLength(1);
  });

  test("re-pointing a local pane to a new remote evicts the stale reverse-index entry", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    cache.register({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });

    expect(cache.findLocalForRemote("dev-box", "%201")).toBe("%10");
    // The old reverse mapping must NOT survive — otherwise pane-output
    // events for %200 (which no longer exists locally) would misroute.
    expect(cache.findLocalForRemote("dev-box", "%200")).toBeUndefined();
  });

  test("re-pointing a remote pane to a new local evicts the stale forward-index entry", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    cache.register({ localPaneId: "%11", remotePaneId: "%200", serverName: "dev-box" });

    expect(cache.lookup("%11")).toEqual({ localPaneId: "%11", remotePaneId: "%200", serverName: "dev-box" });
    expect(cache.lookup("%10")).toBeUndefined();
    expect(cache.findLocalForRemote("dev-box", "%200")).toBe("%11");
  });

  test("pending registrations auto-retire when the snapshot has caught up to them", () => {
    const cache = new RoutingCache();
    const release = cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    // Snapshot now contains the same binding as the pending entry.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-box", "%200")],
      }),
    );

    // Even after releasing the (no-op-now) disposer, the binding survives
    // via the snapshot path...
    release();
    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    // ...and a subsequent rebuild that drops the tag drops the binding
    // entirely (no stale pending re-application).
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1")],
      }),
    );
    expect(cache.lookup("%10")).toBeUndefined();
  });

  test("updateIfBound remaps an existing binding without dangling the old reverse-index entry", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    cache.updateIfBound({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });
    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });
    expect(cache.findLocalForRemote("dev-box", "%200")).toBeUndefined();
    expect(cache.findLocalForRemote("dev-box", "%201")).toBe("%10");
  });

  test("updateIfBound on a snapshot-only binding (no register hold) leaves the cache snapshot-driven", () => {
    const cache = new RoutingCache();
    // Establish a binding solely via snapshot (no register).
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-box", "%200")],
      }),
    );
    cache.updateIfBound({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });
    expect(cache.lookup("%10")?.remotePaneId).toBe("%201");

    // Rebuild from a snapshot where %10 no longer carries the tag.
    // Because there was no register() hold, no pending entry to re-apply.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], { "@1": [makePane("%10", "@1")] }),
    );
    expect(cache.lookup("%10")).toBeUndefined();
  });

  test("updateIfBound is a no-op when no prior binding exists", () => {
    const cache = new RoutingCache();
    cache.updateIfBound({ localPaneId: "%99", remotePaneId: "%999", serverName: "dev-box" });
    expect(cache.lookup("%99")).toBeUndefined();
  });

  test("cross-server remap evicts the stale per-server reverse-index entry", () => {
    // Same remotePaneId, different server. Prior fix only checked remotePaneId
    // inequality and missed this case.
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "server-a" });
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "server-b" });

    expect(cache.findLocalForRemote("server-b", "%200")).toBe("%10");
    expect(cache.findLocalForRemote("server-a", "%200")).toBeUndefined();
  });

  test("isPending tracks pending registrations and auto-clears when the snapshot catches up", () => {
    const cache = new RoutingCache();
    expect(cache.isPending("%10")).toBe(false);

    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });
    expect(cache.isPending("%10")).toBe(true);

    // Rebuild from a snapshot whose tags have NOT yet caught up: pending stays.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], { "@1": [makePane("%10", "@1")] }),
    );
    expect(cache.isPending("%10")).toBe(true);

    // Rebuild from a snapshot whose tags HAVE caught up: pending auto-retires.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], {
        "@1": [makePane("%10", "@1", "dev-box", "%200")],
      }),
    );
    expect(cache.isPending("%10")).toBe(false);
  });

  test("updateIfBound's pending sync survives the next rebuildForServer (no revert to the original register)", () => {
    const cache = new RoutingCache();
    cache.register({ localPaneId: "%10", remotePaneId: "%200", serverName: "dev-box" });

    // Remap via updateIfBound — sync into pending too so a rebuild can't undo it.
    cache.updateIfBound({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });

    // Rebuild from a snapshot WITHOUT the @hmx-remote-* tags. The pending
    // hold still exists (the register's disposer was never called); it
    // should now point at %201, not the original %200.
    cache.rebuildForServer(
      "dev-box",
      makeLocalSnapshot([{ id: "@1", index: 0, layout: "x" }], { "@1": [makePane("%10", "@1")] }),
    );

    expect(cache.lookup("%10")).toEqual({ localPaneId: "%10", remotePaneId: "%201", serverName: "dev-box" });
    expect(cache.findLocalForRemote("dev-box", "%200")).toBeUndefined();
  });
});
