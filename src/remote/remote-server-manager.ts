import { randomBytes } from "node:crypto";

import type { AgentEvent } from "../agents/types.ts";
import type { TmuxControlClient } from "../tmux/control-client.ts";
import type {
  RemoteAgentIngress,
  RemoteAgentIngressFactory,
  RemoteAgentIngressHandlers,
  RemoteAgentIngressOptions,
  RemotePermissionRoute,
} from "./agent-transport.ts";
import type { RemoteConnectionStatus, RemotePaneMapping, RemoteServerConfig, RemoteServerState } from "./types.ts";

import { escapeTmuxFormatLiteral, quoteTmuxArg } from "../tmux/escape.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { log } from "../util/log.ts";
import { getTmuxServer } from "../util/tmux-server.ts";
import { type RemotePaneBinding, validateRemoteAgentEvent } from "./agent-event-validator.ts";
import { ForwardedRemoteAgentIngressFactory } from "./agent-transport.ts";
import { MirrorLayoutManager } from "./mirror-layout.ts";
import { buildRemoteProxyProcessArgv } from "./proxy-command.ts";
import { RemoteProxyServer } from "./proxy-server.ts";
import { RemoteControlClient } from "./remote-control-client.ts";
import { validateSshDestination } from "./ssh.ts";

const REMOTE_TTY_CACHE_MS = 1_000;
const REMOTE_PID_BINDING_CACHE_MS = 1_000;
const LOCAL_PANE_METADATA_CACHE_MS = 1_000;
const REMOTE_HOOK_SOCKET_TMUX_OPTION = "@hmx-agent-socket-path";
const REMOTE_PID_BINDING_SCRIPT = [
  'pid="$1"',
  'tty="$2"',
  'pane_pid="$3"',
  'case "$pid" in (""|*[!0-9]*) exit 1;; esac',
  'case "$pane_pid" in (""|*[!0-9]*) exit 1;; esac',
  '[ "$pid" -gt 1 ] || exit 1',
  '[ "$pane_pid" -gt 1 ] || exit 1',
  'tty_name="$(ps -ww -o tty= -p "$pid" 2>/dev/null | tr -d "[:space:]")" || exit 1',
  'case "$tty_name" in (""|"?"|"??"|"-") exit 1;; esac',
  'case "$tty_name" in (/dev/*) tty_path="$tty_name";; (*) tty_path="/dev/$tty_name";; esac',
  '[ "$tty_path" = "$tty" ] || exit 1',
  'current="$pid"',
  'seen=" "',
  'while [ "$current" -gt 1 ]; do',
  '  [ "$current" = "$pane_pid" ] && exit 0',
  '  case "$seen" in *" $current "*) exit 1;; esac',
  '  seen="$seen$current "',
  '  parent="$(ps -o ppid= -p "$current" 2>/dev/null | tr -d "[:space:]")" || exit 1',
  '  case "$parent" in (""|*[!0-9]*) exit 1;; esac',
  '  [ "$parent" != "$current" ] || exit 1',
  '  current="$parent"',
  "done",
  "exit 1",
].join("\n");

interface CachedLocalPaneMeta {
  at: number;
  mappings: Map<string, { sessionName: string; windowId: string }>;
}

interface CachedRemotePaneBindingValidation {
  at: number;
  valid: boolean;
}

interface CachedRemotePaneIdentityMap {
  at: number;
  mappings: Map<string, { panePid: number; remotePaneId: string }>;
}

interface RemotePermissionState {
  route: RemotePermissionRoute;
  serverName: string;
  sessionId: string;
}

/**
 * Manages remote server connections, mirror layouts, and pane mappings.
 *
 * Events:
 *   mirror-state-change()
 *   server-status-change(serverName: string, status: RemoteConnectionStatus, error?: string)
 *   pane-converted(localPaneId: string, serverName: string)
 *   pane-reverted(localPaneId: string)
 *   agent-event(event: AgentEvent)
 *   warning(message: string)
 */
export class RemoteServerManager extends EventEmitter {
  private agentIngresses = new Map<string, RemoteAgentIngress>();
  private clients = new Map<string, RemoteControlClient>();
  private localPaneMetadataCache: CachedLocalPaneMeta = { at: 0, mappings: new Map() };
  private mirrors = new Map<string, MirrorLayoutManager>();
  private paneMappings = new Map<string, RemotePaneMapping>();
  private proxyServer: RemoteProxyServer;
  private remotePaneIdentityCache = new Map<string, CachedRemotePaneIdentityMap>();
  private remotePermissionStates = new Map<string, RemotePermissionState>();
  private remotePidBindingCache = new Map<string, CachedRemotePaneBindingValidation>();
  private remoteSessions = new Map<string, Map<string, AgentEvent>>();
  private servers = new Map<string, RemoteServerState>();
  private started = false;

  constructor(
    private localClient: TmuxControlClient,
    private configs: RemoteServerConfig[],
    private agentIngressFactory: RemoteAgentIngressFactory = new ForwardedRemoteAgentIngressFactory(),
  ) {
    super();
    this.proxyServer = new RemoteProxyServer();
  }

  /**
   * Convert a local pane to remote.
   * Starts a shell on the remote mirror pane and replaces the local pane
   * with a proxy process.
   */
  async convertPane(localPaneId: string, serverName: string): Promise<void> {
    log("remote", `convertPane start: local=${localPaneId} server=${this.serverTag(serverName)}`);

    const client = this.clients.get(serverName);
    const mirror = this.mirrors.get(serverName);
    if (!client || !mirror || !client.isConnected) {
      const err = `Server ${serverName} not connected`;
      log("remote", `convertPane failed: ${err}`);
      throw new Error(err);
    }

    // Find the corresponding remote pane
    const remotePaneId = mirror.getRemotePaneId(localPaneId);
    if (!remotePaneId) {
      const err = `No mirror pane found for ${localPaneId} on ${serverName}`;
      log("remote", `convertPane failed: ${err}`);
      throw new Error(err);
    }

    const proxyToken = randomBytes(32).toString("hex");

    // Install the mapping and proxy expectation before the remote shell is
    // respawned so any early prompt/output can be queued for the local proxy.
    this.paneMappings.set(localPaneId, {
      localPaneId,
      remotePaneId,
      serverName,
    });
    this.proxyServer.expectProxy(localPaneId, proxyToken);

    log("remote", `convertPane: remotePaneId=${remotePaneId}, respawning remote pane`);

    try {
      // Respawn the remote pane with a shell
      await client.sendCommand(`respawn-pane -k -t ${remotePaneId}`);

      // Mark the pane as remote and set the remote border format BEFORE the
      // local respawn, so that the layout-change tmux emits during the respawn
      // is observed by downstream features (e.g. pane tabs bootstrap) with the
      // remote metadata already in place. Otherwise a bootstrap pass can race
      // in and overwrite the remote border format with a pane tab.
      //
      // @hmx-remote-token persists the proxy's one-time token in tmux state
      // so a later Honeymux restart can re-accept the same long-lived proxy
      // process via `expectProxy` without respawning the local pane (which
      // would wipe the pane's visible content). The token is user-private
      // local state, same trust boundary as the rest of our tmux options.
      await this.setLocalPaneOption(localPaneId, "@hmx-remote-host", serverName);
      await this.setLocalPaneOption(localPaneId, "@hmx-remote-pane", remotePaneId);
      await this.setLocalPaneOption(localPaneId, "@hmx-remote-token", proxyToken);
      await this.updatePaneBorder(localPaneId, serverName);

      // Respawn the local pane with the proxy process
      log("remote", `convertPane: spawning proxy in local pane ${localPaneId}`);
      await this.localClient.respawnPane(localPaneId, buildRemoteProxyProcessArgv(localPaneId, proxyToken));
    } catch (error) {
      this.proxyServer.forgetProxy(localPaneId);
      this.paneMappings.delete(localPaneId);
      await this.clearLocalPaneOption(localPaneId, "@hmx-remote-host").catch(() => {});
      await this.clearLocalPaneOption(localPaneId, "@hmx-remote-pane").catch(() => {});
      await this.clearLocalPaneOption(localPaneId, "@hmx-remote-token").catch(() => {});
      await this.resetPaneBorder(localPaneId).catch(() => {});
      throw error;
    }

    log("remote", `convertPane done: local=${localPaneId} → remote=${remotePaneId} on ${this.serverTag(serverName)}`);
    this.emit("pane-converted", localPaneId, serverName);
  }

  /** Return the RemoteControlClient for a given server if it is currently connected. */
  getConnectedClient(serverName: string): RemoteControlClient | undefined {
    const client = this.clients.get(serverName);
    return client?.isConnected ? client : undefined;
  }

  /** Names of servers with an active SSH connection. */
  getConnectedServerNames(): string[] {
    const names: string[] = [];
    for (const [name, client] of this.clients) {
      if (client.isConnected) names.push(name);
    }
    return names;
  }

  getRemoteConversionAvailability(localPaneId: string, serverName: string): "ready" | "unavailable" | "waiting" {
    const client = this.clients.get(serverName);
    const mirror = this.mirrors.get(serverName);
    if (!client || !mirror || !client.isConnected) {
      return "unavailable";
    }
    return mirror.getRemotePaneId(localPaneId) ? "ready" : "waiting";
  }

  hasConvertibleRemoteServer(localPaneId: string): boolean {
    return this.configs.some((config) => this.getRemoteConversionAvailability(localPaneId, config.name) === "ready");
  }

  /** Check if a pane is remote. */
  isRemotePane(paneId: string): RemotePaneMapping | undefined {
    return this.paneMappings.get(paneId);
  }

  /**
   * Rebuild paneMappings for a server after Honeymux restart.
   *
   * Panes converted in a previous run have `@hmx-remote-host`,
   * `@hmx-remote-pane`, and `@hmx-remote-token` set in tmux state (which
   * survives restart), but Honeymux's in-memory paneMappings and the
   * proxy-server token table do not, so keystrokes and remote output
   * stop flowing until we rebuild them.
   *
   * Preferred path (token-reuse): when `@hmx-remote-token` is present, we
   * re-register the same token with the proxy server and let the
   * already-running proxy process in the local pane reconnect. This
   * preserves whatever content was visible in the pane when Honeymux
   * exited (no respawn).
   *
   * Legacy fallback (mint + respawn): if the token option is absent (pane
   * was converted by an older Honeymux that did not persist the token),
   * mint a fresh token, persist it, and respawn the local pane with a new
   * proxy process. The pane content is wiped in this path, but recovery
   * still succeeds.
   *
   * Panes whose mirror mapping no longer resolves are treated as orphaned:
   * all remote-pane metadata is cleared and the border is reset so they no
   * longer look remote. Expected to run after {@link
   * MirrorLayoutManager.fullSync} completes.
   */
  async recoverPaneMappings(serverName: string): Promise<void> {
    const mirror = this.mirrors.get(serverName);
    const client = this.clients.get(serverName);
    if (!mirror || !client || !client.isConnected) return;

    let output: string;
    try {
      output = await this.localClient.runCommand(
        "list-panes -a -F ' #{pane_id}\t#{@hmx-remote-host}\t#{@hmx-remote-token}'",
      );
    } catch (err) {
      log("remote", `recover: list-panes failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const candidates: Array<{ localPaneId: string; storedToken: string }> = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      // Strip only the leading single-space prefix (the format's `%N`-guard),
      // and the trailing CR if any. Do NOT trim tabs: a missing trailing
      // field (e.g. no @hmx-remote-token yet) is encoded as an empty
      // trailing tab-delimited column.
      const cleaned = line.replace(/^ /, "").replace(/\r$/, "");
      const [paneId, host, token = ""] = cleaned.split("\t");
      if (!paneId || host !== serverName) continue;
      if (this.paneMappings.has(paneId)) continue;
      candidates.push({ localPaneId: paneId, storedToken: token });
    }

    for (const { localPaneId, storedToken } of candidates) {
      const remotePaneId = mirror.getRemotePaneId(localPaneId);
      if (!remotePaneId) {
        log("remote", `recover: no mirror mapping for ${localPaneId}, clearing metadata`);
        await this.clearLocalPaneOption(localPaneId, "@hmx-remote-host").catch(() => {});
        await this.clearLocalPaneOption(localPaneId, "@hmx-remote-pane").catch(() => {});
        await this.clearLocalPaneOption(localPaneId, "@hmx-remote-token").catch(() => {});
        await this.resetPaneBorder(localPaneId).catch(() => {});
        continue;
      }

      this.paneMappings.set(localPaneId, {
        localPaneId,
        remotePaneId,
        serverName,
      });

      if (storedToken) {
        // Token-reuse path: no respawn, preserves the pane's visible content.
        this.proxyServer.expectProxy(localPaneId, storedToken);
        try {
          await this.setLocalPaneOption(localPaneId, "@hmx-remote-pane", remotePaneId);
          await this.updatePaneBorder(localPaneId, serverName);
          log(
            "remote",
            `recovered (token-reuse): local=${localPaneId} → remote=${remotePaneId} on ${this.serverTag(serverName)}`,
          );
          this.emit("pane-converted", localPaneId, serverName);
        } catch (err) {
          this.proxyServer.forgetProxy(localPaneId);
          this.paneMappings.delete(localPaneId);
          log("remote", `recover failed for ${localPaneId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      // Legacy pane (converted before token persistence): mint a fresh
      // token, persist it, and respawn the local pane so the new proxy can
      // register. Content in the pane will be wiped.
      const newToken = randomBytes(32).toString("hex");
      this.proxyServer.expectProxy(localPaneId, newToken);

      try {
        await this.setLocalPaneOption(localPaneId, "@hmx-remote-pane", remotePaneId);
        await this.setLocalPaneOption(localPaneId, "@hmx-remote-token", newToken);
        await this.updatePaneBorder(localPaneId, serverName);
        await this.localClient.respawnPane(localPaneId, buildRemoteProxyProcessArgv(localPaneId, newToken));
        log(
          "remote",
          `recovered (legacy-respawn): local=${localPaneId} → remote=${remotePaneId} on ${this.serverTag(serverName)}`,
        );
        this.emit("pane-converted", localPaneId, serverName);
      } catch (err) {
        this.proxyServer.forgetProxy(localPaneId);
        this.paneMappings.delete(localPaneId);
        log("remote", `recover failed for ${localPaneId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  respondToPermission(sessionId: string, toolUseId: string, decision: "allow" | "deny", paneId?: string): void {
    const key = toolUseId || sessionId;
    const serverNameHint = paneId ? this.paneMappings.get(paneId)?.serverName : undefined;
    const stateEntry = this.findPermissionState(sessionId, key, serverNameHint);
    if (!stateEntry) return;

    const [stateKey, state] = stateEntry;
    const ingress = this.agentIngresses.get(state.serverName);
    if (!ingress) {
      log("remote", `no agent ingress for ${state.serverName} — cannot deliver decision key=${key}`);
      return;
    }

    if (ingress.respondToPermission(state.route, decision)) {
      this.remotePermissionStates.delete(stateKey);
      return;
    }

    log("remote", `failed to write remote permission response for ${state.serverName} key=${key}`);
  }

  /**
   * Revert a remote pane back to local.
   * Kills the proxy and respawns a local shell.
   */
  async revertPane(localPaneId: string): Promise<void> {
    const mapping = this.paneMappings.get(localPaneId);
    if (!mapping) return;

    log("remote", `revertPane: local=${localPaneId} server=${this.serverTag(mapping.serverName)}`);
    this.proxyServer.forgetProxy(localPaneId);

    // Respawn local pane with a shell
    await this.localClient.respawnPane(localPaneId);

    // Clear metadata
    await this.clearLocalPaneOption(localPaneId, "@hmx-remote-host");
    await this.clearLocalPaneOption(localPaneId, "@hmx-remote-pane");
    await this.clearLocalPaneOption(localPaneId, "@hmx-remote-token");

    // Reset border to default
    await this.resetPaneBorder(localPaneId);

    this.paneMappings.delete(localPaneId);
    this.emit("pane-reverted", localPaneId);
  }

  /**
   * Route keyboard input to a remote pane.
   * Returns true if the pane is remote and input was consumed.
   */
  routeInput(paneId: string, data: string): boolean {
    const mapping = this.paneMappings.get(paneId);
    if (!mapping) return false;

    const client = this.clients.get(mapping.serverName);
    if (!client || !client.isConnected) return false;

    // Send raw bytes via send-keys -H (hex mode)
    const hex = Buffer.from(data).toString("hex").match(/.{2}/g)!.join(" ");
    client.sendCommand(`send-keys -H -t ${mapping.remotePaneId} ${hex}`).catch(() => {});
    return true;
  }

  /** Start all configured server connections in background. */
  async startAll(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.proxyServer.start();
    this.wireLocalEvents();

    for (const config of this.configs) {
      const hostError = validateSshDestination(config.host);
      const mirrorSession = `hmx-mirror-${getTmuxServer()}`;
      const state: RemoteServerState = {
        config,
        error: hostError ? `Invalid SSH destination: ${hostError}` : undefined,
        mirrorSession,
        status: hostError ? "error" : "disconnected",
      };
      this.servers.set(config.name, state);

      if (hostError) {
        this.emit("server-status-change", config.name, "error", state.error);
        continue;
      }

      let ingress: RemoteAgentIngress | null = null;
      try {
        const handlers: RemoteAgentIngressHandlers = {
          onEvent: (event) => {
            this.processRemoteAgentEvent(config.name, event).catch((err) => {
              log("remote", `remote agent event processing failed for ${this.serverTag(config.name)}: ${err.message}`);
            });
          },
        };
        const ingressOptions: RemoteAgentIngressOptions = {
          eventValidator: (event) => this.validateRemoteHookEvent(config.name, event),
        };
        ingress = this.agentIngressFactory.create(config.name, handlers, ingressOptions);
        ingress.start();
        this.agentIngresses.set(config.name, ingress);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("remote", `remote hook ingress start failed for ${this.serverTag(config.name)}: ${message}`);
        this.emit("warning", `Remote hook ingress failed for ${config.name}: ${message}`);
      }

      const client = new RemoteControlClient(
        config,
        mirrorSession,
        ingress ? { localSocketPath: ingress.localSocketPath } : undefined,
      );
      this.clients.set(config.name, client);

      const mirror = new MirrorLayoutManager(this.localClient, client);
      mirror.isRemotePaneActive = (remotePaneId: string) => {
        return this.findLocalPaneForRemote(config.name, remotePaneId) !== undefined;
      };
      this.mirrors.set(config.name, mirror);

      // Route remote %output to the correct proxy
      client.on("pane-output-bytes", (remotePaneId: string, data: Uint8Array) => {
        const localPaneId = this.findLocalPaneForRemote(config.name, remotePaneId);
        if (localPaneId) {
          this.proxyServer.sendOutput(localPaneId, data);
        }
      });

      // When a remote pane dies, clean up the local proxy pane.
      // window-close: pane was the last in its window (common for mirror panes)
      // layout-change: pane died in a multi-pane window
      // exit: entire remote session died (last pane exited)
      client.on("window-close", (windowId: string) => {
        this.handleRemotePaneDeath(config.name, mirror, windowId);
      });
      client.on("layout-change", (_windowId: string) => {
        this.checkForDeadRemotePanes(config.name).catch(() => {});
      });
      client.on("tmux-exit", () => {
        this.handleRemoteTmuxExit(config.name);
      });
      client.on("warning", (message: string) => {
        log("remote", `server ${config.name} warning: ${message}`);
        this.emit("warning", `Remote server ${config.name}: ${message}`);
      });
      // Plain SSH disconnects do not emit "tmux-exit", so pane mappings survive
      // reconnects. A protocol %exit means the remote tmux session itself ended,
      // so the mapped local proxy panes must be torn down.

      // Track status changes
      client.on("status-change", (status: RemoteConnectionStatus, error?: string, sshPid?: number) => {
        const pidSuffix = sshPid ? ` ssh_pid=${sshPid}` : "";
        log("remote", `server ${config.name}: status=${status}${pidSuffix}${error ? ` error=${error}` : ""}`);
        const s = this.servers.get(config.name);
        if (s) {
          s.status = status;
          s.error = error;
        }
        this.emit("server-status-change", config.name, status, error);

        // On reconnection, re-sync the mirror and check for dead panes
        if (status === "connected") {
          this.configureRemoteHookSocketOption(config.name).catch((err) => {
            log("remote", `remote hook option setup failed for ${this.serverTag(config.name)}: ${err.message}`);
            this.emit("warning", `Remote hook option setup failed for ${config.name}: ${err.message}`);
          });
          mirror
            .fullSync()
            .then(() => this.recoverPaneMappings(config.name))
            .then(() => this.checkForDeadRemotePanes(config.name))
            .then(() => {
              this.emitMirrorStateChange();
            })
            .catch((err) => {
              log("remote", `mirror sync failed for ${this.serverTag(config.name)}: ${err.message}`);
              this.emit("warning", `Mirror sync failed for ${config.name}: ${err.message}`);
            });
        } else if (status === "disconnected" || status === "error") {
          this.endRemoteSessionsForServer(config.name);
          this.remotePaneIdentityCache.delete(config.name);
          this.clearRemotePidBindingCache(config.name);
        }
      });

      // Start the reconnecting loop (runs in background)
      client.startReconnectLoop().catch(() => {});
    }
  }

  /** Stop all connections and clean up. */
  async stopAll(): Promise<void> {
    this.started = false;
    for (const ingress of this.agentIngresses.values()) {
      ingress.close();
    }
    this.agentIngresses.clear();
    this.clearRemoteAgentState(true);
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
    this.mirrors.clear();
    this.servers.clear();
    this.paneMappings.clear();
    this.remotePaneIdentityCache.clear();
    this.remotePidBindingCache.clear();
    this.localPaneMetadataCache = { at: 0, mappings: new Map() };
    this.proxyServer.stop();
  }

  /**
   * For layout-change events: query live remote panes and clean up any
   * mapped panes that no longer exist.
   */
  private async checkForDeadRemotePanes(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected) return;

    let output: string;
    try {
      output = await client.sendCommand("list-panes -a -F ' #{pane_id}'");
    } catch {
      // Connection failed during query — don't assume panes are dead
      return;
    }

    const livePanes = new Set(
      output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );

    // If we got no panes at all, the query likely failed — don't kill anything
    if (livePanes.size === 0) return;

    for (const [localPaneId, mapping] of [...this.paneMappings]) {
      if (mapping.serverName !== serverName) continue;
      if (!livePanes.has(mapping.remotePaneId)) {
        this.killLocalProxyPane(localPaneId);
      }
    }
  }

  // --- Private ---

  private async clearLocalPaneOption(paneId: string, key: string): Promise<void> {
    await this.localClient.runCommandArgs(["set-option", "-pu", "-t", paneId, key]);
  }

  private clearPermissionState(serverName: string, sessionId: string): void {
    for (const [key, state] of this.remotePermissionStates) {
      if (state.serverName === serverName && state.sessionId === sessionId) {
        this.remotePermissionStates.delete(key);
      }
    }
  }

  private clearRemoteAgentState(emitEnded: boolean): void {
    if (emitEnded) {
      for (const sessions of this.remoteSessions.values()) {
        for (const event of sessions.values()) {
          this.emit("agent-event", toEndedEvent(event));
        }
      }
    }

    this.remoteSessions.clear();
    this.remotePermissionStates.clear();
  }

  private clearRemotePidBindingCache(serverName: string): void {
    const prefix = `${serverName}\u0000`;
    for (const key of this.remotePidBindingCache.keys()) {
      if (key.startsWith(prefix)) {
        this.remotePidBindingCache.delete(key);
      }
    }
  }

  private async configureRemoteHookSocketOption(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const remoteHookSocketPath = client?.remoteHookSocketPath;
    if (!client || !remoteHookSocketPath) return;

    await client.sendCommand(
      `set-option -gq ${REMOTE_HOOK_SOCKET_TMUX_OPTION} ${quoteTmuxArg("remote hook socket path", remoteHookSocketPath)}`,
    );
  }

  private emitMirrorStateChange(): void {
    this.emit("mirror-state-change");
  }

  private endRemoteSessionsForLocalPane(localPaneId: string): void {
    for (const [serverName, sessions] of this.remoteSessions) {
      for (const [sessionId, event] of sessions) {
        if (event.paneId !== localPaneId) continue;
        this.clearPermissionState(serverName, sessionId);
        sessions.delete(sessionId);
        this.emit("agent-event", toEndedEvent(event));
      }
    }
  }

  private endRemoteSessionsForServer(serverName: string): void {
    const sessions = this.remoteSessions.get(serverName);
    if (!sessions) return;

    for (const [sessionId, event] of sessions) {
      this.clearPermissionState(serverName, sessionId);
      this.emit("agent-event", toEndedEvent(event));
    }

    this.remoteSessions.delete(serverName);
  }

  /** Find which local pane maps to a given remote pane on a server. */
  private findLocalPaneForRemote(serverName: string, remotePaneId: string): string | undefined {
    for (const [localPaneId, mapping] of this.paneMappings) {
      if (mapping.serverName === serverName && mapping.remotePaneId === remotePaneId) {
        return localPaneId;
      }
    }
    return undefined;
  }

  private findPermissionState(
    sessionId: string,
    routeKey: string,
    serverNameHint?: string,
  ): [stateKey: string, state: RemotePermissionState] | undefined {
    for (const entry of this.remotePermissionStates) {
      const [stateKey, state] = entry;
      if (serverNameHint && state.serverName !== serverNameHint) continue;
      if (state.sessionId === sessionId && state.route.key === routeKey) {
        return [stateKey, state];
      }
    }
    return undefined;
  }

  private async getLocalPaneMetadata(paneId: string): Promise<{ sessionName: string; windowId: string } | undefined> {
    const now = Date.now();
    if (now - this.localPaneMetadataCache.at >= LOCAL_PANE_METADATA_CACHE_MS) {
      try {
        const tree = await this.localClient.getFullTree();
        const mappings = new Map<string, { sessionName: string; windowId: string }>();
        for (const pane of tree.panes) {
          mappings.set(pane.id, {
            sessionName: pane.sessionName,
            windowId: pane.windowId,
          });
        }
        this.localPaneMetadataCache = {
          at: now,
          mappings,
        };
      } catch {
        return this.localPaneMetadataCache.mappings.get(paneId);
      }
    }

    return this.localPaneMetadataCache.mappings.get(paneId);
  }

  private async getRemotePaneBindingForTty(serverName: string, tty: string): Promise<RemotePaneBinding | undefined> {
    const identity = await this.getRemotePaneIdentityForTty(serverName, tty);
    if (!identity) return undefined;

    const localPaneId = this.findLocalPaneForRemote(serverName, identity.remotePaneId);
    if (!localPaneId) return undefined;

    return {
      localPaneId,
      panePid: identity.panePid,
      remotePaneId: identity.remotePaneId,
    };
  }

  private async getRemotePaneIdentityForTty(
    serverName: string,
    tty: string,
  ): Promise<{ panePid: number; remotePaneId: string } | undefined> {
    const cached = this.remotePaneIdentityCache.get(serverName);
    const now = Date.now();
    if (cached && now - cached.at < REMOTE_TTY_CACHE_MS) {
      return cached.mappings.get(tty);
    }

    const client = this.clients.get(serverName);
    if (!client || !client.isConnected) return undefined;

    try {
      const output = await client.sendCommand("list-panes -a -F '#{pane_tty}\t#{pane_id}\t#{pane_pid}'");
      const mappings = new Map<string, { panePid: number; remotePaneId: string }>();
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        const paneTty = parts[0];
        const paneId = parts[1];
        const panePid = parseInt(parts[2] ?? "", 10);
        if (!paneTty || !paneId || !Number.isInteger(panePid) || panePid <= 1) continue;
        mappings.set(paneTty, { panePid, remotePaneId: paneId });
      }
      this.remotePaneIdentityCache.set(serverName, { at: now, mappings });
      return mappings.get(tty);
    } catch {
      return undefined;
    }
  }

  /**
   * Handle a remote window closing. Since each mirror window maps to a local
   * window, any pane mapped to that remote window is now dead.
   */
  private handleRemotePaneDeath(serverName: string, _mirror: MirrorLayoutManager, _remoteWindowId: string): void {
    // A remote window closed — use the query-based check to find dead panes
    this.checkForDeadRemotePanes(serverName).catch(() => {});
  }

  private handleRemoteTmuxExit(serverName: string): void {
    log("remote", `handleRemoteTmuxExit: ${this.serverTag(serverName)}`);
    for (const [localPaneId, mapping] of [...this.paneMappings]) {
      if (mapping.serverName !== serverName) continue;
      this.killLocalProxyPane(localPaneId);
    }
  }

  private async isRemotePidBoundToPane(
    serverName: string,
    pid: number,
    tty: string,
    panePid: number,
  ): Promise<boolean> {
    const cacheKey = `${serverName}\u0000${pid}\u0000${tty}\u0000${panePid}`;
    const cached = this.remotePidBindingCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < REMOTE_PID_BINDING_CACHE_MS) {
      return cached.valid;
    }

    const client = this.clients.get(serverName);
    if (!client || !client.isConnected) return false;

    try {
      const result = await client.runRemoteShellCommand([
        "sh",
        "-lc",
        REMOTE_PID_BINDING_SCRIPT,
        "sh",
        String(pid),
        tty,
        String(panePid),
      ]);
      const valid = result.exitCode === 0;
      this.remotePidBindingCache.set(cacheKey, { at: now, valid });
      return valid;
    } catch {
      return false;
    }
  }

  /** Clean up a local proxy pane whose remote pane died. */
  private killLocalProxyPane(localPaneId: string): void {
    log("remote", `killLocalProxyPane: ${localPaneId} (remote pane died)`);
    this.endRemoteSessionsForLocalPane(localPaneId);
    this.paneMappings.delete(localPaneId);
    this.proxyServer.forgetProxy(localPaneId);
    this.clearLocalPaneOption(localPaneId, "@hmx-remote-host").catch(() => {});
    this.clearLocalPaneOption(localPaneId, "@hmx-remote-pane").catch(() => {});
    this.clearLocalPaneOption(localPaneId, "@hmx-remote-token").catch(() => {});
    this.resetPaneBorder(localPaneId).catch(() => {});
    // kill-pane — if it's the last pane, tmux destroys the session
    // and sends %exit, which triggers Honeymux's normal shutdown
    this.localClient.killPaneById(localPaneId).catch(() => {});
    this.emit("pane-reverted", localPaneId);
  }

  private async normalizeRemoteAgentEvent(serverName: string, event: AgentEvent): Promise<AgentEvent> {
    const normalized: AgentEvent = {
      ...event,
      isRemote: true,
      paneId: undefined,
      remoteHost: event.remoteHost || this.servers.get(serverName)?.config.name || serverName,
      remoteServerName: this.servers.get(serverName)?.config.name ?? serverName,
      sessionName: undefined,
      transcriptPath: undefined,
      windowId: undefined,
    };

    if (!event.tty) return normalized;

    const binding = await this.getRemotePaneBindingForTty(serverName, event.tty);
    if (!binding) return normalized;

    normalized.paneId = binding.localPaneId;
    const localPaneMeta = await this.getLocalPaneMetadata(binding.localPaneId);
    if (localPaneMeta) {
      normalized.sessionName = localPaneMeta.sessionName;
      normalized.windowId = localPaneMeta.windowId;
    }
    return normalized;
  }

  private async processRemoteAgentEvent(serverName: string, event: AgentEvent): Promise<void> {
    const normalized = await this.normalizeRemoteAgentEvent(serverName, event);

    let sessions = this.remoteSessions.get(serverName);
    if (!sessions) {
      sessions = new Map();
      this.remoteSessions.set(serverName, sessions);
    }

    if (normalized.status === "ended") {
      sessions.delete(normalized.sessionId);
      this.clearPermissionState(serverName, normalized.sessionId);
    } else {
      sessions.set(normalized.sessionId, normalized);
      this.updatePermissionState(serverName, normalized);
    }

    this.emit("agent-event", normalized);
  }

  private async resetPaneBorder(localPaneId: string): Promise<void> {
    await this.localClient
      .runCommandArgs(["set-option", "-pu", "-t", localPaneId, "pane-border-format"])
      .catch(() => {});
  }

  /** Format server name + ssh pid for log messages. */
  private serverTag(serverName: string): string {
    const pid = this.clients.get(serverName)?.sshPid;
    return pid ? `${serverName} (ssh pid=${pid})` : serverName;
  }

  private async setLocalPaneOption(paneId: string, key: string, value: string): Promise<void> {
    await this.localClient.runCommandArgs(["set-option", "-p", "-t", paneId, key, value]);
  }

  private async updatePaneBorder(localPaneId: string, serverName: string): Promise<void> {
    // Center the server name with ↗ prefix, use dashes to simulate simple border style
    const label = ` ↗ ${escapeTmuxFormatLiteral(serverName)} `;
    const fmt = `#[align=centre]#[fg=#6699CC]${label}#[default]`;
    await this.localClient.setPaneBorderFormat(localPaneId, fmt).catch(() => {});
  }

  private updatePermissionState(serverName: string, event: AgentEvent): void {
    this.clearPermissionState(serverName, event.sessionId);
    if (event.status !== "unanswered") return;

    const key = event.toolUseId ?? event.sessionId;
    this.remotePermissionStates.set(buildPermissionStateKey(serverName, key), {
      route: {
        agentType: event.agentType,
        key,
      },
      serverName,
      sessionId: event.sessionId,
    });
  }

  private async validateRemoteHookEvent(serverName: string, event: AgentEvent): Promise<boolean> {
    const valid = await validateRemoteAgentEvent(event, {
      resolvePaneBinding: (tty) => this.getRemotePaneBindingForTty(serverName, tty),
      validateProcessBinding: (pid, tty, panePid) => this.isRemotePidBoundToPane(serverName, pid, tty, panePid),
    });
    if (!valid) {
      log(
        "remote",
        `rejected remote hook event for ${this.serverTag(serverName)} session=${event.sessionId} pid=${event.pid ?? "<none>"} tty=${event.tty ?? "<none>"}`,
      );
    }
    return valid;
  }

  /** Wire local control client events to mirror managers. */
  private wireLocalEvents(): void {
    this.localClient.on("session-window-changed", () => {
      for (const [serverName, mirror] of this.mirrors) {
        const client = this.clients.get(serverName);
        if (!client?.isConnected) continue;
        // Detached/new sessions do not reliably emit window-add to the
        // currently attached control client, so a session switch needs a full
        // mirror rescan to make newly created panes convertible.
        mirror
          .fullSync()
          .then(() => {
            this.emitMirrorStateChange();
          })
          .catch((err) => {
            this.emit("warning", `Mirror session sync failed: ${err.message}`);
          });
      }
    });

    this.localClient.on("layout-change", (windowId: string, layoutStr: string) => {
      for (const mirror of this.mirrors.values()) {
        mirror
          .onLayoutChange(windowId, layoutStr)
          .then(() => {
            this.emitMirrorStateChange();
          })
          .catch((err) => {
            this.emit("warning", `Mirror layout sync failed: ${err.message}`);
          });
      }
    });

    this.localClient.on("window-add", (windowId: string) => {
      for (const mirror of this.mirrors.values()) {
        mirror
          .onWindowAdd(windowId)
          .then(() => {
            this.emitMirrorStateChange();
          })
          .catch(() => {});
      }
    });

    this.localClient.on("window-close", (windowId: string) => {
      for (const mirror of this.mirrors.values()) {
        mirror
          .onWindowClose(windowId)
          .then(() => {
            this.emitMirrorStateChange();
          })
          .catch(() => {});
      }
    });
  }
}

function buildPermissionStateKey(serverName: string, routeKey: string): string {
  return `${serverName}\u0000${routeKey}`;
}

function toEndedEvent(event: AgentEvent): AgentEvent {
  return {
    ...event,
    hookEvent: "SessionEnd",
    status: "ended",
    timestamp: Date.now() / 1000,
    toolInput: undefined,
    toolName: undefined,
    toolUseId: undefined,
  };
}
