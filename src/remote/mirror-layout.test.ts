import { describe, expect, mock, test } from "bun:test";

import type { TmuxControlClient } from "../tmux/control-client.ts";
import type { RemoteControlClient } from "./remote-control-client.ts";

import { MirrorLayoutManager } from "./mirror-layout.ts";

/**
 * Simulates a tmux server in-memory. Tracks panes per window. The fake's
 * `split-window` appends a new pane at the end by default; tests that need
 * to model tmux's "insert next to active" behavior can manually reorder the
 * panes after splitting.
 */
function createFakeServer(initial: {
  localPaneIdsByPane?: Map<string, string>;
  localWindowIdsByWindow?: Map<string, string>;
  panesByWindow: Map<string, string[]>;
}) {
  const state = {
    localPaneIdsByPane: new Map(initial.localPaneIdsByPane),
    localWindowIdsByWindow: new Map(initial.localWindowIdsByWindow),
    nextPaneNum: 0,
    nextWindowNum: 0,
    panesByWindow: new Map(initial.panesByWindow),
  };

  for (const panes of state.panesByWindow.values()) {
    for (const p of panes) {
      const num = parseInt(p.replace("%", ""), 10);
      if (num >= state.nextPaneNum) state.nextPaneNum = num + 1;
    }
  }
  for (const windowId of state.panesByWindow.keys()) {
    const num = parseInt(windowId.replace("@", ""), 10);
    if (num >= state.nextWindowNum) state.nextWindowNum = num + 1;
  }

  function findWindowOfPane(paneId: string): string | undefined {
    for (const [w, panes] of state.panesByWindow) {
      if (panes.includes(paneId)) return w;
    }
    return undefined;
  }

  async function sendCommand(cmd: string): Promise<string> {
    if (cmd.startsWith("list-windows")) {
      let i = 0;
      return [...state.panesByWindow.keys()]
        .map((windowId) => {
          const localWindowId = state.localWindowIdsByWindow.get(windowId) ?? "";
          if (cmd.includes(LOCAL_WINDOW_ID_FORMAT)) {
            return `${windowId}\t${i++}\tfakelayout\t${localWindowId}`;
          }
          return `${windowId}\t${i++}\tfakelayout`;
        })
        .join("\n");
    }
    if (cmd.startsWith("list-panes")) {
      const m = cmd.match(/-t (\S+)/);
      if (!m) return "";
      const win = m[1]!;
      const panes = state.panesByWindow.get(win) ?? [];
      if (cmd.includes(LOCAL_PANE_ID_FORMAT)) {
        return panes
          .map((id, idx) => {
            const tag = state.localPaneIdsByPane.get(id) ?? "";
            return `${id}\t${idx}\t${tag}`;
          })
          .join("\n");
      }
      return panes.map((id, idx) => ` ${id} ${idx}`).join("\n");
    }
    if (cmd.startsWith("split-window")) {
      const m = cmd.match(/-t (\S+)/);
      if (!m) return "";
      const win = m[1]!;
      const newId = `%${state.nextPaneNum++}`;
      const panes = state.panesByWindow.get(win) ?? [];
      panes.push(newId);
      state.panesByWindow.set(win, panes);
      return cmd.includes(" -P") ? newId : "";
    }
    if (cmd.startsWith("kill-pane")) {
      const m = cmd.match(/-t (\S+)/);
      if (!m) return "";
      const target = m[1]!;
      const win = findWindowOfPane(target);
      if (win) {
        const panes = state.panesByWindow.get(win)!.filter((p) => p !== target);
        state.panesByWindow.set(win, panes);
      }
      return "";
    }
    if (cmd.startsWith("kill-window")) {
      const m = cmd.match(/-t (\S+)/);
      if (!m) return "";
      const target = m[1]!.replace(/^'/, "").replace(/'$/, "");
      state.localWindowIdsByWindow.delete(target);
      state.panesByWindow.delete(target);
      return "";
    }
    if (cmd.startsWith("new-window")) {
      const newWindowId = `@${state.nextWindowNum++}`;
      const newPaneId = `%${state.nextPaneNum++}`;
      state.panesByWindow.set(newWindowId, [newPaneId]);
      if (!cmd.includes("-P")) return "";
      return cmd.includes("#{pane_id}") ? `${newWindowId} ${newPaneId}` : newWindowId;
    }
    if (cmd.startsWith("set-option")) {
      const targetMatch = cmd.match(/-t ('[^']+'|\S+)/);
      if (!targetMatch) return "";
      const target = targetMatch[1]!.replace(/^'/, "").replace(/'$/, "");
      if (cmd.includes("@hmx-local-pane-id")) {
        const valueMatch = cmd.match(/(%\d+)'?$/);
        if (valueMatch) state.localPaneIdsByPane.set(target, valueMatch[1]!);
        return "";
      }
      const localWindowId = cmd.match(/(@\d+)'?$/)?.[1];
      if (localWindowId) {
        state.localWindowIdsByWindow.set(target, localWindowId);
      }
      return "";
    }
    if (cmd.startsWith("display-message")) {
      const m = cmd.match(/-t ('[^']+'|\S+)/);
      if (!m) throw new Error("display-message missing -t");
      const target = m[1]!.replace(/^'/, "").replace(/'$/, "");
      if (!state.panesByWindow.has(target)) throw new Error(`no such window ${target}`);
      return target;
    }
    if (cmd.startsWith("refresh-client") || cmd.startsWith("select-layout")) {
      return "";
    }
    return "";
  }

  return { sendCommand, state };
}

const LOCAL_PANE_ID_FORMAT = "#{@hmx-local-pane-id}";
const LOCAL_WINDOW_ID_FORMAT = "#{@hmx-local-window-id}";

function makeMirror(
  localServer: ReturnType<typeof createFakeServer>,
  remoteServer: ReturnType<typeof createFakeServer>,
) {
  const localClient = { sendCommand: mock(localServer.sendCommand) } as unknown as TmuxControlClient;
  const remoteClient = { sendCommand: mock(remoteServer.sendCommand) } as unknown as RemoteControlClient;
  return new MirrorLayoutManager(localClient, remoteClient);
}

describe("MirrorLayoutManager", () => {
  test("full sync creates and tags remote panes for every local window's panes", async () => {
    const localServer = createFakeServer({
      panesByWindow: new Map([
        ["@1", ["%10"]],
        ["@2", ["%20", "%21", "%22"]],
      ]),
    });
    // Stale untagged remote window — fullSync must drop it rather than
    // try to repurpose its panes.
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    await mirror.fullSync();

    expect(mirror.getRemotePaneId("%10")).toBeDefined();
    expect(mirror.getRemotePaneId("%20")).toBeDefined();
    expect(mirror.getRemotePaneId("%21")).toBeDefined();
    expect(mirror.getRemotePaneId("%22")).toBeDefined();

    // Stale @100 was dropped (no tag, no matching local window).
    expect(remoteServer.state.panesByWindow.has("@100")).toBe(false);

    // Mappings stay stable across a second sync — tags drive recovery.
    const firstSessionRemotePane = mirror.getRemotePaneId("%10");
    const secondSessionRemotePane = mirror.getRemotePaneId("%20");
    await mirror.fullSync();
    expect(mirror.getRemotePaneId("%10")).toBe(firstSessionRemotePane);
    expect(mirror.getRemotePaneId("%20")).toBe(secondSessionRemotePane);
  });

  test("createRemoteWindow tags the initial pane with the first local pane", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({ panesByWindow: new Map() });
    const mirror = makeMirror(localServer, remoteServer);

    await mirror.onWindowAdd("@1");

    const remoteWindowIds = [...remoteServer.state.panesByWindow.keys()];
    expect(remoteWindowIds.length).toBe(1);
    const remoteWindowId = remoteWindowIds[0]!;
    const remotePaneIds = remoteServer.state.panesByWindow.get(remoteWindowId)!;
    expect(remotePaneIds.length).toBe(1);
    expect(remoteServer.state.localPaneIdsByPane.get(remotePaneIds[0]!)).toBe("%10");
  });

  test("simple split-then-close removes the orphan remote pane", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      panesByWindow: new Map([["@100", ["%200"]]]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    const activeRemoteIds = new Set<string>(["%200"]);
    mirror.isRemotePaneActive = (id: string) => activeRemoteIds.has(id);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    // Split: local gains %11
    localServer.state.panesByWindow.set("@1", ["%10", "%11"]);
    await mirror.onLayoutChange("@1", "aaaa,80x24,0,0[80x12,0,0,10,80x11,0,13,11]");
    expect(remoteServer.state.panesByWindow.get("@100")?.length).toBe(2);

    // Close: local loses %11
    localServer.state.panesByWindow.set("@1", ["%10"]);
    await mirror.onLayoutChange("@1", "bbbb,80x24,0,0,10");

    expect(remoteServer.state.panesByWindow.get("@100")).toEqual(["%200"]);
  });

  test("onWindowClose skips remote teardown when local window still exists", async () => {
    // Repro: tmux emits %window-close whenever a winlink is removed, not
    // only on actual window destruction. Killing the agent zoom overlay
    // (`new-session -d -t <target>`) removes its winlinks for every window
    // it inherited from the target session, fanning %window-close
    // notifications to our control client even though the windows still
    // exist in the user's main session. The mirror must not tear down its
    // remote window in that case — doing so kills the active proxy panes.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    await mirror.onWindowClose("@1");

    expect(remoteServer.state.panesByWindow.has("@100")).toBe(true);
    expect((mirror as any).windowMap.get("@1")).toBe("@100");
  });

  test("onWindowClose tears down remote window when local window is gone", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    // Local window actually destroyed
    localServer.state.panesByWindow.delete("@1");

    await mirror.onWindowClose("@1");

    expect(remoteServer.state.panesByWindow.has("@100")).toBe(false);
    expect((mirror as any).windowMap.has("@1")).toBe(false);
  });

  test("onWindowAdd is idempotent for an already-mapped local window", async () => {
    // Repro: tmux emits %window-add for every existing window when another
    // session joins the session group (e.g. zoom overlay via
    // `new-session -d -t <target>`). The mirror must not create a second
    // remote window for an id it already mirrors — that overwrites windowMap
    // and corrupts paneMap with placeholder panes that fullSync later kills,
    // tearing down the real proxy panes.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    const remoteWindowsBefore = [...remoteServer.state.panesByWindow.keys()];

    await mirror.onWindowAdd("@1");

    const remoteWindowsAfter = [...remoteServer.state.panesByWindow.keys()];
    expect(remoteWindowsAfter).toEqual(remoteWindowsBefore);
    expect(mirror.getRemotePaneId("%10")).toBe("%200");
  });

  test("fullSync recovers pane mappings from @hmx-local-pane-id tags after paneMap is lost", async () => {
    // Once initial sync tags every remote pane, subsequent fullSyncs can
    // rebuild paneMap from tags alone — regardless of remote pane index
    // order or whether paneMap was preserved. This is what makes the
    // mapping stable across Honeymux restarts and remote layout shuffles.
    const localServer = createFakeServer({
      panesByWindow: new Map([["@1", ["%10", "%11", "%12"]]]),
    });
    const remoteServer = createFakeServer({
      // Tags written by a prior sync. Storage order intentionally diverges
      // from local — the tags must drive pairing, not the index.
      localPaneIdsByPane: new Map([
        ["%200", "%10"],
        ["%201", "%11"],
        ["%202", "%12"],
      ]),
      localWindowIdsByWindow: new Map([["@100", "@1"]]),
      panesByWindow: new Map([["@100", ["%202", "%201", "%200"]]]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    const activeRemoteIds = new Set<string>(["%200", "%201", "%202"]);
    mirror.isRemotePaneActive = (id: string) => activeRemoteIds.has(id);

    // paneMap starts empty — simulating a fresh Honeymux process attaching
    // to an already-mirrored remote.
    await mirror.fullSync();

    expect(mirror.getRemotePaneId("%10")).toBe("%200");
    expect(mirror.getRemotePaneId("%11")).toBe("%201");
    expect(mirror.getRemotePaneId("%12")).toBe("%202");
  });

  test("split for a new local pane tags the resulting remote pane", async () => {
    // When the user splits a pane locally, syncWindowPanes runs split-window
    // on the remote and immediately tags the new pane so it survives any
    // future fullSync re-pair.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      panesByWindow: new Map([["@100", ["%200"]]]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    // User splits %10 → %11 locally.
    localServer.state.panesByWindow.set("@1", ["%10", "%11"]);
    await mirror.onLayoutChange("@1", "aaaa,80x24,0,0[80x12,0,0,10,80x11,0,13,11]");

    const remoteIds = remoteServer.state.panesByWindow.get("@100") ?? [];
    expect(remoteIds.length).toBe(2);
    const newRemoteId = remoteIds.find((id) => id !== "%200")!;
    expect(remoteServer.state.localPaneIdsByPane.get(newRemoteId)).toBe("%11");
    expect(mirror.getRemotePaneId("%11")).toBe(newRemoteId);
  });

  test("syncWindowPanes skips select-layout when nothing changed since the last applied layout", async () => {
    // tmux re-emits %layout-change for every select-layout call and
    // re-paints pane content to control-mode subscribers, which the local
    // proxy renders as duplicate prompt rows. Repeated syncs on a stable
    // layout (every session-window-changed fires fullSync) must not
    // re-apply the same layout string.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      localWindowIdsByWindow: new Map([["@100", "@1"]]),
      panesByWindow: new Map([["@100", ["%200"]]]),
    });
    const remoteSendCmd = mock(remoteServer.sendCommand);
    const localClient = { sendCommand: mock(localServer.sendCommand) } as unknown as TmuxControlClient;
    const remoteClient = { sendCommand: remoteSendCmd } as unknown as RemoteControlClient;
    const mirror = new MirrorLayoutManager(localClient, remoteClient);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    const layout = "aaaa,80x24,0,0,200";
    await mirror.onLayoutChange("@1", layout);
    await mirror.onLayoutChange("@1", layout);
    await mirror.onLayoutChange("@1", layout);

    const selectLayoutCalls = remoteSendCmd.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("select-layout"),
    );
    expect(selectLayoutCalls.length).toBe(1);
  });

  test("syncWindowPanes re-applies select-layout after a split mutates the pane set", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      localWindowIdsByWindow: new Map([["@100", "@1"]]),
      panesByWindow: new Map([["@100", ["%200"]]]),
    });
    const remoteSendCmd = mock(remoteServer.sendCommand);
    const localClient = { sendCommand: mock(localServer.sendCommand) } as unknown as TmuxControlClient;
    const remoteClient = { sendCommand: remoteSendCmd } as unknown as RemoteControlClient;
    const mirror = new MirrorLayoutManager(localClient, remoteClient);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    const layout = "aaaa,80x24,0,0,200";
    await mirror.onLayoutChange("@1", layout);

    // Local split with the same layout string — the cache can't dedup
    // this because we just mutated the remote pane set.
    localServer.state.panesByWindow.set("@1", ["%10", "%11"]);
    await mirror.onLayoutChange("@1", layout);

    const selectLayoutCalls = remoteSendCmd.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("select-layout"),
    );
    expect(selectLayoutCalls.length).toBe(2);
  });

  test("invalidateLayoutForLocalWindow forces the next syncWindowPanes to re-apply select-layout", async () => {
    // After an external respawn-pane resets the remote pane content, the
    // caller invalidates the cached layout so the next sync (triggered by
    // the local respawn's layout-change) re-applies select-layout —
    // which is what kicks tmux to flush new content to subscribers.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      localWindowIdsByWindow: new Map([["@100", "@1"]]),
      panesByWindow: new Map([["@100", ["%200"]]]),
    });
    const remoteSendCmd = mock(remoteServer.sendCommand);
    const localClient = { sendCommand: mock(localServer.sendCommand) } as unknown as TmuxControlClient;
    const remoteClient = { sendCommand: remoteSendCmd } as unknown as RemoteControlClient;
    const mirror = new MirrorLayoutManager(localClient, remoteClient);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");

    const layout = "aaaa,80x24,0,0,200";
    await mirror.onLayoutChange("@1", layout);

    mirror.invalidateLayoutForLocalWindow("@1");
    await mirror.onLayoutChange("@1", layout);

    const selectLayoutCalls = remoteSendCmd.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith("select-layout"),
    );
    expect(selectLayoutCalls.length).toBe(2);
  });

  test("onIntegrityWarning fires for an untagged pane that appears in an established mirror window", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      // Window is hmx-managed (tagged); pane carries no @hmx-local-pane-id
      // — i.e., something inserted a pane into our mirror window.
      localWindowIdsByWindow: new Map([["@100", "@1"]]),
      panesByWindow: new Map([["@100", ["%200", "%999"]]]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    const warnings: string[] = [];
    mirror.onIntegrityWarning = (message) => warnings.push(message);
    mirror.isRemotePaneActive = (id) => id === "%200";

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%10", "%200");
    // Tag the live mirror so tier 1 finds %200; %999 is the intruder.
    remoteServer.state.localPaneIdsByPane.set("%200", "%10");

    await mirror.onLayoutChange("@1", "aaaa,80x24,0,0,200");

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("%999");
    expect(warnings[0]).toContain("no @hmx-local-pane-id tag");
    expect(remoteServer.state.panesByWindow.get("@100")).toEqual(["%200"]);
  });

  test("onIntegrityWarning does not fire for the bootstrap default window on first sync", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    // Mirror session as tmux would freshly create it: one untagged default window.
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    const warnings: string[] = [];
    mirror.onIntegrityWarning = (message) => warnings.push(message);

    await mirror.fullSync();

    expect(warnings.length).toBe(0);
  });

  test("onIntegrityWarning fires for a stale-tagged remote window after we've established mirror state", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([["%200", "%10"]]),
      // @100 mirrors @1; @101 carries a stale window tag pointing at @99
      // (a local window that no longer exists — e.g., we missed the
      // window-close event while disconnected).
      localWindowIdsByWindow: new Map([
        ["@100", "@1"],
        ["@101", "@99"],
      ]),
      panesByWindow: new Map([
        ["@100", ["%200"]],
        ["@101", ["%201"]],
      ]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    const warnings: string[] = [];
    mirror.onIntegrityWarning = (message) => warnings.push(message);

    // Pretend we've already synced this server before — windowMap non-empty
    // arms the integrity check for stale tags too.
    (mirror as any).windowMap.set("@1", "@100");

    await mirror.fullSync();

    expect(warnings.some((m) => m.includes("@101") && m.includes("stale"))).toBe(true);
    expect(remoteServer.state.panesByWindow.has("@101")).toBe(false);
  });

  test("close after split-induced index shuffle kills the orphan, not the active mirror", async () => {
    // tmux's `split-window` on the remote inserts the new pane next to
    // the active pane, which can push existing panes to later indices.
    // The orphan-detection path must use tags (and the `isRemotePaneActive`
    // safety net), not trailing-index slicing.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%0", "%1"]]]) });
    // Remote layout after the user's split, with %13 sitting between two
    // live mirrors. %13's tag points at %2 — a local pane that no longer
    // exists, since the user just closed it.
    const remoteServer = createFakeServer({
      localPaneIdsByPane: new Map([
        ["%11", "%0"],
        ["%12", "%1"],
        ["%13", "%2"],
      ]),
      panesByWindow: new Map([["@100", ["%11", "%13", "%12"]]]),
    });
    const mirror = makeMirror(localServer, remoteServer);

    const activeRemoteIds = new Set<string>(["%12"]);
    mirror.isRemotePaneActive = (id: string) => activeRemoteIds.has(id);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%0", "%11");
    (mirror as any).paneMap.set("%1", "%12");

    await mirror.onLayoutChange("@1", "ef09,136x46,0,0{68x46,0,0,0,67x46,69,0,1}");

    const after = remoteServer.state.panesByWindow.get("@100") ?? [];
    expect(after).toContain("%12"); // active mirror must survive
    expect(after).toContain("%11"); // other live mirror must survive
    expect(after).not.toContain("%13"); // orphan must be killed
    expect(after.length).toBe(2);
  });
});
