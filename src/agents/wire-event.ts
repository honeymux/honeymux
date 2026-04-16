import type { AgentEvent } from "./types.ts";

const VALID_AGENT_TYPES = new Set<string>(["claude", "codex", "gemini", "opencode"]);
const VALID_AGENT_STATUSES = new Set<string>(["alive", "ended", "unanswered", "waitingForInput"]);
const VALID_TEAM_ROLES = new Set<string>(["lead", "teammate"]);

export function parseWireAgentEvent(input: unknown): AgentEvent | null {
  if (typeof input !== "object" || input === null) return null;

  const event = input as Record<string, unknown>;
  const sessionId = event["sessionId"];
  const agentType = event["agentType"];
  const status = event["status"];
  const cwd = event["cwd"];
  const timestamp = event["timestamp"];

  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  if (!VALID_AGENT_TYPES.has(agentType as string)) return null;
  if (!VALID_AGENT_STATUSES.has(status as string)) return null;
  if (typeof cwd !== "string") return null;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;

  const teamRoleValue = event["teamRole"];
  const teamRole =
    typeof teamRoleValue === "string" && VALID_TEAM_ROLES.has(teamRoleValue)
      ? (teamRoleValue as "lead" | "teammate")
      : undefined;

  return {
    agentType: agentType as AgentEvent["agentType"],
    cwd,
    hookEvent: getOptionalStringField(event, "hookEvent"),
    notification: getOptionalStringField(event, "notification"),
    pid: getOptionalIntegerField(event, "pid"),
    prompt: getOptionalStringField(event, "prompt"),
    remoteHost: getOptionalStringField(event, "remoteHost"),
    remoteServerName: getOptionalStringField(event, "remoteServerName"),
    serverUrl: getOptionalStringField(event, "serverUrl"),
    sessionId,
    status: status === "waitingForInput" ? "alive" : (status as AgentEvent["status"]),
    teamName: getOptionalStringField(event, "teamName"),
    teamRole,
    teammateName: getOptionalStringField(event, "teammateName"),
    timestamp,
    toolInput: getOptionalObjectField(event, "toolInput"),
    toolName: getOptionalStringField(event, "toolName"),
    toolUseId: getOptionalStringField(event, "toolUseId"),
    transcriptPath: getOptionalStringField(event, "transcriptPath"),
    tty: getOptionalStringField(event, "tty"),
  };
}

function getOptionalIntegerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function getOptionalObjectField(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getOptionalStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}
