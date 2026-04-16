import type { AgentEvent, HookSnifferEntry } from "../../agents/types.ts";

import { stripNonPrintingControlChars } from "../../util/text.ts";

export function buildHookSnifferEntry(event: AgentEvent): HookSnifferEntry {
  return {
    agentType: event.agentType,
    hookEvent: sanitizeRequiredHookSnifferText(event.hookEvent ?? event.status, event.status),
    pid: event.pid,
    sessionId: sanitizeRequiredHookSnifferText(event.sessionId, "unknown"),
    status: event.status,
    timestamp: event.timestamp,
    toolInput: event.toolInput,
    toolName: sanitizeOptionalHookSnifferText(event.toolName),
  };
}

function sanitizeOptionalHookSnifferText(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const sanitized = stripNonPrintingControlChars(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeRequiredHookSnifferText(value: string, fallback: string): string {
  return sanitizeOptionalHookSnifferText(value) ?? fallback;
}
