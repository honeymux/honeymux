import type { Socket } from "bun";

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent, AgentType } from "./types.ts";

import { listPanePidsByIdSync, listPanePidsByTtySync } from "../tmux/control-client.ts";
import { appendBoundedLines } from "../util/bounded-line-buffer.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import {
  type ProcessLookup,
  createProcessLookup,
  createSnapshotProcessLookup,
  parsePsProcessSnapshotOutput,
} from "../util/process-introspection.ts";
import { getPrivateRuntimePath, getPrivateSocketPath } from "../util/runtime-paths.ts";
import { parseWireAgentEvent } from "./wire-event.ts";

export { parseProcStatParentPid } from "../util/process-introspection.ts";

const AGENT_COMMAND_PATTERNS: Record<AgentType, RegExp> = {
  claude: /\bclaude\b/i,
  codex: /\bcodex\b/i,
  gemini: /\bgemini\b/i,
  opencode: /\bopencode\b/i,
};
const LOCAL_PANE_CACHE_MS = 1000;
const MAX_HOOK_SOCKET_LINE_BYTES = 256 * 1024;

export interface HookEventValidatorContext {
  processLookup?: ProcessLookup;
}

/**
 * Listen address for the hook server.
 *
 * `unix` is the standard local-agent path: file-based, owner-only permissions
 * enforced by the filesystem.
 *
 * `tcp` is used for remote-agent ingress when the SSH server rejects
 * stream-local forwarding (e.g. Tailscale SSH). Bind to 127.0.0.1 with
 * `port: 0` to pick an ephemeral port; the bound port is exposed via
 * {@link HookSocketServer.listenPort} after `start()`. TCP loopback is
 * reachable by any process on the host running the server, so callers
 * MUST also set {@link HookSocketServerOptions.authToken} to validate
 * inbound events.
 */
export type HookSocketListenAddress =
  | { hostname?: string; port?: number; type: "tcp" }
  | { path: string; type: "unix" };


interface HookSocketServerOptions {
  /**
   * Optional shared secret. When set, every inbound event must include a
   * matching `_authToken` field at the top level of its JSON payload, or it
   * will be silently dropped. Required in `tcp` listen mode.
   */
  authToken?: string;
  eventValidator?: (event: AgentEvent, ctx: HookEventValidatorContext) => Promise<boolean> | boolean;
  persistEvents?: boolean;
  shouldHoldPermissionConnection?: (event: AgentEvent) => boolean;
}

interface PendingPermissionConnection {
  permissionEvent: AgentEvent;
  sessionId: string;
  socket: Socket<SocketData>;
}

let cachedPanePidsByTty = new Map<string, number>();
let cachedPanePidsById = new Map<string, number>();
let cachedPanePidsAt = 0;

interface SocketData {
  buffer: string;
  ignoreFurtherInput?: boolean;
  pendingWork: Promise<void>;
  permissionEvent?: AgentEvent;
  toolUseId?: string;
}

export class HookSocketServer extends EventEmitter {
  /** TCP port the server is bound to. Only defined after `start()` in tcp mode. */
  get listenPort(): number | undefined {
    if (this.listenAddress.type !== "tcp") return undefined;
    return this.server?.port;
  }
  private authToken?: string;
  private eventValidator: (event: AgentEvent, ctx: HookEventValidatorContext) => Promise<boolean> | boolean;
  private holdPermissionConnections: boolean;
  private listenAddress: HookSocketListenAddress;
  private pendingConnectionKeysBySessionId = new Map<string, string>();
  private pendingConnections = new Map<string, PendingPermissionConnection>();
  private persistEvents: boolean;
  private server: { port?: number; stop(force?: boolean): void } | null = null;
  private shouldHoldPermissionConnection?: (event: AgentEvent) => boolean;

  constructor(
    address?: HookSocketListenAddress | string,
    holdPermissionConnections = true,
    options: HookSocketServerOptions = {},
  ) {
    super();
    this.eventValidator = options.eventValidator ?? isValidLocalAgentEvent;
    this.listenAddress = resolveListenAddress(address);
    if (this.listenAddress.type === "tcp" && !options.authToken) {
      throw new Error("HookSocketServer: tcp listen mode requires an authToken");
    }
    this.authToken = options.authToken;
    this.holdPermissionConnections = holdPermissionConnections;
    this.persistEvents = options.persistEvents ?? true;
    this.shouldHoldPermissionConnection = options.shouldHoldPermissionConnection;
  }

  /**
   * Close any pending permission connection for `sessionId`. Called when
   * the agent process has died (detected by the session store's liveness
   * check) so the hook script, which is blocked in `recv()` waiting for
   * a permission decision that will never come, sees a clean EOF and
   * gives up. Returns true if a pending connection was closed.
   */
  cancelPendingPermissionsForSession(sessionId: string): boolean {
    const pending = this.removePendingConnectionForSession(sessionId);
    if (!pending) return false;
    this.clearPendingSocketData(pending.socket);
    try {
      pending.socket.end();
    } catch {}
    return true;
  }

  respondToPermission(id: string, decision: "allow" | "deny"): boolean {
    const pending = this.removePendingConnection(id);
    if (!pending) return false;
    // Remove from map BEFORE writing to prevent the close handler from
    // deleting the key while we're still using the socket
    this.clearPendingSocketData(pending.socket);
    let ok = true;
    try {
      const payload = JSON.stringify({ decision }) + "\n";
      pending.socket.write(payload);
      pending.socket.flush();
    } catch {
      ok = false;
    }
    try {
      pending.socket.end();
    } catch {
      ok = false;
    }
    return ok;
  }

  start(): void {
    const sharedSocketHandlers = {
      close: (socket: Socket<SocketData>) => this.handleSocketClose(socket),
      data: (socket: Socket<SocketData>, data: Uint8Array) => {
        if (socket.data.ignoreFurtherInput) return;
        const result = appendBoundedLines(
          socket.data.buffer,
          new TextDecoder().decode(data),
          MAX_HOOK_SOCKET_LINE_BYTES,
        );
        if (result.overflowed) {
          socket.data.buffer = "";
          socket.end();
          return;
        }
        socket.data.buffer = result.remainder;
        if (result.lines.length === 0) return;
        socket.data.pendingWork = socket.data.pendingWork
          .then(async () => {
            for (const line of result.lines) {
              if (socket.data.ignoreFurtherInput) break;
              await this.processLine(socket, line);
            }
          })
          .catch(() => {});
      },
      error: (_socket: Socket<SocketData>, _error: unknown) => {
        // connection error — ignore
      },
      open: (socket: Socket<SocketData>) => {
        socket.data = { buffer: "", pendingWork: Promise.resolve() };
      },
    };

    if (this.listenAddress.type === "unix") {
      const path = this.listenAddress.path;
      try {
        unlinkSync(path);
      } catch {
        // doesn't exist
      }
      this.server = Bun.listen<SocketData>({
        socket: sharedSocketHandlers,
        unix: path,
      });
      try {
        chmodSync(path, 0o700);
      } catch {}
    } else {
      this.server = Bun.listen<SocketData>({
        hostname: this.listenAddress.hostname ?? "127.0.0.1",
        port: this.listenAddress.port ?? 0,
        socket: sharedSocketHandlers,
      });
    }
  }

  stop(): void {
    // Close all pending connections
    for (const pending of this.pendingConnections.values()) {
      this.clearPendingSocketData(pending.socket);
      try {
        pending.socket.end();
      } catch {}
    }
    this.pendingConnections.clear();
    this.pendingConnectionKeysBySessionId.clear();

    this.server?.stop(true);
    this.server = null;

    if (this.listenAddress.type === "unix") {
      try {
        unlinkSync(this.listenAddress.path);
      } catch {
        // already removed
      }
    }
  }

  private clearPendingSocketData(socket: Socket<SocketData>): void {
    socket.data.permissionEvent = undefined;
    socket.data.toolUseId = undefined;
  }

  private emitPermissionCancelled(event: AgentEvent): void {
    this.emit("event", {
      ...event,
      hookEvent: "PermissionCancelled",
      status: "alive",
      timestamp: Date.now() / 1000,
      toolInput: undefined,
      toolName: undefined,
      toolUseId: undefined,
    } satisfies AgentEvent);
  }

  private getShouldHoldPermissionConnection(event: AgentEvent): boolean {
    return this.shouldHoldPermissionConnection?.(event) ?? this.holdPermissionConnections;
  }

  private handleSocketClose(socket: Socket<SocketData>): void {
    if (!socket.data.toolUseId) return;

    // Only clean up if this socket is still the active one for its key.
    // A newer socket may have already replaced it in pendingConnections.
    const stored = this.pendingConnections.get(socket.data.toolUseId);
    if (!stored || stored.socket !== socket) return;

    this.removePendingConnection(socket.data.toolUseId);

    // Socket closed without us responding — user approved/denied
    // directly in the agent TUI. Emit a synthetic event to clear
    // unanswered state.
    const orig = socket.data.permissionEvent;
    if (orig) {
      this.emitPermissionCancelled(orig);
    }
  }

  private async processLine(socket: Socket<SocketData>, line: string): Promise<void> {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (this.authToken) {
        if (typeof parsed !== "object" || parsed === null) return;
        const provided = (parsed as Record<string, unknown>)["_authToken"];
        if (typeof provided !== "string" || provided !== this.authToken) return;
        delete (parsed as Record<string, unknown>)["_authToken"];
      }
      const ctx: HookEventValidatorContext = {
        processLookup: extractSnapshotLookup(parsed),
      };
      const event = parseWireAgentEvent(parsed);
      if (!event) return;
      const shouldHold = this.getShouldHoldPermissionConnection(event);
      let isValid = false;
      try {
        isValid = await this.eventValidator(event, ctx);
      } catch {}
      if (!isValid) {
        if (event.status === "unanswered" && shouldHold) {
          this.rejectPendingPermissionSocket(socket);
        }
        return;
      }

      // Reply with the canonical agent pid so the hook can self-poll
      // against the long-lived agent.
      try {
        socket.write(JSON.stringify({ resolvedPid: event.pid }) + "\n");
        socket.flush();
      } catch {}

      this.emit("event", event);
      if (this.persistEvents) {
        persistSessionEvent(event);
      }

      if (event.hookEvent === "PermissionCancelled" || event.status === "ended") {
        const pendingForSession = this.removePendingConnectionForSession(event.sessionId);
        if (pendingForSession && pendingForSession.socket !== socket) {
          this.clearPendingSocketData(pendingForSession.socket);
          try {
            pendingForSession.socket.end();
          } catch {}
        }
      }

      // Hold connection open for permission requests (only for agents
      // that support programmatic allow/deny, e.g. Claude).  Agents
      // like Gemini fire-and-forget: their hook closes immediately, so
      // holding the connection would trigger a spurious cancel event.
      if (event.status === "unanswered" && shouldHold) {
        const key = event.toolUseId ?? event.sessionId;
        const priorKeyForSession = this.pendingConnectionKeysBySessionId.get(event.sessionId);
        if (priorKeyForSession && priorKeyForSession !== key) {
          const oldPendingForSession = this.removePendingConnection(priorKeyForSession);
          if (oldPendingForSession) {
            this.clearPendingSocketData(oldPendingForSession.socket);
            try {
              oldPendingForSession.socket.end();
            } catch {}
          }
        }

        // Clean up any old socket for this key so its close handler
        // won't delete the new entry from pendingConnections.
        const oldPending = this.removePendingConnection(key);
        if (oldPending && oldPending.socket !== socket) {
          this.clearPendingSocketData(oldPending.socket);
          try {
            oldPending.socket.end();
          } catch {}
        }
        socket.data.toolUseId = key;
        socket.data.permissionEvent = event;
        this.pendingConnections.set(key, {
          permissionEvent: event,
          sessionId: event.sessionId,
          socket,
        });
        this.pendingConnectionKeysBySessionId.set(event.sessionId, key);
      }
    } catch {
      // invalid JSON — skip
    }
  }

  private rejectPendingPermissionSocket(socket: Socket<SocketData>): void {
    socket.data.ignoreFurtherInput = true;
    this.clearPendingSocketData(socket);
    try {
      socket.write(JSON.stringify({ decision: "deny" }) + "\n");
      socket.flush();
    } catch {}
    try {
      socket.end();
    } catch {}
  }

  private removePendingConnection(key: string): PendingPermissionConnection | undefined {
    const pending = this.pendingConnections.get(key);
    if (!pending) return undefined;

    this.pendingConnections.delete(key);
    const sessionKey = this.pendingConnectionKeysBySessionId.get(pending.sessionId);
    if (sessionKey === key) {
      this.pendingConnectionKeysBySessionId.delete(pending.sessionId);
    }
    return pending;
  }

  private removePendingConnectionForSession(sessionId: string): PendingPermissionConnection | undefined {
    const key = this.pendingConnectionKeysBySessionId.get(sessionId);
    if (!key) return undefined;
    return this.removePendingConnection(key);
  }
}

export function getCodexSocketPath(): string {
  return getPrivateSocketPath("hmx-codex");
}

export function getGeminiSocketPath(): string {
  return getPrivateSocketPath("hmx-gemini");
}

export function getOpenCodeSocketPath(): string {
  return getPrivateSocketPath("hmx-opencode");
}

export function isPidBoundToPane(
  pid: number,
  tty: string,
  panePid: number,
  lookup: ProcessLookup = createProcessLookup(),
): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (!Number.isInteger(panePid) || panePid <= 1) return false;
  if (!tty || lookup.getStdinTty(pid) !== tty) return false;

  return isPidDescendedFromPane(pid, panePid, lookup);
}

export function isPidDescendedFromPane(
  pid: number,
  panePid: number,
  lookup: ProcessLookup = createProcessLookup(),
): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (!Number.isInteger(panePid) || panePid <= 1) return false;

  const seen = new Set<number>();
  let currentPid = pid;
  while (currentPid > 1 && !seen.has(currentPid)) {
    if (currentPid === panePid) return true;
    seen.add(currentPid);
    const parentPid = lookup.getParentPid(currentPid);
    if (parentPid === null || parentPid === currentPid) return false;
    currentPid = parentPid;
  }
  return false;
}

/**
 * Load persisted session events from disk.  Used on startup to rediscover
 * agent sessions that were running before honeymux restarted.  Dead PIDs
 * are cleaned up automatically.
 */
export function loadPersistedSessions(agentType?: AgentType): AgentEvent[] {
  const events: AgentEvent[] = [];
  try {
    const dir = getSessionsDir();
    const files = readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const fullPath = join(dir, file);
        const content = readFileSync(fullPath, "utf-8");
        const event: AgentEvent = JSON.parse(content);
        if (agentType && event.agentType !== agentType) continue;
        if (event.pid) {
          try {
            process.kill(event.pid, 0);
            // Status is inherently stale (from previous honeymux run).
            // Default to alive — if the agent needs attention,
            // a fresh hook event will arrive momentarily to correct it.
            // hookEvent must also be cleared: session-store re-derives
            // status from hookEvent, so a leftover "PermissionRequest"
            // would flip the session back to unanswered despite the
            // status override here.
            events.push({
              ...event,
              hookEvent: undefined,
              status: "alive",
              toolInput: undefined,
              toolName: undefined,
              toolUseId: undefined,
            });
          } catch {
            try {
              unlinkSync(fullPath);
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return events;
}

/**
 * Resolve a hook-reported pid to the long-lived agent process.
 *
 * Claude Code (and some other agents) dispatch hooks through `/bin/sh -c
 * <command>` rather than exec'ing them directly. `os.getppid()` in the
 * hook script then returns the wrapper shell's pid, which exits as soon
 * as the hook returns — leaving honeymux's pid-based liveness check
 * (`session-store.ts`) to mark the session ended seconds later.
 *
 * Walk up the ancestry from the reported pid (bounded by the pane shell
 * and a cycle guard) and return the first ancestor whose command matches
 * the agent binary. That pid lives for the full agent session and works
 * regardless of whether the hook is exec'd directly or wrapped. Returns
 * `eventPid` unchanged if no matching ancestor is found — graceful
 * degradation to the prior (sometimes-broken) behavior rather than
 * fabricating a stale pid.
 *
 * For team setups (a teammate agent forked from a lead) the nearest
 * matching ancestor is the teammate itself, not the lead — exactly what
 * the teammate's session wants for liveness.
 */
export function resolveAgentSessionPid(
  eventPid: number,
  agentType: AgentType,
  panePid: number,
  lookup: ProcessLookup,
): number {
  const pattern = AGENT_COMMAND_PATTERNS[agentType];
  if (!pattern) return eventPid;

  const seen = new Set<number>();
  let current: null | number = eventPid;
  while (current !== null && current > 1 && current !== panePid && !seen.has(current)) {
    seen.add(current);
    const command = lookup.getCommand(current);
    if (command && pattern.test(command)) return current;
    current = lookup.getParentPid(current);
  }
  return eventPid;
}

function extractSnapshotLookup(parsed: unknown): ProcessLookup | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const snapshot = (parsed as Record<string, unknown>)["processSnapshot"];
  if (typeof snapshot !== "string" || snapshot.length === 0) return undefined;
  return createSnapshotProcessLookup(() => parsePsProcessSnapshotOutput(snapshot));
}

function getPanePidsById(): Map<string, number> {
  const now = Date.now();
  if (now - cachedPanePidsAt < LOCAL_PANE_CACHE_MS) return cachedPanePidsById;

  cachedPanePidsById = listPanePidsByIdSync();
  cachedPanePidsByTty = listPanePidsByTtySync();
  cachedPanePidsAt = now;
  return cachedPanePidsById;
}

function getPanePidsByTty(): Map<string, number> {
  const now = Date.now();
  if (now - cachedPanePidsAt < LOCAL_PANE_CACHE_MS) return cachedPanePidsByTty;

  cachedPanePidsById = listPanePidsByIdSync();
  cachedPanePidsByTty = listPanePidsByTtySync();
  cachedPanePidsAt = now;
  return cachedPanePidsByTty;
}

function getSessionsDir(): string {
  return getPrivateRuntimePath("sessions");
}

function getSocketPath(): string {
  return getPrivateSocketPath("hmx-claude");
}

/**
 * Validates a local agent event and canonicalizes `event.pid` to the
 * long-lived agent process. Side-effecting: on success, mutates
 * `event.pid` to the nearest ancestor whose command matches the agent
 * binary (see `resolveAgentSessionPid`), so the wrapper-shell pid from
 * `sh -c`-dispatched hooks is replaced with the stable agent pid before
 * the event reaches session storage and liveness checking.
 */
function isValidLocalAgentEvent(event: AgentEvent, ctx: HookEventValidatorContext): boolean {
  if (typeof event.pid !== "number" || !Number.isInteger(event.pid)) return false;
  if (!ctx.processLookup) return false;
  const lookup = ctx.processLookup;

  if (event.paneId) {
    const panePid = getPanePidsById().get(event.paneId);
    if (panePid && isPidDescendedFromPane(event.pid, panePid, lookup)) {
      event.pid = resolveAgentSessionPid(event.pid, event.agentType, panePid, lookup);
      return true;
    }
  }

  if (!event.tty || typeof event.tty !== "string") return false;
  const panePid = getPanePidsByTty().get(event.tty);
  if (!panePid) return false;
  if (!isPidBoundToPane(event.pid, event.tty, panePid, lookup)) return false;
  event.pid = resolveAgentSessionPid(event.pid, event.agentType, panePid, lookup);
  return true;
}

function persistSessionEvent(event: AgentEvent): void {
  try {
    const dir = getSessionsDir();
    mkdirSync(dir, { mode: 0o700, recursive: true });
    chmodSync(dir, 0o700);
    const file = sessionFilePath(dir, event.sessionId);
    if (event.status === "ended") {
      try {
        unlinkSync(file);
      } catch {}
    } else {
      writeFileSync(file, JSON.stringify(event), { mode: 0o600 });
    }
  } catch {}
}

function resolveListenAddress(input: HookSocketListenAddress | string | undefined): HookSocketListenAddress {
  if (typeof input === "string") return { path: input, type: "unix" };
  if (input) return input;
  return { path: getSocketPath(), type: "unix" };
}

function sessionFilePath(dir: string, sessionId: string): string {
  return join(dir, `${sessionFileStem(sessionId)}.json`);
}

/**
 * Build a stable, traversal-safe filename stem from sessionId.
 * Keep a readable prefix for debugging and append a hash for uniqueness.
 */
function sessionFileStem(sessionId: string): string {
  const readable = sessionId
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 64);
  const digest = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return `${readable || "session"}-${digest}`;
}
