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
  resolvePaneBindingByPaneId(remotePaneId: string): Promise<RemotePaneBinding | undefined>;
  validateProcessBinding(pid: number, panePid: number): Promise<boolean>;
}

export async function validateRemoteAgentEvent(
  event: AgentEvent,
  deps: ValidateRemoteAgentEventDeps,
): Promise<boolean> {
  if (typeof event.paneId !== "string" || event.paneId.length === 0) return false;
  if (typeof event.pid !== "number" || !Number.isInteger(event.pid) || event.pid <= 1) return false;

  const binding = await deps.resolvePaneBindingByPaneId(event.paneId);
  if (!binding) return false;

  // Canonicalize `event.pid` to the long-lived agent ancestor via the
  // embedded process snapshot BEFORE the remote-side pid check. The hook
  // reports `os.getppid()`, which is the agent itself when the agent
  // exec's the hook directly, but a transient `/bin/sh -c <command>`
  // wrapper when the agent dispatches the hook through a shell — and
  // that wrapper exits as soon as the hook returns. Resolving first
  // means the subsequent SSH ancestry check runs against the same pid
  // in either dispatch mode and sees a still-alive process.
  if (deps.processLookup) {
    event.pid = resolveAgentSessionPid(event.pid, event.agentType, binding.panePid, deps.processLookup);
  }

  if (!(await deps.validateProcessBinding(event.pid, binding.panePid))) return false;

  return true;
}
