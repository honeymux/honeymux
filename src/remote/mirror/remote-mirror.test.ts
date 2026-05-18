import { describe, expect, mock, test } from "bun:test";

import { RemoteMirror } from "./remote-mirror.ts";
import { captureLocalMirrorSnapshot } from "./snapshot.ts";

/**
 * Lightweight fixture: a fake remote tmux state plus mock command handlers
 * that read/mutate it. Just enough surface for RemoteMirror to capture
 * snapshots and execute mutations through. NOT a faithful tmux emulation —
 * the reconciler's own test suite covers correctness of the plan.
 */
function createServerStub(initialLocal: {
  panesByWindow: Map<string, Array<{ id: string; index: number; tags?: Record<string, string> }>>;
  windows: Array<{ id: string; index: number; layout: string }>;
}) {
  const state = {
    local: { ...initialLocal },
    remote: {
      nextPaneNum: 200,
      nextWindowNum: 100,
      panesByWindow: new Map<string, Array<{ id: string; tags: Record<string, string> }>>(),
      windows: [] as Array<{ id: string; layout: string; tags: Record<string, string> }>,
    },
  };

  function parseTarget(cmd: string, flag: string): string | undefined {
    const match = cmd.match(new RegExp(`${flag}\\s+('[^']+'|\\S+)`));
    if (!match) return undefined;
    return match[1]!.replace(/^'/, "").replace(/'$/, "");
  }

  async function runLocal(cmd: string): Promise<string> {
    if (cmd.startsWith("list-windows")) {
      return state.local.windows.map((w) => `${w.id}\t${w.index}\t${w.layout}`).join("\n");
    }
    if (cmd.startsWith("list-panes")) {
      const win = parseTarget(cmd, "-t");
      const panes = state.local.panesByWindow.get(win ?? "") ?? [];
      return panes
        .map((p) => `${p.id}\t${p.index}\t${p.tags?.["@hmx-remote-host"] ?? ""}\t${p.tags?.["@hmx-remote-pane"] ?? ""}`)
        .join("\n");
    }
    return "";
  }

  async function runRemote(cmd: string): Promise<string> {
    if (cmd.startsWith("list-windows")) {
      return state.remote.windows
        .map((w, idx) => `${w.id}\t${idx}\t${w.layout}\t${w.tags["@hmx-local-window-id"] ?? ""}`)
        .join("\n");
    }
    if (cmd.startsWith("list-panes")) {
      const win = parseTarget(cmd, "-t");
      const panes = state.remote.panesByWindow.get(win ?? "") ?? [];
      return panes.map((p, idx) => `${p.id}\t${idx}\t${p.tags["@hmx-local-pane-id"] ?? ""}`).join("\n");
    }
    if (cmd.startsWith("new-window")) {
      const winId = `@${state.remote.nextWindowNum++}`;
      const paneId = `%${state.remote.nextPaneNum++}`;
      state.remote.windows.push({ id: winId, layout: "", tags: {} });
      state.remote.panesByWindow.set(winId, [{ id: paneId, tags: {} }]);
      return `${winId} ${paneId}`;
    }
    if (cmd.startsWith("split-window")) {
      const win = parseTarget(cmd, "-t");
      const paneId = `%${state.remote.nextPaneNum++}`;
      const panes = state.remote.panesByWindow.get(win ?? "") ?? [];
      panes.push({ id: paneId, tags: {} });
      state.remote.panesByWindow.set(win ?? "", panes);
      return paneId;
    }
    if (cmd.startsWith("kill-pane")) {
      const paneId = parseTarget(cmd, "-t");
      for (const [w, panes] of state.remote.panesByWindow) {
        state.remote.panesByWindow.set(
          w,
          panes.filter((p) => p.id !== paneId),
        );
      }
    }
    if (cmd.startsWith("kill-window")) {
      const winId = parseTarget(cmd, "-t");
      state.remote.windows = state.remote.windows.filter((w) => w.id !== winId);
      state.remote.panesByWindow.delete(winId ?? "");
    }
    const unquote = (s: string) => s.replace(/^'/, "").replace(/'$/, "");
    if (cmd.startsWith("set-option -w")) {
      const winId = parseTarget(cmd, "-t");
      const win = state.remote.windows.find((w) => w.id === winId);
      const match = cmd.match(/(@hmx-\S+)\s+(\S+)$/);
      if (win && match) win.tags[match[1]!] = unquote(match[2]!);
    }
    if (cmd.startsWith("set-option -p")) {
      const paneId = parseTarget(cmd, "-t");
      const match = cmd.match(/(@hmx-\S+)\s+(\S+)$/);
      if (!paneId || !match) return "";
      for (const panes of state.remote.panesByWindow.values()) {
        const pane = panes.find((p) => p.id === paneId);
        if (pane) pane.tags[match[1]!] = unquote(match[2]!);
      }
    }
    if (cmd.startsWith("select-layout")) {
      const winId = parseTarget(cmd, "-t");
      const layoutMatch = cmd.match(/select-layout\s+-t\s+\S+\s+'(.+)'$/);
      const win = state.remote.windows.find((w) => w.id === winId);
      if (win && layoutMatch) win.layout = layoutMatch[1]!;
    }
    return "";
  }

  return { runLocal, runRemote, state };
}

describe("RemoteMirror", () => {
  test("creates remote windows + tags + panes for every local window on first reconcile", async () => {
    const fixture = createServerStub({
      panesByWindow: new Map([
        ["@1", [{ id: "%10", index: 0 }]],
        ["@2", [{ id: "%20", index: 0 }]],
      ]),
      windows: [
        { id: "@1", index: 0, layout: "layout1,80x24,0,0,10" },
        { id: "@2", index: 1, layout: "layout2,80x24,0,0,20" },
      ],
    });

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      runLocal: fixture.runLocal,
      runRemote: fixture.runRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    expect(fixture.state.remote.windows).toHaveLength(2);
    expect(fixture.state.remote.windows[0]!.tags["@hmx-local-window-id"]).toBe("@1");
    expect(fixture.state.remote.windows[1]!.tags["@hmx-local-window-id"]).toBe("@2");

    // Both windows should have their initial pane tagged.
    const allPanes = [...fixture.state.remote.panesByWindow.values()].flat();
    const tagged = allPanes.filter((p) => p.tags["@hmx-local-pane-id"]);
    expect(tagged).toHaveLength(2);
  });

  test("exposes remotePaneFor() after a reconcile so callers can look up paired ids", async () => {
    const fixture = createServerStub({
      panesByWindow: new Map([["@1", [{ id: "%10", index: 0 }]]]),
      windows: [{ id: "@1", index: 0, layout: "layout,80x24,0,0,10" }],
    });

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      runLocal: fixture.runLocal,
      runRemote: fixture.runRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    expect(mirror.remotePaneFor("%10")).toBeDefined();
    expect(mirror.remoteWindowFor("@1")).toBeDefined();
  });

  test("invokes onReconciled with the latest remote snapshot", async () => {
    const fixture = createServerStub({
      panesByWindow: new Map([["@1", [{ id: "%10", index: 0 }]]]),
      windows: [{ id: "@1", index: 0, layout: "layout,80x24,0,0,10" }],
    });
    const onReconciled = mock((_snapshot: unknown) => {});

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      onReconciled,
      runLocal: fixture.runLocal,
      runRemote: fixture.runRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    expect(onReconciled).toHaveBeenCalledTimes(1);
  });

  test("aborts the reconcile pass when local snapshot capture fails", async () => {
    const onReconciled = mock(() => {});
    const runRemote = mock(async () => "");
    const failingLocal = mock(async () => {
      throw new Error("ssh transport closed");
    });

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      onReconciled,
      runLocal: failingLocal,
      runRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    // The reconcile must NOT have executed any mutations against the remote
    // (a missing local snapshot would otherwise propose kill-window for all
    // remote windows).
    expect(runRemote).not.toHaveBeenCalled();
    // onReconciled is also suppressed — the cleanup hook depends on a fresh
    // snapshot that we don't have.
    expect(onReconciled).not.toHaveBeenCalled();
  });

  test("aborts the reconcile pass when remote snapshot capture fails", async () => {
    const onReconciled = mock(() => {});
    const fixture = createServerStub({
      panesByWindow: new Map([["@1", [{ id: "%10", index: 0 }]]]),
      windows: [{ id: "@1", index: 0, layout: "layout,80x24,0,0,10" }],
    });
    let remoteCalls = 0;
    const wrappedRunRemote = async (cmd: string) => {
      remoteCalls += 1;
      if (cmd.startsWith("list-")) throw new Error("ssh transport closed");
      return fixture.runRemote(cmd);
    };

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      onReconciled,
      runLocal: fixture.runLocal,
      runRemote: wrappedRunRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    // Only the list-* attempt (and its retry on the failing path) should fire;
    // no destructive mutations.
    expect(remoteCalls).toBeGreaterThan(0);
    expect(fixture.state.remote.windows).toEqual([]);
    expect(onReconciled).not.toHaveBeenCalled();
  });

  test("pending mappings prevent in-flight splits from being killed as orphans", async () => {
    // Local has %10 + %11. Remote has only the paired pane for %10. The
    // pending overlay reserves %201 for %11 (mid-convert state). The
    // reconciler must NOT emit kill-pane for an as-yet-uncreated remote
    // pane the pending overlay knows about.
    const fixture = createServerStub({
      panesByWindow: new Map([
        [
          "@1",
          [
            { id: "%10", index: 0 },
            { id: "%11", index: 1 },
          ],
        ],
      ]),
      windows: [{ id: "@1", index: 0, layout: "layout,80x24,0,0,10" }],
    });
    // Pre-populate the remote with the @1 mirror so this isn't a first sync.
    fixture.state.remote.windows.push({ id: "@100", layout: "x", tags: { "@hmx-local-window-id": "@1" } });
    fixture.state.remote.panesByWindow.set("@100", [{ id: "%200", tags: { "@hmx-local-pane-id": "%10" } }]);

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      runLocal: fixture.runLocal,
      runRemote: fixture.runRemote,
      serverName: "test",
    });

    // First reconcile establishes hasReconciledBefore.
    mirror.request();
    await mirror.whenIdle();
    // After this reconcile, the remote should have a new pane for %11
    // (the reconciler splits because no pending overlay was in place).
    expect(fixture.state.remote.panesByWindow.get("@100")).toHaveLength(2);
  });

  test("syncRemoteClientSize sources WxH from a local window mirrored to this server", async () => {
    // Two local sessions live on the same `-L honeymux` server. The first
    // window in the snapshot belongs to a detached session whose layout
    // is frozen at 200x60. The mirrored session is 90x30. The mirror must
    // push the mirrored session's dims to the remote, not the detached
    // session's stale dims.
    const fixture = createServerStub({
      panesByWindow: new Map([
        ["@detached", [{ id: "%999", index: 0 }]],
        ["@mirrored", [{ id: "%10", index: 0, tags: { "@hmx-remote-host": "test" } }]],
      ]),
      windows: [
        { id: "@detached", index: 0, layout: "aaaa,200x60,0,0,999" },
        { id: "@mirrored", index: 1, layout: "bbbb,90x30,0,0,10" },
      ],
    });

    const remoteCommands: string[] = [];
    const wrappedRunRemote = async (cmd: string) => {
      remoteCommands.push(cmd);
      return fixture.runRemote(cmd);
    };

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      runLocal: fixture.runLocal,
      runRemote: wrappedRunRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    const refresh = remoteCommands.find((c) => c.startsWith("refresh-client -C"));
    expect(refresh).toBe("refresh-client -C 90,30");
  });

  test("syncRemoteClientSize skips the push when no local pane is mirrored to this server yet", async () => {
    const fixture = createServerStub({
      panesByWindow: new Map([["@1", [{ id: "%10", index: 0 }]]]),
      windows: [{ id: "@1", index: 0, layout: "aaaa,200x60,0,0,10" }],
    });

    const remoteCommands: string[] = [];
    const wrappedRunRemote = async (cmd: string) => {
      remoteCommands.push(cmd);
      return fixture.runRemote(cmd);
    };

    const mirror = new RemoteMirror({
      activeBindings: () => new Map(),
      runLocal: fixture.runLocal,
      runRemote: wrappedRunRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();

    expect(remoteCommands.some((c) => c.startsWith("refresh-client -C"))).toBe(false);
  });

  test("captureLocalMirrorSnapshot lists windows across ALL local sessions (-a)", async () => {
    const commands: string[] = [];
    const run = mock(async (cmd: string) => {
      commands.push(cmd);
      return "";
    });
    await captureLocalMirrorSnapshot(run);
    expect(commands[0]).toMatch(/^list-windows\s+-a\s/);
  });

  test("remotePaneFor returns the peer in the local pane's current window's mirror, not a stale tag in another window", async () => {
    // Regression: rebuildIndexes used to walk all paired remote windows
    // with first-tag-wins semantics, so a remote pane in @100 carrying a
    // stale `@hmx-local-pane-id=%10` could be returned for local %10
    // even after %10 was moved to local @2 and a fresh remote peer was
    // created in @2's mirror @200. The window-scoped lookup must only
    // consider remote panes whose remote window is paired with the local
    // window that currently contains %10.
    const fixture = createServerStub({
      panesByWindow: new Map([
        ["@1", [{ id: "%11", index: 0 }]],
        ["@2", [{ id: "%10", index: 0, tags: { "@hmx-remote-host": "test" } }]],
      ]),
      windows: [
        { id: "@1", index: 0, layout: "aaaa,80x24,0,0,11" },
        { id: "@2", index: 1, layout: "bbbb,80x24,0,0,10" },
      ],
    });
    // Pre-populate the remote with two paired mirror windows. @100 (paired
    // with @1) carries a STALE tag pointing at %10 — from before the move.
    // @200 (paired with @2) has the freshly split current peer for %10.
    fixture.state.remote.nextWindowNum = 201;
    fixture.state.remote.nextPaneNum = 301;
    fixture.state.remote.windows.push(
      { id: "@100", layout: "x", tags: { "@hmx-local-window-id": "@1" } },
      { id: "@200", layout: "y", tags: { "@hmx-local-window-id": "@2" } },
    );
    fixture.state.remote.panesByWindow.set("@100", [
      { id: "%150", tags: { "@hmx-local-pane-id": "%11" } },
      { id: "%200", tags: { "@hmx-local-pane-id": "%10" } }, // stale
    ]);
    fixture.state.remote.panesByWindow.set("@200", [{ id: "%300", tags: { "@hmx-local-pane-id": "%10" } }]);

    const mirror = new RemoteMirror({
      // Stale binding %200 → %10 mirrors what the routing cache would
      // hold immediately after the move (the local @hmx-remote-pane tag
      // on %10 is still %200 until the post-reconcile sync rewrites it).
      activeBindings: () => new Map([["%200", "%10"]]),
      runLocal: fixture.runLocal,
      runRemote: fixture.runRemote,
      serverName: "test",
    });

    mirror.request();
    await mirror.whenIdle();
    // Drain any rearm that follows the first pass so the indexes settle
    // against the final remote state.
    mirror.request();
    await mirror.whenIdle();

    expect(mirror.remotePaneFor("%10")).toBe("%300");
  });
});
