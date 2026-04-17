import type { AgentType } from "../app/hooks/agent-binary-detection-core.ts";
import type { RemoteControlClient } from "./remote-control-client.ts";
import type { RemoteExec } from "./remote-exec.ts";

import { detectRunningAgentTypes } from "../app/hooks/agent-binary-detection-core.ts";
import { parsePsProcessSnapshotOutput } from "../util/process-introspection.ts";

const PANE_LIST_FORMAT = "#{pane_current_command}\t#{pane_pid}\t#{pane_tty}";
const PS_ARGS = ["ps", "-axww", "-o", "pid=", "-o", "ppid=", "-o", "tty=", "-o", "command="];

export interface RemoteDetectionSource {
  controlClient: Pick<RemoteControlClient, "sendCommand">;
  exec: RemoteExec;
}

/**
 * Detect which known coding agents are running on a remote host.
 *
 * Combines a tmux list-panes query against the remote mirror session with a
 * /proc subtree scan run over the same SSH channel, then delegates to the
 * pure local parser so wrapped-binary detection behaves identically.
 */
export async function detectRemoteRunningAgentTypes(source: RemoteDetectionSource): Promise<Set<AgentType>> {
  const [paneListOutput, psResult] = await Promise.all([
    source.controlClient.sendCommand(`list-panes -a -F '${PANE_LIST_FORMAT}'`),
    source.exec.exec(PS_ARGS),
  ]);
  const entries = psResult.exitCode === 0 ? parsePsProcessSnapshotOutput(psResult.stdout) : [];
  return detectRunningAgentTypes(paneListOutput, () => entries);
}
