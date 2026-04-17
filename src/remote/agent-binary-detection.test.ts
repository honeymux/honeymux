import { describe, expect, it } from "bun:test";

import type { RemoteExec, RemoteExecResult } from "./remote-exec.ts";

import { detectRemoteRunningAgentTypes } from "./agent-binary-detection.ts";

describe("detectRemoteRunningAgentTypes", () => {
  it("detects a direct agent name from list-panes output", async () => {
    const controlClient = {
      async sendCommand(_cmd: string) {
        return "claude\t12345\t/dev/pts/3\n";
      },
    };
    const exec: RemoteExec = {
      async exec(): Promise<RemoteExecResult> {
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    };
    const result = await detectRemoteRunningAgentTypes({ controlClient, exec });
    expect([...result]).toEqual(["claude"]);
  });

  it("detects a wrapped agent via the remote /proc snapshot", async () => {
    const paneListOutput = "node\t2000\t/dev/pts/7\n";
    const psOutput = ["2000 1 /dev/pts/7 /usr/bin/node /opt/gemini/cli.js --some-flag"].join("\n");
    const controlClient = {
      async sendCommand(_cmd: string) {
        return paneListOutput;
      },
    };
    const exec: RemoteExec = {
      async exec(): Promise<RemoteExecResult> {
        return { exitCode: 0, stderr: "", stdout: psOutput };
      },
    };
    const result = await detectRemoteRunningAgentTypes({ controlClient, exec });
    expect(result.has("gemini")).toBe(true);
  });

  it("returns an empty set when the remote ps exec fails", async () => {
    const controlClient = {
      async sendCommand(_cmd: string) {
        return "bash\t1000\t/dev/pts/0\n";
      },
    };
    const exec: RemoteExec = {
      async exec(): Promise<RemoteExecResult> {
        return { exitCode: 1, stderr: "ps failed", stdout: "" };
      },
    };
    const result = await detectRemoteRunningAgentTypes({ controlClient, exec });
    expect(result.size).toBe(0);
  });

  it("queries both sources in parallel", async () => {
    const order: string[] = [];
    const controlClient = {
      async sendCommand(_cmd: string) {
        order.push("list-panes:start");
        await Bun.sleep(5);
        order.push("list-panes:end");
        return "";
      },
    };
    const exec: RemoteExec = {
      async exec(): Promise<RemoteExecResult> {
        order.push("ps:start");
        await Bun.sleep(5);
        order.push("ps:end");
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    };
    await detectRemoteRunningAgentTypes({ controlClient, exec });
    // Parallel execution: both starts should precede both ends.
    expect(order.indexOf("list-panes:start") < order.indexOf("ps:end")).toBe(true);
    expect(order.indexOf("ps:start") < order.indexOf("list-panes:end")).toBe(true);
  });
});
