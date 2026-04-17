import type { Socket } from "bun";

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent, AgentType } from "./types.ts";

import { listPanePidsByIdSync, listPanePidsByTtySync } from "../tmux/control-client.ts";
import { appendBoundedLines } from "../util/bounded-line-buffer.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { getProcessParentPidSync, getProcessStdinTtySync } from "../util/process-introspection.ts";
import { getPrivateRuntimePath, getPrivateSocketPath } from "../util/runtime-paths.ts";
import { parseWireAgentEvent } from "./wire-event.ts";

export { parseProcStatParentPid } from "../util/process-introspection.ts";

const LOCAL_PANE_CACHE_MS = 1000;
const MAX_HOOK_SOCKET_LINE_BYTES = 256 * 1024;

interface HookSocketServerOptions {
  eventValidator?: (event: AgentEvent) => Promise<boolean> | boolean;
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
  private eventValidator: (event: AgentEvent) => Promise<boolean> | boolean;
  private holdPermissionConnections: boolean;
  private pendingConnectionKeysBySessionId = new Map<string, string>();
  private pendingConnections = new Map<string, PendingPermissionConnection>();
  private persistEvents: boolean;
  private server: ReturnType<typeof Bun.listen> | null = null;
  private shouldHoldPermissionConnection?: (event: AgentEvent) => boolean;
  private socketPath: string;

  constructor(socketPath?: string, holdPermissionConnections = true, options: HookSocketServerOptions = {}) {
    super();
    this.eventValidator = options.eventValidator ?? isValidLocalAgentEvent;
    this.socketPath = socketPath ?? getSocketPath();
    this.holdPermissionConnections = holdPermissionConnections;
    this.persistEvents = options.persistEvents ?? true;
    this.shouldHoldPermissionConnection = options.shouldHoldPermissionConnection;
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
    // Remove stale socket
    try {
      unlinkSync(this.socketPath);
    } catch {
      // doesn't exist
    }

    this.server = Bun.listen<SocketData>({
      socket: {
        close: (socket) => this.handleSocketClose(socket),
        data: (socket, data) => {
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
        error: (_socket, _error) => {
          // connection error — ignore
        },
        open: (socket) => {
          socket.data = { buffer: "", pendingWork: Promise.resolve() };
        },
      },
      unix: this.socketPath,
    });
    try {
      chmodSync(this.socketPath, 0o700);
    } catch {}
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

    try {
      unlinkSync(this.socketPath);
    } catch {
      // already removed
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
      const event = parseWireAgentEvent(parsed);
      if (!event) return;
      const shouldHold = this.getShouldHoldPermissionConnection(event);
      let isValid = false;
      try {
        isValid = await this.eventValidator(event);
      } catch {}
      if (!isValid) {
        if (event.status === "unanswered" && shouldHold) {
          this.rejectPendingPermissionSocket(socket);
        }
        return;
      }

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

export function getSocketPath(): string {
  return getPrivateSocketPath("hmx-claude");
}

export function isPidBoundToPane(
  pid: number,
  tty: string,
  panePid: number,
  readTty: (pid: number) => null | string = getProcessStdinTty,
  readParentPid: (pid: number) => null | number = getProcessParentPid,
): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (!Number.isInteger(panePid) || panePid <= 1) return false;
  if (!tty || readTty(pid) !== tty) return false;

  return isPidDescendedFromPane(pid, panePid, readParentPid);
}

export function isPidDescendedFromPane(
  pid: number,
  panePid: number,
  readParentPid: (pid: number) => null | number = getProcessParentPid,
): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (!Number.isInteger(panePid) || panePid <= 1) return false;

  const seen = new Set<number>();
  let currentPid = pid;
  while (currentPid > 1 && !seen.has(currentPid)) {
    if (currentPid === panePid) return true;
    seen.add(currentPid);
    const parentPid = readParentPid(currentPid);
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

function getProcessParentPid(pid: number): null | number {
  return getProcessParentPidSync(pid);
}

function getProcessStdinTty(pid: number): null | string {
  return getProcessStdinTtySync(pid);
}

function getSessionsDir(): string {
  return getPrivateRuntimePath("sessions");
}

function isValidLocalAgentEvent(event: AgentEvent): boolean {
  if (typeof event.pid !== "number" || !Number.isInteger(event.pid)) return false;

  if (event.paneId) {
    const panePid = getPanePidsById().get(event.paneId);
    if (panePid) return isPidDescendedFromPane(event.pid, panePid);
  }

  if (!event.tty || typeof event.tty !== "string") return false;
  const panePid = getPanePidsByTty().get(event.tty);
  if (!panePid) return false;
  return isPidBoundToPane(event.pid, event.tty, panePid);
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
