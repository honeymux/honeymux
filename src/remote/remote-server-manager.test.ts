import { describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "../agents/types.ts";
import type { RemoteAgentIngress, RemotePermissionRoute } from "./agent-transport.ts";

import { EventEmitter } from "../util/event-emitter.ts";
import { buildRemoteProxyProcessArgv } from "./proxy-command.ts";
import { RemoteServerManager } from "./remote-server-manager.ts";

class LocalEventClient extends EventEmitter {
  emitEvent(event: string, ...args: any[]): void {
    this.emit(event, ...args);
  }
}

function makeStubIngress(): {
  ingress: RemoteAgentIngress;
  respondToPermission: ReturnType<typeof mock>;
} {
  const respondToPermission = mock((_route: RemotePermissionRoute, _decision: "allow" | "deny") => true);
  return {
    ingress: {
      authToken: "test-token-deadbeef",
      close: mock(() => {}),
      localTcpPort: 45678,
      respondToPermission,
      start: mock(() => {}),
    },
    respondToPermission,
  };
}

describe("RemoteServerManager remote hook ingress", () => {
  it("normalizes remote hook events and routes permission replies through the per-server ingress", async () => {
    const localClient = {
      getFullTree: async () => ({
        panes: [
          {
            active: true,
            command: "sh",
            id: "%10",
            index: 0,
            pid: 123,
            sessionName: "alpha",
            windowId: "@1",
          },
        ],
        sessions: [],
        windows: [],
      }),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const { ingress, respondToPermission } = makeStubIngress();

    (manager as any).agentIngresses.set("dev-box", ingress);
    (manager as any).servers.set("dev-box", {
      config: { host: "dev-box", name: "dev-box" },
      mirrorSession: "mirror-alpha",
      status: "connected",
    });
    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async () => "%77\t123\n"),
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    const events: AgentEvent[] = [];
    manager.on("agent-event", (event: AgentEvent) => events.push(event));

    await (manager as any).processRemoteAgentEvent("dev-box", {
      agentType: "claude",
      cwd: "/remote/project",
      hookEvent: "PermissionRequest",
      paneId: "%77",
      remoteHost: "remote-box",
      sessionId: "sess-1",
      status: "unanswered",
      timestamp: 1,
      transcriptPath: "/remote/state/transcript.jsonl",
    });

    expect(events).toHaveLength(1);
    expect(events[0]!).toMatchObject({
      agentType: "claude",
      isRemote: true,
      paneId: "%10",
      remoteHost: "remote-box",
      sessionId: "sess-1",
      sessionName: "alpha",
      status: "unanswered",
      windowId: "@1",
    });
    expect(events[0]!.transcriptPath).toBeUndefined();

    manager.respondToPermission("sess-1", "", "allow");

    expect(respondToPermission).toHaveBeenCalledWith({ agentType: "claude", key: "sess-1" }, "allow");
  });

  it("ends tracked remote sessions when a server disconnects", async () => {
    const localClient = {
      getFullTree: async () => ({ panes: [], sessions: [], windows: [] }),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    (manager as any).servers.set("dev-box", {
      config: { host: "dev-box", name: "dev-box" },
      mirrorSession: "mirror-alpha",
      status: "connected",
    });

    const events: AgentEvent[] = [];
    manager.on("agent-event", (event: AgentEvent) => events.push(event));

    await (manager as any).processRemoteAgentEvent("dev-box", {
      agentType: "claude",
      cwd: "/remote/project",
      hookEvent: "SessionStart",
      sessionId: "sess-1",
      status: "alive",
      timestamp: 1,
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("alive");

    (manager as any).endRemoteSessionsForServer("dev-box");

    expect(events).toHaveLength(2);
    expect(events[1]!).toMatchObject({ sessionId: "sess-1", status: "ended" });
  });

  it("keeps permission routing isolated by server even when toolUseIds collide", async () => {
    const localClient = {
      getFullTree: async () => ({ panes: [], sessions: [], windows: [] }),
    } as any;

    const manager = new RemoteServerManager(localClient, [
      { host: "dev-a", name: "dev-a" },
      { host: "dev-b", name: "dev-b" },
    ]);
    const firstIngress = makeStubIngress();
    const secondIngress = makeStubIngress();

    (manager as any).agentIngresses.set("dev-a", firstIngress.ingress);
    (manager as any).agentIngresses.set("dev-b", secondIngress.ingress);
    (manager as any).servers.set("dev-a", {
      config: { host: "dev-a", name: "dev-a" },
      mirrorSession: "mirror-alpha",
      status: "connected",
    });
    (manager as any).servers.set("dev-b", {
      config: { host: "dev-b", name: "dev-b" },
      mirrorSession: "mirror-alpha",
      status: "connected",
    });

    await (manager as any).processRemoteAgentEvent("dev-a", {
      agentType: "claude",
      cwd: "/srv/a",
      hookEvent: "PermissionRequest",
      sessionId: "sess-a",
      status: "unanswered",
      timestamp: 1,
      toolUseId: "perm-1",
    });
    await (manager as any).processRemoteAgentEvent("dev-b", {
      agentType: "claude",
      cwd: "/srv/b",
      hookEvent: "PermissionRequest",
      sessionId: "sess-b",
      status: "unanswered",
      timestamp: 2,
      toolUseId: "perm-1",
    });

    manager.respondToPermission("sess-b", "perm-1", "deny");

    expect(firstIngress.respondToPermission).not.toHaveBeenCalled();
    expect(secondIngress.respondToPermission).toHaveBeenCalledWith({ agentType: "claude", key: "perm-1" }, "deny");
  });

  it("spawns the local proxy process with the pane id and proxy token", async () => {
    const respawnPane = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommandArgs: mock(async () => {}),
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async () => ""),
    });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => "%77",
    });

    await manager.convertPane("%10", "dev-box");

    expect(respawnPane).toHaveBeenCalledTimes(1);
    const [paneId, argv] = respawnPane.mock.calls[0]! as unknown as [string, string[]];
    expect(paneId).toBe("%10");
    const proxyToken = argv.at(-1);
    expect(proxyToken).toEqual(expect.any(String));
    expect(argv).toEqual(buildRemoteProxyProcessArgv("%10", proxyToken!));
  });

  it("reports remote conversion availability from connection and mirror state", () => {
    const manager = new RemoteServerManager({} as any, [{ host: "dev-box", name: "dev-box" }]);

    expect(manager.getRemoteConversionAvailability("%10", "dev-box")).toBe("unavailable");
    expect(manager.hasConvertibleRemoteServer("%10")).toBe(false);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
    });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => undefined,
    });

    expect(manager.getRemoteConversionAvailability("%10", "dev-box")).toBe("ready");
    expect(manager.hasConvertibleRemoteServer("%10")).toBe(true);

    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => "%77",
    });

    expect(manager.getRemoteConversionAvailability("%10", "dev-box")).toBe("ready");
    expect(manager.hasConvertibleRemoteServer("%10")).toBe(true);
  });

  it("declines plain typing so it flows through local tmux's input layer", () => {
    // Plain keystrokes route through writeToPty → local tmux → focused pane
    // (the proxy) → proxy-server "proxy-input" → send-keys -H. routeInput
    // only intercepts what cannot work that way, so prefix combos and capture
    // states (command-prompt, copy-mode, etc.) are processed by local tmux
    // natively rather than being injected past it via send-keys.
    const runCommandArgs = mock(async () => {});
    const sendCommand = mock(async () => "");
    const manager = new RemoteServerManager({ runCommandArgs } as any, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand,
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    expect(manager.routeInput("%10", "ab")).toBe(false);
    expect(manager.routeInput("%10", "\x02")).toBe(false); // Ctrl+B (a tmux prefix)
    expect(manager.routeInput("%10", "\x1b")).toBe(false); // Escape — tmux handles copy-mode exit
    expect(manager.routeInput("%10", "\x1b[<0;177;3M")).toBe(false); // SGR mouse press
    expect(manager.routeInput("%10", "\r")).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(runCommandArgs).not.toHaveBeenCalled();
  });

  it("forwards stdin emitted by the proxy server to the remote pane via send-keys -H", () => {
    const runCommandArgs = mock(async () => {});
    const sendCommand = mock(async () => "");
    const manager = new RemoteServerManager({ runCommandArgs } as any, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand,
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    (manager as any).handleProxyInput("%10", new Uint8Array([0x61, 0x62]));

    expect(sendCommand).toHaveBeenCalledWith("send-keys -H -t '%77' 61 62");
    expect(runCommandArgs).not.toHaveBeenCalled();
  });

  it("routes bracketed paste through a single set-buffer ; paste-buffer command", async () => {
    const runCommandArgs = mock(async () => {});
    const sendCalls: string[] = [];
    const sendCommand = mock(async (cmd: string) => {
      sendCalls.push(cmd);
      return "";
    });
    const manager = new RemoteServerManager({ runCommandArgs } as any, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand,
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    expect(manager.routeInput("%10", "\x1b[200~hello\nworld\x1b[201~")).toBe(true);

    expect(sendCalls).toHaveLength(1);
    const match = sendCalls[0]!.match(
      /^set-buffer -b '(hmx-paste-[0-9a-f]+)' "hello\\012world" ; paste-buffer -p -d -b '\1' -t '%77'$/,
    );
    expect(match).not.toBeNull();
    expect(runCommandArgs).not.toHaveBeenCalled();
  });

  it("serializes a paste followed by a proxy-input keystroke onto a single client", async () => {
    const runCommandArgs = mock(async () => {});
    const sendCalls: string[] = [];
    const sendCommand = mock(async (cmd: string) => {
      sendCalls.push(cmd);
      return "";
    });
    const manager = new RemoteServerManager({ runCommandArgs } as any, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand,
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    expect(manager.routeInput("%10", "\x1b[200~paste\x1b[201~")).toBe(true);
    (manager as any).handleProxyInput("%10", new Uint8Array([0x0d]));

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0]!).toMatch(/^set-buffer -b 'hmx-paste-[0-9a-f]+' "paste" ; paste-buffer /);
    expect(sendCalls[1]!).toBe("send-keys -H -t '%77' 0d");
  });

  it("forces a mirror sync during conversion when the pane mapping is missing", async () => {
    const respawnPane = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommandArgs: mock(async () => {}),
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    let remotePaneId: string | undefined;
    let requestCount = 0;
    const request = mock(() => {
      requestCount += 1;
      remotePaneId = "%77";
    });

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async () => ""),
    });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => remotePaneId,
      request,
      whenIdle: async () => {},
    });

    await manager.convertPane("%10", "dev-box");

    expect(requestCount).toBe(1);
    expect(respawnPane).toHaveBeenCalledTimes(1);
  });

  it("installs proxy expectations before the remote pane respawns", async () => {
    const proxyExpectState: { hadExpectation: boolean; hadMapping: boolean } = {
      hadExpectation: false,
      hadMapping: false,
    };
    const localClient = {
      respawnPane: mock(async () => {}),
      runCommandArgs: mock(async () => {}),
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    const forgetProxy = mock((_paneId: string) => {});
    (manager as any).proxyServer = {
      expectProxy,
      forgetProxy,
    };

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async (command: string) => {
        if (command === "respawn-pane -k -t '%77'") {
          proxyExpectState.hadExpectation = expectProxy.mock.calls.length === 1;
          proxyExpectState.hadMapping = (manager as any).routing.lookup("%10")?.remotePaneId === "%77";
        }
        return "";
      }),
    });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => "%77",
    });

    await manager.convertPane("%10", "dev-box");

    expect(proxyExpectState).toEqual({
      hadExpectation: true,
      hadMapping: true,
    });
    expect(forgetProxy).not.toHaveBeenCalled();
  });

  it("stores the remote hook tcp endpoint and token in the tmux user-option", async () => {
    const sendCommand = mock(async () => "");
    const localClient = {} as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      hookAuthToken: "deadbeefcafebabe",
      hookForwardingRejected: false,
      remoteHookTcpPort: 23456,
      sendCommand,
    });

    await (manager as any).configureRemoteHookSocketOption("dev-box");

    expect(sendCommand).toHaveBeenCalledWith(
      "set-option -gq @hmx-agent-socket-path 'tcp://127.0.0.1:23456#deadbeefcafebabe'",
    );
  });

  it("skips writing the hook option when forwarding has been rejected", async () => {
    const sendCommand = mock(async () => "");
    const localClient = {} as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      hookAuthToken: "deadbeefcafebabe",
      hookForwardingRejected: true,
      remoteHookTcpPort: 23456,
      sendCommand,
    });

    await (manager as any).configureRemoteHookSocketOption("dev-box");

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("skips writing the hook option until the allocated port has resolved", async () => {
    const sendCommand = mock(async () => "");
    const localClient = {} as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      hookAuthToken: "deadbeefcafebabe",
      hookForwardingRejected: false,
      remoteHookTcpPort: undefined,
      sendCommand,
    });

    await (manager as any).configureRemoteHookSocketOption("dev-box");

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("kills mapped local proxy panes when the remote tmux session exits", () => {
    const killPaneById = mock(async () => {});
    const runCommandArgs = mock(async () => {});
    const localClient = {
      killPaneById,
      runCommandArgs,
    } as any;
    const manager = new RemoteServerManager(localClient, [
      { host: "dev-a", name: "dev-a" },
      { host: "dev-b", name: "dev-b" },
    ]);

    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-a",
    });
    (manager as any).routing.register({
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-b",
    });

    (manager as any).handleRemoteTmuxExit("dev-a");

    expect(killPaneById).toHaveBeenCalledTimes(1);
    expect(killPaneById).toHaveBeenCalledWith("%10");
    expect(Boolean((manager as any).routing.lookup("%10"))).toBe(false);
    expect(Boolean((manager as any).routing.lookup("%11"))).toBe(true);
    // 3 option clears (@hmx-remote-host, @hmx-remote-pane, @hmx-remote-token)
    // + 1 border reset.
    expect(runCommandArgs).toHaveBeenCalledTimes(4);
  });

  it("cleanupDeadLocalProxiesForServer kills local proxy panes whose remote peer is missing from the snapshot", () => {
    const killPaneById = mock(async () => {});
    const runCommandArgs = mock(async () => {});
    const localClient = {
      killPaneById,
      runCommandArgs,
    } as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    // Drive the bindings through the snapshot path (rebuildForServer) so
    // they land in the cache without a pending hold — matching the
    // post-convert steady state. A register() here would leave them in the
    // pending overlay and the cleanup guard would (correctly) skip them.
    (manager as any).routing.rebuildForServer("dev-box", {
      panesByWindow: new Map([
        [
          "@1",
          [
            { id: "%10", index: 0, tags: { remoteHost: "dev-box", remotePaneId: "%77" }, windowId: "@1" },
            { id: "%11", index: 1, tags: { remoteHost: "dev-box", remotePaneId: "%88" }, windowId: "@1" },
          ],
        ],
      ]),
      windows: [{ id: "@1", index: 0, layout: "x" }],
    });

    // Snapshot shows only %88 alive; %77 has vanished.
    const remoteSnapshot = {
      panesByWindow: new Map([["@100", [{ id: "%88", index: 0, tags: {}, windowId: "@100" }]]]),
      windows: [{ id: "@100", index: 0, layout: "x" }],
    };
    (manager as any).cleanupDeadLocalProxiesForServer("dev-box", remoteSnapshot);

    expect(killPaneById).toHaveBeenCalledTimes(1);
    expect(killPaneById).toHaveBeenCalledWith("%10");
    expect(Boolean((manager as any).routing.lookup("%10"))).toBe(false);
    expect((manager as any).routing.lookup("%11")).toEqual({
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-box",
    });
  });

  it("cleanupDeadLocalProxiesForServer skips bindings still held in the pending overlay", () => {
    // Regression for the convertPane race: when the routing cache has a
    // pending registration (set between routing.register and the next
    // snapshot that observes the local @hmx-remote-* tags), the
    // pre-mutation remote snapshot the reconciler walks here can lag the
    // actual remote state by a cycle. Killing the proxy on that stale
    // signal tears down a pane the user is in the middle of converting.
    const killPaneById = mock(async () => {});
    const runCommandArgs = mock(async () => {});
    const localClient = { killPaneById, runCommandArgs } as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    // convertPane just called routing.register — pending holds %10 → %77.
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    // Remote snapshot does NOT contain %77 (e.g. the prior reconcile
    // killed the window during the create-window thrash, or the snapshot
    // was captured before the just-respawned pane was published).
    const remoteSnapshot = {
      panesByWindow: new Map([["@100", [{ id: "%88", index: 0, tags: {}, windowId: "@100" }]]]),
      windows: [{ id: "@100", index: 0, layout: "x" }],
    };
    (manager as any).cleanupDeadLocalProxiesForServer("dev-box", remoteSnapshot);

    expect(killPaneById).not.toHaveBeenCalled();
    expect((manager as any).routing.lookup("%10")).toEqual({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });
  });

  it("cleanupDeadLocalProxiesForServer treats an empty snapshot as unavailable and kills nothing", () => {
    const killPaneById = mock(async () => {});
    const localClient = { killPaneById, runCommandArgs: mock(async () => {}) } as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    (manager as any).cleanupDeadLocalProxiesForServer("dev-box", {
      panesByWindow: new Map(),
      windows: [],
    });

    expect(killPaneById).not.toHaveBeenCalled();
  });

  it("token-reuse recovery re-registers the stored token without respawning the pane", async () => {
    const respawnPane = mock(async () => {});
    const runCommand = mock(async () => " %10\tdev-box\tstoredtoken123\n");
    const runCommandArgs = mock(async () => {});
    const setPaneBorderFormat = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommand,
      runCommandArgs,
      setPaneBorderFormat,
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    const forgetProxy = mock((_paneId: string) => {});
    (manager as any).proxyServer = { expectProxy, forgetProxy };

    (manager as any).clients.set("dev-box", { isConnected: true });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: (localId: string) => (localId === "%10" ? "%77" : undefined),
    });

    const converted: Array<[string, string]> = [];
    manager.on("pane-converted", (paneId: string, serverName: string) => {
      converted.push([paneId, serverName]);
    });

    await manager.recoverPaneMappings("dev-box");

    expect((manager as any).routing.lookup("%10")).toEqual({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    expect(expectProxy).toHaveBeenCalledTimes(1);
    expect(expectProxy).toHaveBeenCalledWith("%10", "storedtoken123");
    expect(respawnPane).not.toHaveBeenCalled();

    expect(converted).toEqual([["%10", "dev-box"]]);
  });

  it("legacy recovery mints a fresh token and respawns when no stored token is present", async () => {
    const respawnPane = mock(async () => {});
    const runCommand = mock(async () => " %10\tdev-box\t\n %11\t\t\n %12\tother-box\tothertoken\n");
    const runCommandArgs = mock(async () => {});
    const setPaneBorderFormat = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommand,
      runCommandArgs,
      setPaneBorderFormat,
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    (manager as any).proxyServer = { expectProxy, forgetProxy: mock(() => {}) };

    (manager as any).clients.set("dev-box", { isConnected: true });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: (localId: string) => (localId === "%10" ? "%77" : undefined),
    });

    await manager.recoverPaneMappings("dev-box");

    expect((manager as any).routing.lookup("%10")).toEqual({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    expect(expectProxy).toHaveBeenCalledTimes(1);
    const [expectedPaneId, expectedToken] = expectProxy.mock.calls[0]! as unknown as [string, string];
    expect(expectedPaneId).toBe("%10");
    expect(expectedToken).toEqual(expect.any(String));
    expect(expectedToken.length).toBeGreaterThan(0);

    expect(respawnPane).toHaveBeenCalledTimes(1);
    const [respawnPaneId, respawnArgv] = respawnPane.mock.calls[0]! as unknown as [string, string[]];
    expect(respawnPaneId).toBe("%10");
    expect(respawnArgv).toEqual(buildRemoteProxyProcessArgv("%10", expectedToken));

    // %11 has no host, %12 is a different server — neither should be touched.
    expect(Boolean((manager as any).routing.lookup("%11"))).toBe(false);
    expect(Boolean((manager as any).routing.lookup("%12"))).toBe(false);
  });

  it("enqueues a reconcile when the active session changes", async () => {
    const localClient = new LocalEventClient();
    const manager = new RemoteServerManager(localClient as any, [{ host: "dev-box", name: "dev-box" }]);
    const request = mock(() => {});

    (manager as any).clients.set("dev-box", {
      isConnected: true,
    });
    (manager as any).mirrors.set("dev-box", {
      request,
      whenIdle: async () => {},
    });

    (manager as any).wireLocalEvents();

    localClient.emitEvent("session-window-changed");
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-syncs mapped remote pane ids after a local layout change settles", async () => {
    const runCommandArgs = mock(async () => {});
    const localClient = Object.assign(new LocalEventClient(), { runCommandArgs });
    const manager = new RemoteServerManager(localClient as any, [{ host: "dev-box", name: "dev-box" }]);
    const remotePaneIds = new Map([
      ["%10", "%77"],
      ["%11", "%88"],
    ]);
    const request = mock(() => {
      remotePaneIds.set("%11", "%99");
    });

    (manager as any).clients.set("dev-box", {
      isConnected: true,
    });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: (paneId: string) => remotePaneIds.get(paneId),
      request,
      whenIdle: async () => {},
    });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });
    (manager as any).routing.register({
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-box",
    });

    (manager as any).wireLocalEvents();

    localClient.emitEvent("layout-change", "@1", "layout");
    // Let the microtask queue drain so the whenIdle.then() callback fires.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
    expect((manager as any).routing.lookup("%11")).toEqual({
      localPaneId: "%11",
      remotePaneId: "%99",
      serverName: "dev-box",
    });
    expect(runCommandArgs).toHaveBeenCalledWith(["set-option", "-p", "-t", "%11", "@hmx-remote-pane", "%99"]);
  });

  it("clears orphaned remote metadata when the mirror has no mapping for the local pane", async () => {
    const respawnPane = mock(async () => {});
    const runCommand = mock(async () => " %10\tdev-box\tsometoken\n");
    const runCommandArgs = mock(async () => {});
    const setPaneBorderFormat = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommand,
      runCommandArgs,
      setPaneBorderFormat,
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    (manager as any).proxyServer = { expectProxy, forgetProxy: mock(() => {}) };

    (manager as any).clients.set("dev-box", { isConnected: true });
    (manager as any).mirrors.set("dev-box", {
      remotePaneFor: () => undefined,
    });

    await manager.recoverPaneMappings("dev-box");

    expect(Boolean((manager as any).routing.lookup("%10"))).toBe(false);
    expect(expectProxy).not.toHaveBeenCalled();
    expect(respawnPane).not.toHaveBeenCalled();

    const clearedKeys = runCommandArgs.mock.calls
      .map((call: unknown[]) => call[0] as string[])
      .filter((argv: string[]) => argv[0] === "set-option" && argv[1] === "-pu")
      .map((argv: string[]) => argv[argv.length - 1]);
    expect(clearedKeys).toEqual(expect.arrayContaining(["@hmx-remote-host", "@hmx-remote-pane", "@hmx-remote-token"]));
  });

  it("skips panes this instance has already claimed via pendingRegistrations", async () => {
    const respawnPane = mock(async () => {});
    const runCommand = mock(async () => " %10\tdev-box\tsometoken\n");
    const localClient = {
      respawnPane,
      runCommand,
      runCommandArgs: mock(async () => {}),
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    (manager as any).proxyServer = { expectProxy, forgetProxy: mock(() => {}) };

    (manager as any).clients.set("dev-box", { isConnected: true });
    (manager as any).mirrors.set("dev-box", { remotePaneFor: () => "%77" });
    (manager as any).pendingRegistrations.set("%10", () => {});

    await manager.recoverPaneMappings("dev-box");

    expect(expectProxy).not.toHaveBeenCalled();
    expect(respawnPane).not.toHaveBeenCalled();
  });

  it("re-runs recovery for panes whose routing was rebuilt from tags but never claimed this run", async () => {
    // Simulates the post-restart scenario: the first reconcile populates
    // routing from surviving @hmx-remote-* tags BEFORE recoverPaneMappings
    // runs. The pane must still go through recovery so expectProxy is
    // called and the in-pane proxy can authenticate.
    const runCommand = mock(async () => " %10\tdev-box\tsometoken\n");
    const localClient = {
      runCommand,
      runCommandArgs: mock(async () => {}),
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    const expectProxy = mock((_paneId: string, _token: string) => {});
    (manager as any).proxyServer = { expectProxy, forgetProxy: mock(() => {}) };

    (manager as any).clients.set("dev-box", { isConnected: true });
    (manager as any).mirrors.set("dev-box", { remotePaneFor: () => "%77" });
    (manager as any).routing.register({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    await manager.recoverPaneMappings("dev-box");

    expect(expectProxy).toHaveBeenCalledWith("%10", "sometoken");
  });

  it("persists the proxy token in @hmx-remote-token when converting a pane", async () => {
    const respawnPane = mock(async () => {});
    const runCommandArgs = mock(async () => {});
    const localClient = {
      respawnPane,
      runCommandArgs,
      setPaneBorderFormat: mock(async () => {}),
    } as any;

    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async () => ""),
    });
    (manager as any).mirrors.set("dev-box", { remotePaneFor: () => "%77" });

    await manager.convertPane("%10", "dev-box");

    const [, argv] = respawnPane.mock.calls[0]! as unknown as [string, string[]];
    const proxyToken = argv.at(-1)!;

    const tokenSet = runCommandArgs.mock.calls
      .map((call: unknown[]) => call[0] as string[])
      .find((a: string[]) => a[0] === "set-option" && a[4] === "@hmx-remote-token");
    expect(tokenSet).toEqual(["set-option", "-p", "-t", "%10", "@hmx-remote-token", proxyToken]);
  });

  it("drives the remote install host through the per-server ssh exec when refreshing hooks", async () => {
    // The four refresh* helpers short-circuit when host-level consent is
    // missing. claude reads HOME lazily through a function so we can grant
    // consent in a redirected HOME dir within the test; the other three read
    // HOME at module load and therefore stay short-circuited here. Consent
    // for claude alone is enough to prove the wire-up reaches the per-server
    // ssh exec seam — which is the manager's responsibility. The other three
    // helpers are exercised by their own dedicated tests.
    const tempHome = mkdtempSync(join(tmpdir(), "hmx-srvmgr-"));
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    const consentDir = join(tempHome, ".local", "state", "honeymux");
    mkdirSync(consentDir, { recursive: true });
    writeFileSync(
      join(consentDir, "claude-hooks-consent.json"),
      JSON.stringify({ hosts: { "dev-box": { consented: true, savedAt: 1 } }, version: 2 }),
    );

    try {
      const localClient = {} as any;
      const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

      const probedScriptPaths: string[] = [];
      const runRemoteShellCommand = mock(async (argv: string[]) => {
        const joined = argv.join(" ");
        if (joined.includes('printf "%s" "$HOME"')) {
          return { exitCode: 0, stderr: "", stdout: "/home/dev" };
        }
        if (joined.includes('if [ -e "$1" ]; then cat -- "$1"')) {
          const scriptPath = argv[argv.length - 1] ?? "";
          probedScriptPaths.push(scriptPath);
          return { exitCode: 3, stderr: "", stdout: "" };
        }
        return { exitCode: 0, stderr: "", stdout: "" };
      });

      (manager as any).clients.set("dev-box", { runRemoteShellCommand });

      await (manager as any).refreshRemoteHooksIfConsented("dev-box");

      // Claude's refresh ran through the manager's exec seam and probed for
      // the script under the remote-reported HOME — the wire-up works.
      expect(probedScriptPaths).toContain("/home/dev/.claude/hooks/honeymux.py");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      rmSync(tempHome, { force: true, recursive: true });
    }
  });

  it("is a no-op when there is no client for the server", async () => {
    const localClient = {} as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);
    await expect((manager as any).refreshRemoteHooksIfConsented("dev-box")).resolves.toBeUndefined();
  });
});
