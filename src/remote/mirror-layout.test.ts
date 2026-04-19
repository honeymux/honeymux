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
function createFakeServer(initial: { panesByWindow: Map<string, string[]> }) {
  const state = {
    nextPaneNum: 0,
    panesByWindow: new Map(initial.panesByWindow),
  };

  for (const panes of state.panesByWindow.values()) {
    for (const p of panes) {
      const num = parseInt(p.replace("%", ""), 10);
      if (num >= state.nextPaneNum) state.nextPaneNum = num + 1;
    }
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
      return [...state.panesByWindow.keys()].map((w) => `${w} ${i++} fakelayout`).join("\n");
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
    if (cmd.startsWith("select-layout") || cmd.startsWith("refresh-client") || cmd.startsWith("new-window")) {
      return "";
    }
    return "";
  }

  return { sendCommand, state };
}

function makeMirror(
  localServer: ReturnType<typeof createFakeServer>,
  remoteServer: ReturnType<typeof createFakeServer>,
) {
  const localClient = { sendCommand: mock(localServer.sendCommand) } as unknown as TmuxControlClient;
  const remoteClient = { sendCommand: mock(remoteServer.sendCommand) } as unknown as RemoteControlClient;
  return new MirrorLayoutManager(localClient, remoteClient);
}

describe("MirrorLayoutManager", () => {
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
