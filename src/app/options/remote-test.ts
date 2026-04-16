import type { OptionsWorkflowApi } from "../hooks/use-options-workflow.ts";
import type { OptionsDialogState } from "./model.ts";

import { appendSshDestination, validateSshDestination } from "../../remote/ssh.ts";
import { cleanEnv } from "../../util/pty.ts";

export function maybeStartRemoteTest(
  previous: OptionsDialogState,
  next: OptionsDialogState,
  workflow: OptionsWorkflowApi,
): void {
  if (next.remoteTesting?.status !== "testing" || previous.remoteTesting?.status === "testing") {
    return;
  }

  const testIndex = next.remoteTesting.index;
  const server = next.remoteServers[testIndex];
  if (!server) return;

  const hostError = validateSshDestination(server.host);
  if (hostError) {
    workflow.setConfigRemoteTesting({
      index: testIndex,
      message: `invalid host: ${hostError}`,
      status: "error",
    });
    return;
  }

  const sshArgs: string[] = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];
  if (server.agentForwarding) sshArgs.push("-A");
  appendSshDestination(sshArgs, server.host);
  sshArgs.push("echo", "ok");

  const proc = Bun.spawn(["ssh", ...sshArgs], {
    env: cleanEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });

  proc.exited.then(async (code) => {
    if (code === 0) {
      workflow.setConfigRemoteTesting({ index: testIndex, status: "success" });
      return;
    }
    const stderr = await new Response(proc.stderr).text();
    const message = stderr.trim().split("\n").pop() || "connection failed";
    workflow.setConfigRemoteTesting({ index: testIndex, message, status: "error" });
  });
}
