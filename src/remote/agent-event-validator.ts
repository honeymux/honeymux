import type { AgentEvent } from "../agents/types.ts";
import type { ProcessLookup } from "../util/process-introspection.ts";

import { resolveAgentSessionPid } from "../agents/socket-server.ts";

export interface RemotePaneBinding {
  localPaneId: string;
  panePid: number;
  remotePaneId: string;
}

interface ValidateRemoteAgentEventDeps {
  processLookup?: ProcessLookup;
  resolvePaneBinding(tty: string): Promise<RemotePaneBinding | undefined>;
  validateProcessBinding(pid: number, tty: string, panePid: number): Promise<boolean>;
}

export async function validateRemoteAgentEvent(
  event: AgentEvent,
  deps: ValidateRemoteAgentEventDeps,
): Promise<boolean> {
  if (typeof event.tty !== "string" || event.tty.length === 0) return false;
  if (typeof event.pid !== "number" || !Number.isInteger(event.pid) || event.pid <= 1) return false;

  const binding = await deps.resolvePaneBinding(event.tty);
  if (!binding) return false;

  if (!(await deps.validateProcessBinding(event.pid, event.tty, binding.panePid))) return false;

  if (deps.processLookup) {
    event.pid = resolveAgentSessionPid(event.pid, event.agentType, binding.panePid, deps.processLookup);
  }
  return true;
}
