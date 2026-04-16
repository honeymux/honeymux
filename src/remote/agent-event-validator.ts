import type { AgentEvent } from "../agents/types.ts";

export interface RemotePaneBinding {
  localPaneId: string;
  panePid: number;
  remotePaneId: string;
}

export interface ValidateRemoteAgentEventDeps {
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

  return deps.validateProcessBinding(event.pid, event.tty, binding.panePid);
}
