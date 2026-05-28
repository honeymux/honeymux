import { randomBytes } from "node:crypto";

import type { HookEventValidatorContext } from "../agents/socket-server.ts";
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

import { refreshClaudeHooksIfConsented } from "../agents/claude/installer.ts";
import { refreshCodexHooksIfConsented } from "../agents/codex/installer.ts";
import { refreshGeminiHooksIfConsented } from "../agents/gemini/installer.ts";
import { refreshOpenCodePluginIfConsented } from "../agents/opencode/installer.ts";
import { escapeTmuxFormatLiteral, quoteTmuxArg } from "../tmux/escape.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { log } from "../util/log.ts";
import { getTmuxServer } from "../util/tmux-server.ts";
import { type RemotePaneBinding, validateRemoteAgentEvent } from "./agent-event-validator.ts";
import { ForwardedRemoteAgentIngressFactory } from "./agent-transport.ts";
import { resolveMirrorTmuxServerName } from "./mirror-server-name.ts";
import { RemoteMirror } from "./mirror/remote-mirror.ts";
import { RoutingCache } from "./mirror/routing-cache.ts";
import { LOCAL_PANE_ID_TAG, type MirrorSnapshot } from "./mirror/snapshot.ts";
import { extractBracketedPastePayload, pasteTextIntoRemotePane } from "./paste.ts";
import { buildRemoteProxyProcessArgv } from "./proxy-command.ts";
import { RemoteProxyServer } from "./proxy-server.ts";
import { RemoteControlClient } from "./remote-control-client.ts";
import { RemoteInstallHost } from "./remote-install-host.ts";
import { validateSshDestination } from "./ssh.ts";

const REMOTE_PANE_CACHE_MS = 1_000;
const REMOTE_PID_BINDING_CACHE_MS = 1_000;
const LOCAL_PANE_METADATA_CACHE_MS = 1_000;
const REMOTE_LIVENESS_INTERVAL_MS = 5_000;
const REMOTE_HOOK_SOCKET_TMUX_OPTION = "@hmx-agent-socket-path";
const REMOTE_LIVENESS_SCRIPT = [
  'for pid in "$@"; do',
  '  case "$pid" in (""|*[!0-9]*) continue;; esac',
  '  [ "$pid" -gt 1 ] || continue',
  '  if kill -0 "$pid" 2>/dev/null; then',
  '    echo "$pid"',
  "  fi",
  "done",
].join("\n");
const REMOTE_PID_BINDING_SCRIPT = [
  'pid="$1"',
  'pane_pid="$2"',
  'case "$pid" in (""|*[!0-9]*) exit 1;; esac',
  'case "$pane_pid" in (""|*[!0-9]*) exit 1;; esac',
  '[ "$pid" -gt 1 ] || exit 1',
  '[ "$pane_pid" -gt 1 ] || exit 1',
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
  /** Remote pane id → remote pane pid (as reported by remote tmux). */
  mappings: Map<string, number>;
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
  private localEventUnsubscribers: Array<() => void> = [];
  private localPaneMetadataCache: CachedLocalPaneMeta = { at: 0, mappings: new Map() };
  /**
   * When true, local-side tmux events stop triggering reconcile requests.
   * Used by the sidebar drag handler: during a drag, ptyRef.resize fires
   * on every mouse move, producing a burst of local `%layout-change`
   * events that would each kick off an SSH reconcile capturing a partial
   * intermediate layout. Pausing collapses the burst into one reconcile
   * fired on drag release. See `pauseLocalReconcile`/`resumeLocalReconcile`.
   */
  private localReconcilePaused = false;
  private mirrors = new Map<string, RemoteMirror>();
  /** Pending registration disposers held during convertPane's mid-mutation window. */
  private pendingRegistrations = new Map<string, () => void>();
  private proxyServer: RemoteProxyServer;
  private remoteLivenessInFlight = false;
  private remoteLivenessTimer: ReturnType<typeof setInterval> | null = null;
  private remotePaneIdentityCache = new Map<string, CachedRemotePaneIdentityMap>();
  private remotePermissionStates = new Map<string, RemotePermissionState>();
  private remotePidBindingCache = new Map<string, CachedRemotePaneBindingValidation>();
  private remoteSessions = new Map<string, Map<string, AgentEvent>>();
  /** Single derived view of all local→remote pane bindings, snapshot-driven. */
  private routing = new RoutingCache();
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
    const client = this.clients.get(serverName);
    const mirror = this.mirrors.get(serverName);
    if (!client || !mirror || !client.isConnected) {
      const err = `Server ${serverName} not connected`;
      log("remote", `convertPane failed: ${err}`);
      throw new Error(err);
    }

    let remotePaneId = mirror.remotePaneFor(localPaneId);
    if (!remotePaneId) {
      log(
        "remote",
        `convertPane: missing mirror mapping for ${localPaneId} on ${this.serverTag(serverName)}, forcing sync`,
      );
      mirror.request();
      await mirror.whenIdle();
      this.emitMirrorStateChange();
      remotePaneId = mirror.remotePaneFor(localPaneId);
    }

    if (!remotePaneId) {
      const err = `No mirror pane found for ${localPaneId} on ${serverName}`;
      log("remote", `convertPane failed: ${err}`);
      throw new Error(err);
    }

    const proxyToken = randomBytes(32).toString("hex");

    // Install the routing binding and proxy expectation before the remote
    // shell is respawned so any early prompt/output can be queued for the
    // local proxy. The routing-cache hold survives one reconcile after
    // release; the disposer fires below in the catch and when the remote
    // pane dies (revertLocalPaneOnRemoteExit).
    const releaseRouting = this.routing.register({ localPaneId, remotePaneId, serverName });
    this.pendingRegistrations.set(localPaneId, releaseRouting);
    this.proxyServer.expectProxy(localPaneId, proxyToken);

    try {
      // Respawn the remote pane with a shell
      await client.sendCommand(`respawn-pane -k -t ${quoteTmuxArg("remotePaneId", remotePaneId)}`);

      // Claim the phantom for this local pane with a durable identity tag.
      // Un-converted phantoms are paired positionally and stay untagged (so
      // pane-tabs swaps don't churn the mirror), but a converted pane carries
      // routing identity: subsequent reconciles must pair it by
      // @hmx-local-pane-id, or the now-remote-backed local pane reads as
      // unpaired and the reconciler splits a second remote pane while
      // orphaning the one the proxy is bound to. Committed before the local
      // pane is marked remote-backed below, so no reconcile ever observes a
      // converted-but-unclaimed pane.
      await client.sendCommand(
        `set-option -p -t ${quoteTmuxArg("remotePaneId", remotePaneId)} ${LOCAL_PANE_ID_TAG} ${quoteTmuxArg("localPaneId", localPaneId)}`,
      );

      // The remote pane's content was just reset by `respawn-pane`. Drop
      // the mirror's cached layout assertion for the enclosing window so
      // the next syncWindowPanes (triggered by the local respawn below)
      // re-applies select-layout — that's what kicks tmux to re-assert
      // pane geometry against the current client size and flush the
      // freshly spawned shell's output to control-mode subscribers.
      const localMeta = await this.getLocalPaneMetadata(localPaneId);
      if (localMeta) mirror.invalidateLayoutForLocalWindow(localMeta.windowId);

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
      await this.localClient.respawnPane(localPaneId, buildRemoteProxyProcessArgv(localPaneId, proxyToken));
    } catch (error) {
      this.proxyServer.forgetProxy(localPaneId);
      releaseRouting();
      this.routing.delete(localPaneId);
      this.pendingRegistrations.delete(localPaneId);
      await this.clearLocalRemotePaneState(localPaneId);
      throw error;
    }

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
    return mirror.remotePaneFor(localPaneId) ? "ready" : "waiting";
  }

  hasConvertibleRemoteServer(localPaneId: string): boolean {
    return this.configs.some(
      (config) => this.getRemoteConversionAvailability(localPaneId, config.name) !== "unavailable",
    );
  }

  /** Check if a pane is remote. */
  isRemotePane(paneId: string): RemotePaneMapping | undefined {
    return this.routing.lookup(paneId);
  }

  /**
   * Stop triggering reconciles from local-side tmux events until
   * {@link resumeLocalReconcile} is called. Used to suppress the burst
   * of `%layout-change` events produced by a sidebar drag so the
   * accumulated change collapses into a single reconcile on release.
   * Idempotent.
   */
  pauseLocalReconcile(): void {
    this.localReconcilePaused = true;
  }

  /**
   * Re-register proxy tokens for a server after Honeymux restart.
   *
   * Panes converted in a previous run have `@hmx-remote-host`,
   * `@hmx-remote-pane`, and `@hmx-remote-token` set in tmux state (which
   * survives restart), but Honeymux's RoutingCache and the proxy-server
   * token table do not, so keystrokes and remote output stop flowing
   * until we rebuild them.
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
   * longer look remote. Expected to run after the mirror's first reconcile
   * pass completes so `mirror.remotePaneFor()` is populated.
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
      // Skip panes this Honeymux instance has already claimed. Starts
      // empty each launch; populated by convertPane and below.
      if (this.pendingRegistrations.has(paneId)) continue;
      candidates.push({ localPaneId: paneId, storedToken: token });
    }

    for (const { localPaneId, storedToken } of candidates) {
      const remotePaneId = mirror.remotePaneFor(localPaneId);
      if (!remotePaneId) {
        log("remote", `recover: no mirror mapping for ${localPaneId}, clearing metadata`);
        await this.clearLocalRemotePaneState(localPaneId);
        continue;
      }

      const releaseRouting = this.routing.register({ localPaneId, remotePaneId, serverName });
      this.pendingRegistrations.set(localPaneId, releaseRouting);

      if (storedToken) {
        // Token-reuse path: no respawn, preserves the pane's visible content.
        this.proxyServer.expectProxy(localPaneId, storedToken);
        try {
          await this.setLocalPaneOption(localPaneId, "@hmx-remote-pane", remotePaneId);
          await this.updatePaneBorder(localPaneId, serverName);
          this.emit("pane-converted", localPaneId, serverName);
        } catch (err) {
          this.proxyServer.forgetProxy(localPaneId);
          releaseRouting();
          this.routing.delete(localPaneId);
          this.pendingRegistrations.delete(localPaneId);
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
        this.emit("pane-converted", localPaneId, serverName);
      } catch (err) {
        this.proxyServer.forgetProxy(localPaneId);
        releaseRouting();
        this.routing.delete(localPaneId);
        this.pendingRegistrations.delete(localPaneId);
        log("remote", `recover failed for ${localPaneId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  respondToPermission(sessionId: string, toolUseId: string, decision: "allow" | "deny", paneId?: string): void {
    const key = toolUseId || sessionId;
    const serverNameHint = paneId ? this.routing.lookup(paneId)?.serverName : undefined;
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
   * Re-enable local-side reconcile triggers (paired with
   * {@link pauseLocalReconcile}). Fires one reconcile immediately to
   * flush any layout changes that occurred during the paused window.
   * Idempotent: a no-op when not currently paused.
   */
  resumeLocalReconcile(): void {
    if (!this.localReconcilePaused) return;
    this.localReconcilePaused = false;
    this.dispatchLocalReconcile();
  }

  /**
   * Intercept keyboard input that needs special handling before reaching the
   * remote pane. Returns true when the input was consumed and must NOT also
   * be written to the local PTY.
   *
   * Plain typing flows through local tmux's input layer instead — local tmux
   * processes its prefix combos, command-prompt, copy-mode, and other capture
   * states natively, then forwards whatever it didn't consume into the local
   * proxy pane, which forwards stdin to the remote via "proxy-input". Bracket
   * paste is the one case that still needs out-of-band handling because
   * `send-keys` cannot reliably carry long binary payloads.
   */
  routeInput(paneId: string, data: string): boolean {
    const mapping = this.routing.lookup(paneId);
    if (!mapping) return false;

    const client = this.clients.get(mapping.serverName);
    if (!client || !client.isConnected) return false;

    const pasteText = extractBracketedPastePayload(data);
    if (pasteText === null) return false;

    pasteTextIntoRemotePane(client, mapping.remotePaneId, pasteText).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log(
        "remote",
        `remote paste failed for ${this.serverTag(mapping.serverName)} pane=${mapping.remotePaneId}: ${message}`,
      );
      this.emit("warning", `Remote paste failed for ${mapping.serverName}: ${message}`);
    });
    return true;
  }

  /**
   * Probe each tracked remote agent's pid on its server in a single batched
   * `kill -0` round trip and emit `agent-event` with status `ended` for any
   * session whose pid is gone. Mirrors the local pid-based liveness check
   * (see {@link AgentSessionStore.runLivenessCheckOnce}); without this,
   * forced agent exits on the remote (Ctrl+C, kill, crash) leave the
   * session in the sidebar until the entire remote shell exits.
   *
   * Public so tests can drive a single pass without the interval timer.
   */
  async runRemoteLivenessCheckOnce(): Promise<void> {
    if (!this.started) return;
    for (const [serverName, sessions] of this.remoteSessions) {
      if (sessions.size === 0) continue;
      const client = this.clients.get(serverName);
      if (!client || !client.isConnected) continue;

      const sessionsByPid = new Map<number, AgentEvent[]>();
      for (const event of sessions.values()) {
        const pid = event.pid;
        if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) continue;
        const bucket = sessionsByPid.get(pid);
        if (bucket) bucket.push(event);
        else sessionsByPid.set(pid, [event]);
      }
      if (sessionsByPid.size === 0) continue;

      const pids = [...sessionsByPid.keys()];
      let result: { exitCode: number; stdout: string };
      try {
        result = await client.runRemoteShellCommand(["sh", "-lc", REMOTE_LIVENESS_SCRIPT, "sh", ...pids.map(String)]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("remote", `remote liveness probe failed for ${this.serverTag(serverName)}: ${message}`);
        continue;
      }
      if (result.exitCode !== 0) continue;
      // stopAll() may have run during the SSH round-trip above; bail before
      // emitting ended events into a torn-down manager (double-emit with
      // clearRemoteAgentState).
      if (!this.started) return;

      const alivePids = new Set<number>();
      for (const line of result.stdout.split("\n")) {
        const n = Number(line.trim());
        if (Number.isInteger(n)) alivePids.add(n);
      }

      for (const [pid, events] of sessionsByPid) {
        if (alivePids.has(pid)) continue;
        for (const event of events) {
          this.clearPermissionState(serverName, event.sessionId);
          sessions.delete(event.sessionId);
          this.emit("agent-event", toEndedEvent(event));
        }
      }
    }
  }

  /** Start all configured server connections in background. */
  async startAll(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.proxyServer.start();
    this.proxyServer.on("proxy-input", this.handleProxyInput);
    this.wireLocalEvents();
    this.startRemoteLivenessCheck();

    const mirrorServerName = await resolveMirrorTmuxServerName(this.localClient);

    for (const config of this.configs) {
      const hostError = validateSshDestination(config.host);
      const mirrorSession = `__hmx-mirror-${getTmuxServer()}`;
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
          eventValidator: (event, ctx) => this.validateRemoteHookEvent(config.name, event, ctx),
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
        mirrorServerName,
        mirrorSession,
        ingress ? { authToken: ingress.authToken, localTcpPort: ingress.localTcpPort } : undefined,
      );
      this.clients.set(config.name, client);

      const mirror = new RemoteMirror({
        activeBindings: () => this.getActiveBindingsForServer(config.name),
        onReconciled: ({ local, remote }) => {
          // Refresh the per-server routing cache from the latest local
          // snapshot. Tags (@hmx-remote-host + @hmx-remote-pane) are the
          // authoritative binding source; pending registrations
          // installed by convertPane / recoverPaneMappings survive the
          // rebuild until their disposers fire.
          this.routing.rebuildForServer(config.name, local);
          // Bring routing in line with the mirror's pane index BEFORE
          // cleanup. The local `@hmx-remote-pane` tag can lag the mirror
          // by one cycle when a local pane was moved between windows
          // and the new peer was just split in: the tag still names the
          // (now-killed) old peer. Without this update, cleanup's
          // "remote peer is dead" check would fire against a stale
          // routing entry and revert the live local proxy. The sync
          // method's synchronous portion fixes routing immediately;
          // the trailing local-tag rewrite is fire-and-forget.
          this.syncPaneMappingsFromMirror(config.name).catch(() => {});
          // Kill local proxy panes whose paired remote pane has vanished
          // from the remote snapshot.
          this.cleanupDeadLocalProxiesForServer(config.name, remote);
          this.emitMirrorStateChange();
        },
        onWarning: (warning) => {
          log("remote", `mirror integrity (${this.serverTag(config.name)}): ${warning.message}`);
          this.emit("warning", `Remote mirror integrity (${config.name}): ${warning.message}`);
        },
        runLocal: (cmd) => this.localClient.runCommand(cmd),
        runRemote: (cmd) => client.sendCommand(cmd),
        serverName: config.name,
      });
      this.mirrors.set(config.name, mirror);

      // Route remote %output to the correct proxy
      client.on("pane-output-bytes", (remotePaneId: string, data: Uint8Array) => {
        const localPaneId = this.findLocalPaneForRemote(config.name, remotePaneId);
        if (localPaneId) {
          this.proxyServer.sendOutput(localPaneId, data);
        }
      });

      // Single reconcile request per remote-driven event. The queue inside
      // RemoteMirror coalesces bursts (a typical session-window-changed
      // can fan to many layout-change/window-add/window-close emits).
      //
      // Gate on isConnected: `new-session -A` attaching to a populated mirror
      // emits layout/window events during the pre-bootstrap window, when
      // sendCommand still rejects with "Client closed". Acting on those would
      // spam the log and reset the first-sync gate; the authoritative
      // post-connect mirror.request() below performs the initial sync.
      const requestReconcileIfReady = (): void => {
        if (client.isConnected) mirror.request();
      };
      client.on("window-close", requestReconcileIfReady);
      client.on("window-add", requestReconcileIfReady);
      client.on("layout-change", requestReconcileIfReady);
      client.on("tmux-exit", () => {
        this.handleRemoteTmuxExit(config.name);
      });
      client.on("warning", (message: string) => {
        this.emit("warning", `Remote server ${config.name}: ${message}`);
      });
      // Plain SSH disconnects do not emit "tmux-exit", so pane mappings survive
      // reconnects. A protocol %exit means the remote tmux session itself ended,
      // so the mapped local proxy panes must be torn down.

      // sshd announces the allocated remote forward port on stderr; the control-mode
      // `connected` event and the stderr line race. If `connected` fires first, the
      // `configureRemoteHookSocketOption` call there will see remoteHookTcpPort
      // === undefined and bail. This handler re-runs it once the port resolves so the
      // tmux user-option always ends up populated.
      client.on("hook-port-resolved", () => {
        this.configureRemoteHookSocketOption(config.name).catch((err) => {
          log("remote", `remote hook option setup failed for ${this.serverTag(config.name)}: ${err.message}`);
          this.emit("warning", `Remote hook option setup failed for ${config.name}: ${err.message}`);
        });
      });

      // Track status changes
      client.on("status-change", (status: RemoteConnectionStatus, error?: string, _sshPid?: number) => {
        const s = this.servers.get(config.name);
        if (s) {
          s.status = status;
          s.error = error;
        }
        this.emit("server-status-change", config.name, status, error);

        // On reconnection, re-sync the mirror and recover proxy tokens.
        // The reconcile queue handles mirror structure; recoverPaneMappings
        // handles local proxy-token re-registration for panes that
        // survived a Honeymux restart.
        if (status === "connected") {
          this.configureRemoteHookSocketOption(config.name).catch((err) => {
            log("remote", `remote hook option setup failed for ${this.serverTag(config.name)}: ${err.message}`);
            this.emit("warning", `Remote hook option setup failed for ${config.name}: ${err.message}`);
          });
          this.refreshRemoteHooksIfConsented(config.name).catch(() => {
            // best-effort — refresh* helpers swallow per-agent errors internally
          });
          mirror.request();
          mirror
            .whenIdle()
            .then(() => this.recoverPaneMappings(config.name))
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

    for (const unsubscribe of this.localEventUnsubscribers) {
      unsubscribe();
    }
    this.localEventUnsubscribers = [];

    const mirrorStops = [...this.mirrors.values()].map((mirror) => mirror.stop().catch(() => {}));

    if (this.remoteLivenessTimer) {
      clearInterval(this.remoteLivenessTimer);
      this.remoteLivenessTimer = null;
    }

    // Best-effort: clear the per-server hook auth token from remote tmux's
    // memory so it doesn't outlive our connection. Bounded so a hung client
    // can't stall shutdown.
    const cleanups: Promise<unknown>[] = [];
    for (const client of this.clients.values()) {
      if (!client.isConnected) continue;
      cleanups.push(client.sendCommand(`set-option -gqu ${REMOTE_HOOK_SOCKET_TMUX_OPTION}`).catch(() => {}));
    }
    if (cleanups.length > 0) {
      await Promise.race([Promise.allSettled(cleanups), new Promise<void>((resolve) => setTimeout(resolve, 250))]);
    }

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
    this.routing.clear();
    this.pendingRegistrations.clear();
    this.remotePaneIdentityCache.clear();
    this.remotePidBindingCache.clear();
    this.localPaneMetadataCache = { at: 0, mappings: new Map() };
    this.proxyServer.off("proxy-input", this.handleProxyInput);
    this.proxyServer.stop();
    await Promise.allSettled(mirrorStops);
  }

  /**
   * After a reconcile pass: revert any local proxy pane whose paired
   * remote pane no longer exists in the remote snapshot back to a fresh
   * local shell.
   *
   * The reconciler handles mirror-layout cleanup (killing orphan remote
   * panes). This handler covers the local-proxy lifecycle: when the user
   * exits the remote shell, we want the local pane to drop the proxy
   * and respawn locally. The remote snapshot is the authoritative
   * live-pane set; any mapping pointing at a remote id not present in
   * the snapshot is stale.
   *
   * An empty snapshot is treated as "query unavailable" — we don't revert
   * anything, since assuming all remote panes are dead during a transient
   * snapshot failure would be much worse than waiting a beat.
   */
  private cleanupDeadLocalProxiesForServer(serverName: string, remoteSnapshot: MirrorSnapshot): void {
    const livePaneIds = new Set<string>();
    for (const panes of remoteSnapshot.panesByWindow.values()) {
      for (const pane of panes) livePaneIds.add(pane.id);
    }
    if (livePaneIds.size === 0) return;

    for (const mapping of [...this.routing.forServer(serverName)]) {
      // Skip bindings still held in the routing-cache pending overlay:
      // convertPane / recoverPaneMappings install the binding before the
      // snapshot has observed the corresponding @hmx-remote-* tags, and the
      // pre-mutation remote snapshot we're walking here can lag the actual
      // remote state by one reconcile cycle. The pending overlay
      // auto-retires once the local snapshot picks up the tags, so this
      // guard only protects truly in-flight conversions.
      if (this.routing.isPending(mapping.localPaneId)) continue;
      if (!livePaneIds.has(mapping.remotePaneId)) {
        this.revertLocalPaneOnRemoteExit(mapping.localPaneId);
      }
    }
  }

  // --- Private ---

  private async clearLocalPaneOption(paneId: string, key: string): Promise<void> {
    await this.localClient.runCommandArgs(["set-option", "-pu", "-t", paneId, key]);
  }

  /**
   * Best-effort teardown of a local pane's remote-conversion state: drop the
   * `@hmx-remote-*` options and reset the pane border. Shared by the convert
   * failure path, restart recovery, and remote-pane-exit revert.
   */
  private async clearLocalRemotePaneState(localPaneId: string): Promise<void> {
    // Independent, order-free best-effort clears — dispatched together so the
    // synchronous fire-and-forget caller (revert) issues them all at once.
    await Promise.all([
      this.clearLocalPaneOption(localPaneId, "@hmx-remote-host").catch(() => {}),
      this.clearLocalPaneOption(localPaneId, "@hmx-remote-pane").catch(() => {}),
      this.clearLocalPaneOption(localPaneId, "@hmx-remote-token").catch(() => {}),
      this.resetPaneBorder(localPaneId).catch(() => {}),
    ]);
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
    if (!client) return;
    // Skip when the SSH server rejected our `-R` request — there's no
    // forward to point hooks at, and re-asserting the option would mislead
    // the remote hook scripts into connecting to a port that doesn't exist.
    if (client.hookForwardingRejected) return;
    const port = client.remoteHookTcpPort;
    const token = client.hookAuthToken;
    if (port === undefined || !token) return;

    const value = `tcp://127.0.0.1:${port}#${token}`;
    await client.sendCommand(
      `set-option -gq ${REMOTE_HOOK_SOCKET_TMUX_OPTION} ${quoteTmuxArg("remote hook socket path", value)}`,
    );
  }

  /**
   * Fire one reconcile request to every mirror plus chain a routing-cache
   * sync for each. Shared by the local-event listeners and by
   * {@link resumeLocalReconcile} so a flush after a paused window
   * follows the same code path as a normal local-event-driven reconcile.
   */
  private dispatchLocalReconcile(): void {
    for (const mirror of this.mirrors.values()) {
      mirror.request();
    }
    // syncPaneMappingsFromMirror runs opportunistically once the
    // queue settles; the onReconciled callback fires emitMirrorStateChange
    // already, so we don't need to chain a second emit here.
    for (const serverName of this.mirrors.keys()) {
      const mirror = this.mirrors.get(serverName);
      if (!mirror) continue;
      mirror
        .whenIdle()
        .then(() => this.syncPaneMappingsFromMirror(serverName))
        .catch(() => {});
    }
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
    return this.routing.findLocalForRemote(serverName, remotePaneId);
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

  /**
   * Current routing bindings for this server, keyed by remote pane id
   * with the bound local pane id as the value. Fed into the reconciler's
   * active-proxy guard so it can window-scope the protection.
   */
  private getActiveBindingsForServer(serverName: string): ReadonlyMap<string, string> {
    return this.routing.activeBindings(serverName);
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

  /**
   * Resolve the binding for a remote pane id (as captured by the hook via
   * `$TMUX_PANE` on the remote). Returns the local pane id the user sees,
   * plus the remote pane pid for ancestry validation.
   */
  private async getRemotePaneBindingForPaneId(
    serverName: string,
    remotePaneId: string,
  ): Promise<RemotePaneBinding | undefined> {
    await this.refreshRemotePaneIdentityCache(serverName);
    const panePid = this.remotePaneIdentityCache.get(serverName)?.mappings.get(remotePaneId);
    if (panePid === undefined) return undefined;

    const localPaneId = this.findLocalPaneForRemote(serverName, remotePaneId);
    if (!localPaneId) return undefined;

    return { localPaneId, panePid, remotePaneId };
  }

  /**
   * Forward stdin bytes from a local proxy pane to its mapped remote pane.
   *
   * `data` has already passed through local tmux's input layer (so prefix
   * combos and capture states like command-prompt and copy-mode were handled
   * locally) and is whatever local tmux let through to the focused pane.
   */
  private handleProxyInput = (paneId: string, data: Uint8Array): void => {
    const mapping = this.routing.lookup(paneId);
    if (!mapping) return;
    const client = this.clients.get(mapping.serverName);
    if (!client || !client.isConnected) return;
    if (data.length === 0) return;
    const hex = Buffer.from(data).toString("hex").match(/.{2}/g);
    if (!hex || hex.length === 0) return;
    client
      .sendCommand(`send-keys -H -t ${quoteTmuxArg("remotePaneId", mapping.remotePaneId)} ${hex.join(" ")}`)
      .catch(() => {});
  };

  private handleRemoteTmuxExit(serverName: string): void {
    for (const mapping of [...this.routing.forServer(serverName)]) {
      this.revertLocalPaneOnRemoteExit(mapping.localPaneId);
    }
  }

  private async isRemotePidBoundToPane(serverName: string, pid: number, panePid: number): Promise<boolean> {
    const cacheKey = `${serverName}\u0000${pid}\u0000${panePid}`;
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
        String(panePid),
      ]);
      const valid = result.exitCode === 0;
      this.remotePidBindingCache.set(cacheKey, { at: now, valid });
      return valid;
    } catch {
      return false;
    }
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

    if (!event.paneId) return normalized;

    const localPaneId = this.findLocalPaneForRemote(serverName, event.paneId);
    if (!localPaneId) return normalized;

    normalized.paneId = localPaneId;
    const localPaneMeta = await this.getLocalPaneMetadata(localPaneId);
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

  /**
   * Re-sync hook scripts on a remote server when the user has previously
   * consented for that host. Mirrors the local startup pass run for the local
   * agent installs (see `bootstrap-connected-session.ts`); each per-agent
   * helper compares its bundled script against what's on disk and writes only
   * if they differ. Without this, an upgraded Honeymux ships new hook content
   * that never reaches an already-consented remote — the upgrade-prompt path
   * is gated on missing consent.
   *
   * Best-effort: each helper swallows its own errors, and a missing or
   * unconsented agent is a silent no-op.
   */
  private async refreshRemoteHooksIfConsented(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;
    const host = new RemoteInstallHost(serverName, {
      exec: (argv, options) => client.runRemoteShellCommand(argv, options),
    });
    await Promise.all([
      refreshClaudeHooksIfConsented(host),
      refreshCodexHooksIfConsented(host),
      refreshGeminiHooksIfConsented(host),
      refreshOpenCodePluginIfConsented(host),
    ]);
  }

  private async refreshRemotePaneIdentityCache(serverName: string): Promise<void> {
    const cached = this.remotePaneIdentityCache.get(serverName);
    const now = Date.now();
    if (cached && now - cached.at < REMOTE_PANE_CACHE_MS) return;

    const client = this.clients.get(serverName);
    if (!client || !client.isConnected) return;

    try {
      const output = await client.sendCommand("list-panes -a -F '#{pane_id}\t#{pane_pid}'");
      const mappings = new Map<string, number>();
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        const paneId = parts[0];
        const panePid = parseInt(parts[1] ?? "", 10);
        if (!paneId || !Number.isInteger(panePid) || panePid <= 1) continue;
        mappings.set(paneId, panePid);
      }
      this.remotePaneIdentityCache.set(serverName, { at: now, mappings });
    } catch {
      // Best-effort: leave any stale cache in place.
    }
  }

  private async resetPaneBorder(localPaneId: string): Promise<void> {
    await this.localClient
      .runCommandArgs(["set-option", "-pu", "-t", localPaneId, "pane-border-format"])
      .catch(() => {});
  }

  /**
   * Revert a local proxy pane back to a fresh local login shell after its
   * paired remote pane has died (user logged out / exited, or the remote
   * tmux session ended). The pane is preserved — only its contents are
   * replaced — so the user lands back in local without losing their layout.
   *
   * Clearing @hmx-remote-* and the pane-border-format is queued before the
   * respawn so the layout-change tmux emits during the respawn is observed
   * by downstream features (e.g. pane tabs bootstrap) with the remote
   * metadata already gone.
   */
  private revertLocalPaneOnRemoteExit(localPaneId: string): void {
    this.endRemoteSessionsForLocalPane(localPaneId);
    this.pendingRegistrations.get(localPaneId)?.();
    this.pendingRegistrations.delete(localPaneId);
    this.routing.delete(localPaneId);
    this.proxyServer.forgetProxy(localPaneId);
    void this.clearLocalRemotePaneState(localPaneId);
    // An explicit shell-command is REQUIRED here. `respawn-pane` without one
    // re-runs whatever was last spawned in the pane — which is the bun proxy
    // installed by convertPane. The user would see the proxy come right back.
    // Use $SHELL as a login shell to match what tmux would launch for a
    // fresh pane.
    const shell = process.env["SHELL"] || "/bin/sh";
    this.localClient.respawnPane(localPaneId, [shell, "-l"]).catch(() => {});
    this.emit("pane-reverted", localPaneId);
  }

  /** Format server name + ssh pid for log messages. */
  private serverTag(serverName: string): string {
    const pid = this.clients.get(serverName)?.sshPid;
    return pid ? `${serverName} (ssh pid=${pid})` : serverName;
  }

  private async setLocalPaneOption(paneId: string, key: string, value: string): Promise<void> {
    await this.localClient.runCommandArgs(["set-option", "-p", "-t", paneId, key, value]);
  }

  private startRemoteLivenessCheck(): void {
    this.remoteLivenessTimer = setInterval(() => {
      if (this.remoteLivenessInFlight) return;
      this.remoteLivenessInFlight = true;
      this.runRemoteLivenessCheckOnce().finally(() => {
        this.remoteLivenessInFlight = false;
      });
    }, REMOTE_LIVENESS_INTERVAL_MS);
  }

  private async syncPaneMappingsFromMirror(serverName: string): Promise<void> {
    const mirror = this.mirrors.get(serverName);
    if (!mirror) return;

    const updates: Array<{ localPaneId: string; remotePaneId: string }> = [];
    for (const mapping of [...this.routing.forServer(serverName)]) {
      const remotePaneId = mirror.remotePaneFor(mapping.localPaneId);
      if (!remotePaneId || remotePaneId === mapping.remotePaneId) continue;
      // updateIfBound does NOT create a pending hold — this is an
      // index-fix-up for an existing binding whose lifecycle is owned
      // elsewhere (convertPane / recoverPaneMappings). Using register()
      // here would leak undisposed pending entries.
      this.routing.updateIfBound({ ...mapping, remotePaneId });
      updates.push({ localPaneId: mapping.localPaneId, remotePaneId });
    }

    await Promise.all(
      updates.map(({ localPaneId, remotePaneId }) =>
        this.setLocalPaneOption(localPaneId, "@hmx-remote-pane", remotePaneId).catch(() => {}),
      ),
    );
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

  private async validateRemoteHookEvent(
    serverName: string,
    event: AgentEvent,
    ctx: HookEventValidatorContext,
  ): Promise<boolean> {
    const valid = await validateRemoteAgentEvent(event, {
      processLookup: ctx.processLookup,
      resolvePaneBindingByPaneId: (paneId) => this.getRemotePaneBindingForPaneId(serverName, paneId),
      validateProcessBinding: (pid, panePid) => this.isRemotePidBoundToPane(serverName, pid, panePid),
    });
    if (!valid) {
      log(
        "remote",
        `rejected remote hook event for ${this.serverTag(serverName)} session=${event.sessionId} pid=${event.pid ?? "<none>"} paneId=${event.paneId ?? "<none>"}`,
      );
    }
    return valid;
  }

  /**
   * Wire local control client events to the per-server reconcile queue.
   *
   * Each event just enqueues a reconcile request — the queue coalesces
   * bursts (a session-window-changed typically fans to several
   * layout-change emissions) and runs reconcile once. The downstream
   * routing cache remaps to the latest snapshot via `syncPaneMappingsFromMirror`
   * after the queue idles.
   */
  private wireLocalEvents(): void {
    const requestAll = (): void => {
      if (this.localReconcilePaused) return;
      this.dispatchLocalReconcile();
    };
    const events = ["session-window-changed", "layout-change", "window-add", "window-close"] as const;
    for (const event of events) {
      this.localClient.on(event, requestAll);
      this.localEventUnsubscribers.push(() => {
        this.localClient.off(event, requestAll);
      });
    }
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
