import type { AgentEvent, AgentSession } from "./types.ts";

import { EventEmitter } from "../util/event-emitter.ts";

const ENDED_CLEANUP_MS = 30_000;

/** Hook events that mark a session as "unanswered" (permission prompt pending). */
const PERMISSION_EVENTS = new Set([
  "Notification", // Gemini (filtered to ToolPermission in hooks.py)
  "PermissionRequest", // Claude
  "permission.ask", // OpenCode (blocking hook)
  "permission.asked", // OpenCode (event)
]);

export class AgentSessionStore extends EventEmitter {
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private sessions = new Map<string, AgentSession>();

  destroy(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.sessions.clear();
  }

  /** Dismiss a permission request: suppress muxotronEnabled expansion but keep unanswered status. */
  dismissSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.status === "unanswered" && !session.dismissed) {
      session.dismissed = true;
      this.emitChanged();
    }
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status !== "ended");
  }

  handleEvent(event: AgentEvent): void {
    const existing = this.sessions.get(event.sessionId);

    if (!existing) {
      if (event.status === "ended") return;
      const session: AgentSession = {
        agentType: event.agentType,
        cwd: event.cwd,
        isRemote: event.isRemote,
        lastEvent: event,
        paneId: event.paneId,
        remoteHost: event.remoteHost,
        remoteServerName: event.remoteServerName,
        sessionId: event.sessionId,
        sessionName: event.sessionName,
        startedAt: event.timestamp,
        status: event.status === "unanswered" && PERMISSION_EVENTS.has(event.hookEvent ?? "") ? "unanswered" : "alive",
        teamName: event.teamName,
        teamRole: event.teamRole,
        teammateName: event.teammateName,
        transcriptPath: event.transcriptPath,
        windowId: event.windowId,
      };
      if (event.prompt) {
        session.conversationLabel = event.prompt;
      }
      this.sessions.set(event.sessionId, session);
      this.clearCleanupTimer(event.sessionId);

      if (!session.isRemote && session.transcriptPath && !session.conversationLabel) {
        this.readFirstPromptFromTranscript(session);
      }

      this.emitChanged();
      return;
    }

    // Update metadata from every event
    existing.lastEvent = event;
    existing.cwd = event.cwd;
    if (event.paneId) existing.paneId = event.paneId;
    if (event.sessionName) existing.sessionName = event.sessionName;
    if (event.isRemote != null) existing.isRemote = event.isRemote;
    if (event.windowId) existing.windowId = event.windowId;
    if (!existing.isRemote && event.transcriptPath) existing.transcriptPath = event.transcriptPath;
    if (event.teamName) existing.teamName = event.teamName;
    if (event.teammateName) existing.teammateName = event.teammateName;
    if (event.teamRole) existing.teamRole = event.teamRole;
    if (event.remoteHost) existing.remoteHost = event.remoteHost;
    if (event.remoteServerName) existing.remoteServerName = event.remoteServerName;
    if (event.prompt && !existing.conversationLabel) {
      existing.conversationLabel = event.prompt;
    }

    if (event.status === "ended") {
      existing.status = "ended";
      this.scheduleCleanup(event.sessionId);
      this.emitChanged();
      return;
    }

    if (event.status === "unanswered" && PERMISSION_EVENTS.has(event.hookEvent ?? "")) {
      existing.status = "unanswered";
      existing.dismissed = false; // new permission event clears dismissed state
      this.clearCleanupTimer(event.sessionId);
      // Retry transcript read if we still don't have a conversation label.
      // Try immediately, then again after a short delay (transcript may not
      // have been flushed to disk yet when the PermissionRequest fires).
      if (!existing.isRemote && existing.transcriptPath && !existing.conversationLabel) {
        this.readFirstPromptFromTranscript(existing);
        setTimeout(() => {
          if (!existing.isRemote && !existing.conversationLabel && existing.transcriptPath) {
            this.readFirstPromptFromTranscript(existing);
          }
        }, 500);
        setTimeout(() => {
          if (!existing.isRemote && !existing.conversationLabel && existing.transcriptPath) {
            this.readFirstPromptFromTranscript(existing);
          }
        }, 2000);
      }
      this.emitChanged();
      return;
    }

    // PermissionCancelled (socket closed without our response) — user answered
    // directly in the agent TUI. Transition back to alive.
    if (event.hookEvent === "PermissionCancelled" && existing.status === "unanswered") {
      existing.status = "alive";
      this.emitChanged();
      return;
    }

    // Any other event on a non-ended session — keep alive, update metadata (already done above)
    if (existing.status === "ended") return;
    this.clearCleanupTimer(event.sessionId);
    this.emitChanged();
  }

  /** Clear unanswered state after user responds (Enter/Escape in PTY). */
  markAnswered(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.status === "unanswered") {
      session.status = "alive";
      session.dismissed = false;
      this.emitChanged();
    }
  }

  /**
   * Retroactively enrich existing sessions with newly discovered team configs.
   * Called when TeamService discovers configs that weren't available when sessions
   * were first created (race between agent spawn and config file write).
   */
  retroactivelyEnrichFromConfigs(
    configs: Array<{
      leadSessionId: string;
      members: Array<{ agentType?: string; name: string; teamRole?: "lead" | "teammate"; tmuxPaneId?: string }>;
      name: string;
    }>,
  ): void {
    let changed = false;
    for (const config of configs) {
      for (const session of this.sessions.values()) {
        if (session.teamName) continue; // already tagged
        // Match by leadSessionId
        if (config.leadSessionId === session.sessionId) {
          session.teamName = config.name;
          session.teamRole = "lead";
          changed = true;
          continue;
        }
        // Match by paneId against config members' tmuxPaneId
        if (session.paneId) {
          for (const member of config.members) {
            if (member.tmuxPaneId && member.tmuxPaneId === session.paneId) {
              const isLead = member.teamRole === "lead" || member.agentType === "team-lead";
              session.teamName = config.name;
              session.teammateName = isLead ? undefined : member.name;
              session.teamRole = isLead ? "lead" : "teammate";
              changed = true;
              break;
            }
          }
        }
      }
    }
    if (changed) this.emitChanged();
  }

  startLivenessCheck(): void {
    this.livenessTimer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (session.status === "ended") continue;
        if (session.isRemote) continue;
        const pid = session.lastEvent.pid;
        if (!pid) continue;
        try {
          process.kill(pid, 0);
        } catch {
          session.status = "ended";
          this.scheduleCleanup(session.sessionId);
          this.emitChanged();
        }
      }
    }, 5_000);
  }

  private clearCleanupTimer(sessionId: string): void {
    const timer = this.cleanupTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(sessionId);
    }
  }

  private emitChanged(): void {
    this.emit("sessions-changed", this.getSessions());
  }

  private async readFirstPromptFromTranscript(session: AgentSession): Promise<void> {
    if (session.isRemote) return;
    if (!session.transcriptPath) return;
    try {
      const file = Bun.file(session.transcriptPath);
      const text = await file.text();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const msg = extractPromptFromTranscriptEntry(entry);
          if (msg && isPromptCandidate(msg)) {
            session.conversationLabel = msg.slice(0, 200);
            this.emitChanged();
            return;
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // file not readable — ignore
    }
  }

  private scheduleCleanup(sessionId: string): void {
    this.clearCleanupTimer(sessionId);
    this.cleanupTimers.set(
      sessionId,
      setTimeout(() => {
        this.sessions.delete(sessionId);
        this.cleanupTimers.delete(sessionId);
        this.emitChanged();
      }, ENDED_CLEANUP_MS),
    );
  }
}

function extractPromptFromTranscriptEntry(entry: Record<string, unknown>): string {
  const payload = entry["payload"];
  const msg =
    entry["type"] === "response_item" && payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : entry;
  const role = msg["role"] ?? msg["type"];
  if (role !== "user" && role !== "human") return "";

  // Skip meta entries (system injections, command wrappers)
  if (msg["isMeta"]) return "";

  // Claude Code format: { type: "user", message: { role: "user", content: "..." } }
  if (msg["message"] && typeof msg["message"] === "object") {
    const inner = msg["message"] as Record<string, unknown>;
    if (typeof inner["content"] === "string") return inner["content"].trim();
    if (Array.isArray(inner["content"])) {
      return (inner["content"] as unknown[])
        .filter((part: unknown) => {
          if (!part || typeof part !== "object") return false;
          const type = (part as Record<string, unknown>)["type"];
          return type === "text" || type === "input_text";
        })
        .map((part: unknown) => String((part as Record<string, unknown>)["text"] ?? ""))
        .join(" ")
        .trim();
    }
  }

  // Flat format: { role: "user", content: "..." }
  if (typeof msg["message"] === "string") return msg["message"].trim();
  if (typeof msg["content"] === "string") return msg["content"].trim();
  if (!Array.isArray(msg["content"])) return "";

  return msg["content"]
    .filter((part: unknown) => {
      if (!part || typeof part !== "object") return false;
      const type = (part as Record<string, unknown>)["type"];
      return type === "text" || type === "input_text";
    })
    .map((part: unknown) => String((part as Record<string, unknown>)["text"] ?? ""))
    .join(" ")
    .trim();
}

function isPromptCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !trimmed.startsWith("# AGENTS.md instructions for ") && !trimmed.startsWith("<environment_context>");
}
