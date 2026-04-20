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
  localWindowIdsByWindow?: Map<string, string>;
  panesByWindow: Map<string, string[]>;
}) {
  const state = {
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
      return "";
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
      return cmd.includes("-P") ? newWindowId : "";
    }
    if (cmd.startsWith("set-option")) {
      const targetMatch = cmd.match(/-t ('[^']+'|\S+)/);
      if (!targetMatch) return "";
      const target = targetMatch[1]!.replace(/^'/, "").replace(/'$/, "");
      const localWindowId = cmd.match(/(@\d+)'?$/)?.[1];
      if (localWindowId) {
        state.localWindowIdsByWindow.set(target, localWindowId);
      }
      return "";
    }
    if (cmd.startsWith("refresh-client") || cmd.startsWith("select-layout")) {
      return "";
    }
    return "";
  }

  return { sendCommand, state };
}

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
  test("full sync mirrors windows discovered outside the initially attached session", async () => {
    const localServer = createFakeServer({
      panesByWindow: new Map([
        ["@1", ["%10"]],
        ["@2", ["%20", "%21", "%22"]],
      ]),
    });
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    await mirror.fullSync();

    const firstSessionRemotePane = mirror.getRemotePaneId("%10");
    const secondSessionRemotePane = mirror.getRemotePaneId("%20");

    expect(mirror.getRemotePaneId("%10")).toBe("%200");
    expect(mirror.getRemotePaneId("%20")).toBeDefined();
    expect(mirror.getRemotePaneId("%21")).toBeDefined();
    expect(mirror.getRemotePaneId("%22")).toBeDefined();

    await mirror.fullSync();

    expect(mirror.getRemotePaneId("%10")).toBe(firstSessionRemotePane);
    expect(mirror.getRemotePaneId("%20")).toBe(secondSessionRemotePane);
  });

  test("simple split-then-close removes the orphan remote pane", async () => {
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%10"]]]) });
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%200"]]]) });
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

  test("close after split-induced index shuffle kills the orphan, not the active mirror", async () => {
    // Reproduces the bug: user does a vertical split first, converts the new
    // pane to remote, then splits that pane. tmux's `split-window` on the
    // remote inserts the new pane next to the active mirror, pushing the
    // active mirror to a later index. The previous code killed by trailing
    // index, which picked the active mirror and skipped the actual orphan.
    const localServer = createFakeServer({ panesByWindow: new Map([["@1", ["%0", "%1", "%2"]]]) });
    // Remote panes after user's split, mirroring the observed shuffle:
    //   index 0: %11 (mirrors local %0)
    //   index 1: %13 (the new orphan from split-window inserting next to active)
    //   index 2: %12 (the active converted-pane mirror, pushed to index 2)
    const remoteServer = createFakeServer({ panesByWindow: new Map([["@100", ["%11", "%13", "%12"]]]) });
    const mirror = makeMirror(localServer, remoteServer);

    // %1 is the converted pane (mapped to %12 — the active mirror).
    const activeRemoteIds = new Set<string>(["%12"]);
    mirror.isRemotePaneActive = (id: string) => activeRemoteIds.has(id);

    (mirror as any).windowMap.set("@1", "@100");
    (mirror as any).paneMap.set("%0", "%11");
    (mirror as any).paneMap.set("%1", "%12");
    (mirror as any).paneMap.set("%2", "%13");

    // User closes %2 (the new sibling).
    localServer.state.panesByWindow.set("@1", ["%0", "%1"]);
    await mirror.onLayoutChange("@1", "ef09,136x46,0,0{68x46,0,0,0,67x46,69,0,1}");

    const after = remoteServer.state.panesByWindow.get("@100") ?? [];
    expect(after).toContain("%12"); // active mirror must survive
    expect(after).toContain("%11"); // other live mirror must survive
    expect(after).not.toContain("%13"); // orphan must be killed
    expect(after.length).toBe(2);
  });
});
