import { describe, expect, it, mock } from "bun:test";

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
      close: mock(() => {}),
      localSocketPath: "/tmp/hmx-remote-hook.sock",
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
      sendCommand: mock(async () => "/dev/pts/7\t%77\t123\n"),
    });
    (manager as any).paneMappings.set("%10", {
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
      remoteHost: "remote-box",
      sessionId: "sess-1",
      status: "unanswered",
      timestamp: 1,
      transcriptPath: "/remote/state/transcript.jsonl",
      tty: "/dev/pts/7",
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
      getRemotePaneId: () => "%77",
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
      getRemotePaneId: () => undefined,
    });

    expect(manager.getRemoteConversionAvailability("%10", "dev-box")).toBe("ready");
    expect(manager.hasConvertibleRemoteServer("%10")).toBe(true);

    (manager as any).mirrors.set("dev-box", {
      getRemotePaneId: () => "%77",
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
    (manager as any).paneMappings.set("%10", {
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
    (manager as any).paneMappings.set("%10", {
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
    (manager as any).paneMappings.set("%10", {
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
    (manager as any).paneMappings.set("%10", {
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
    const fullSync = mock(async () => {
      remotePaneId = "%77";
    });

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand: mock(async () => ""),
    });
    (manager as any).mirrors.set("dev-box", {
      fullSync,
      getRemotePaneId: () => remotePaneId,
    });

    await manager.convertPane("%10", "dev-box");

    expect(fullSync).toHaveBeenCalledTimes(1);
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
        if (command === "respawn-pane -k -t %77") {
          proxyExpectState.hadExpectation = expectProxy.mock.calls.length === 1;
          proxyExpectState.hadMapping = (manager as any).paneMappings.get("%10")?.remotePaneId === "%77";
        }
        return "";
      }),
    });
    (manager as any).mirrors.set("dev-box", {
      getRemotePaneId: () => "%77",
    });

    await manager.convertPane("%10", "dev-box");

    expect(proxyExpectState).toEqual({
      hadExpectation: true,
      hadMapping: true,
    });
    expect(forgetProxy).not.toHaveBeenCalled();
  });

  it("stores the remote hook socket path in tmux state instead of process environment", async () => {
    const sendCommand = mock(async () => "");
    const localClient = {} as any;
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      remoteHookSocketPath: "/home/dev/.local/state/honeymux/runtime/hmx-remote-hook-0123456789abcdef.sock",
      sendCommand,
    });

    await (manager as any).configureRemoteHookSocketOption("dev-box");

    expect(sendCommand).toHaveBeenCalledWith(
      "set-option -gq @hmx-agent-socket-path '/home/dev/.local/state/honeymux/runtime/hmx-remote-hook-0123456789abcdef.sock'",
    );
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

    (manager as any).paneMappings.set("%10", {
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-a",
    });
    (manager as any).paneMappings.set("%11", {
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-b",
    });

    (manager as any).handleRemoteTmuxExit("dev-a");

    expect(killPaneById).toHaveBeenCalledTimes(1);
    expect(killPaneById).toHaveBeenCalledWith("%10");
    expect((manager as any).paneMappings.has("%10")).toBe(false);
    expect((manager as any).paneMappings.has("%11")).toBe(true);
    // 3 option clears (@hmx-remote-host, @hmx-remote-pane, @hmx-remote-token)
    // + 1 border reset.
    expect(runCommandArgs).toHaveBeenCalledTimes(4);
  });

  it("kills a mapped local proxy pane when the remote pane is dead but still listed", async () => {
    const killPaneById = mock(async () => {});
    const runCommandArgs = mock(async () => {});
    const localClient = {
      killPaneById,
      runCommandArgs,
    } as any;
    const sendCommand = mock(async () => " %77\t1\n %88\t0\n");
    const manager = new RemoteServerManager(localClient, [{ host: "dev-box", name: "dev-box" }]);

    (manager as any).clients.set("dev-box", {
      isConnected: true,
      sendCommand,
    });
    (manager as any).paneMappings.set("%10", {
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });
    (manager as any).paneMappings.set("%11", {
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-box",
    });

    await (manager as any).checkForDeadRemotePanes("dev-box");

    expect(sendCommand).toHaveBeenCalledWith("list-panes -a -F ' #{pane_id}\t#{pane_dead}'");
    expect(killPaneById).toHaveBeenCalledTimes(1);
    expect(killPaneById).toHaveBeenCalledWith("%10");
    expect((manager as any).paneMappings.has("%10")).toBe(false);
    expect((manager as any).paneMappings.get("%11")).toEqual({
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-box",
    });
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
      getRemotePaneId: (localId: string) => (localId === "%10" ? "%77" : undefined),
    });

    const converted: Array<[string, string]> = [];
    manager.on("pane-converted", (paneId: string, serverName: string) => {
      converted.push([paneId, serverName]);
    });

    await manager.recoverPaneMappings("dev-box");

    expect((manager as any).paneMappings.get("%10")).toEqual({
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
      getRemotePaneId: (localId: string) => (localId === "%10" ? "%77" : undefined),
    });

    await manager.recoverPaneMappings("dev-box");

    expect((manager as any).paneMappings.get("%10")).toEqual({
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
    expect((manager as any).paneMappings.has("%11")).toBe(false);
    expect((manager as any).paneMappings.has("%12")).toBe(false);
  });

  it("re-syncs connected mirrors when the active session changes", async () => {
    const localClient = new LocalEventClient();
    const manager = new RemoteServerManager(localClient as any, [{ host: "dev-box", name: "dev-box" }]);
    const fullSync = mock(async () => {});

    (manager as any).clients.set("dev-box", {
      isConnected: true,
    });
    (manager as any).mirrors.set("dev-box", {
      fullSync,
    });

    (manager as any).wireLocalEvents();

    localClient.emitEvent("session-window-changed");
    await Promise.resolve();

    expect(fullSync).toHaveBeenCalledTimes(1);
  });

  it("re-syncs mapped remote pane ids after a local layout change", async () => {
    const runCommandArgs = mock(async () => {});
    const localClient = Object.assign(new LocalEventClient(), { runCommandArgs });
    const manager = new RemoteServerManager(localClient as any, [{ host: "dev-box", name: "dev-box" }]);
    const remotePaneIds = new Map([
      ["%10", "%77"],
      ["%11", "%88"],
    ]);
    const onLayoutChange = mock(async () => {
      remotePaneIds.set("%11", "%99");
    });

    (manager as any).clients.set("dev-box", {
      isConnected: true,
    });
    (manager as any).mirrors.set("dev-box", {
      getRemotePaneId: (paneId: string) => remotePaneIds.get(paneId),
      onLayoutChange,
    });
    (manager as any).paneMappings.set("%10", {
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });
    (manager as any).paneMappings.set("%11", {
      localPaneId: "%11",
      remotePaneId: "%88",
      serverName: "dev-box",
    });

    (manager as any).wireLocalEvents();

    localClient.emitEvent("layout-change", "@1", "layout");
    await Promise.resolve();
    await Promise.resolve();

    expect(onLayoutChange).toHaveBeenCalledWith("@1", "layout");
    expect((manager as any).paneMappings.get("%10")).toEqual({
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });
    expect((manager as any).paneMappings.get("%11")).toEqual({
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
      getRemotePaneId: () => undefined,
    });

    await manager.recoverPaneMappings("dev-box");

    expect((manager as any).paneMappings.has("%10")).toBe(false);
    expect(expectProxy).not.toHaveBeenCalled();
    expect(respawnPane).not.toHaveBeenCalled();

    const clearedKeys = runCommandArgs.mock.calls
      .map((call: unknown[]) => call[0] as string[])
      .filter((argv: string[]) => argv[0] === "set-option" && argv[1] === "-pu")
      .map((argv: string[]) => argv[argv.length - 1]);
    expect(clearedKeys).toEqual(expect.arrayContaining(["@hmx-remote-host", "@hmx-remote-pane", "@hmx-remote-token"]));
  });

  it("skips panes already present in paneMappings", async () => {
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
    (manager as any).mirrors.set("dev-box", { getRemotePaneId: () => "%77" });
    (manager as any).paneMappings.set("%10", {
      localPaneId: "%10",
      remotePaneId: "%77",
      serverName: "dev-box",
    });

    await manager.recoverPaneMappings("dev-box");

    expect(expectProxy).not.toHaveBeenCalled();
    expect(respawnPane).not.toHaveBeenCalled();
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
    (manager as any).mirrors.set("dev-box", { getRemotePaneId: () => "%77" });

    await manager.convertPane("%10", "dev-box");

    const [, argv] = respawnPane.mock.calls[0]! as unknown as [string, string[]];
    const proxyToken = argv.at(-1)!;

    const tokenSet = runCommandArgs.mock.calls
      .map((call: unknown[]) => call[0] as string[])
      .find((a: string[]) => a[0] === "set-option" && a[4] === "@hmx-remote-token");
    expect(tokenSet).toEqual(["set-option", "-p", "-t", "%10", "@hmx-remote-token", proxyToken]);
  });
});
