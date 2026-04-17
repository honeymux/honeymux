import { describe, expect, it } from "bun:test";

import type { RemoteExec, RemoteExecOptions, RemoteExecResult } from "./remote-exec.ts";

import { RemoteInstallHost } from "./remote-install-host.ts";

interface Recorded {
  argv: string[];
  stdin?: string;
}

function fakeExec(handler: (argv: string[], options: RemoteExecOptions) => Partial<RemoteExecResult>): {
  exec: RemoteExec;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const exec: RemoteExec = {
    async exec(argv, options = {}) {
      recorded.push({ argv: [...argv], stdin: options.stdin });
      const result = handler(argv, options);
      return {
        exitCode: result.exitCode ?? 0,
        stderr: result.stderr ?? "",
        stdout: result.stdout ?? "",
      };
    },
  };
  return { exec, recorded };
}

describe("RemoteInstallHost", () => {
  it("reports the server name as hostId", () => {
    const { exec } = fakeExec(() => ({}));
    const host = new RemoteInstallHost("prod-box", exec);
    expect(host.hostId).toBe("prod-box");
  });

  it("homeDir runs sh -c and caches the result", async () => {
    const { exec, recorded } = fakeExec(() => ({ stdout: "/home/alice" }));
    const host = new RemoteInstallHost("prod-box", exec);
    expect(await host.homeDir()).toBe("/home/alice");
    expect(await host.homeDir()).toBe("/home/alice");
    expect(recorded.length).toBe(1);
    expect(recorded[0]!.argv).toEqual(["sh", "-c", 'printf "%s" "$HOME"']);
  });

  it("homeDir rejects non-absolute paths", async () => {
    const { exec } = fakeExec(() => ({ stdout: "relative-home" }));
    const host = new RemoteInstallHost("prod-box", exec);
    await expect(host.homeDir()).rejects.toThrow(/non-absolute/);
  });

  it("mkdir passes argv without shell concatenation", async () => {
    const { exec, recorded } = fakeExec(() => ({}));
    const host = new RemoteInstallHost("prod-box", exec);
    await host.mkdir("/home/alice/.claude/hooks", { recursive: true });
    expect(recorded[0]!.argv).toEqual(["mkdir", "-p", "--", "/home/alice/.claude/hooks"]);
  });

  it("readFile returns null when the file does not exist", async () => {
    const { exec, recorded } = fakeExec(() => ({ exitCode: 3 }));
    const host = new RemoteInstallHost("prod-box", exec);
    expect(await host.readFile("/home/alice/.claude/settings.json")).toBe(null);
    expect(recorded[0]!.argv[0]).toBe("sh");
    expect(recorded[0]!.argv[3]).toBe("sh");
    expect(recorded[0]!.argv[4]).toBe("/home/alice/.claude/settings.json");
  });

  it("readFile returns contents on success", async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '{"hooks":{}}' }));
    const host = new RemoteInstallHost("prod-box", exec);
    expect(await host.readFile("/home/alice/.claude/settings.json")).toBe('{"hooks":{}}');
  });

  it("writeFile passes content via stdin and mode as a positional arg", async () => {
    const { exec, recorded } = fakeExec(() => ({}));
    const host = new RemoteInstallHost("prod-box", exec);
    await host.writeFile("/home/alice/.claude/hooks/honeymux.py", "print('hi')\n", { mode: 0o755 });
    const [call] = recorded;
    expect(call!.argv[0]).toBe("sh");
    expect(call!.argv[1]).toBe("-c");
    expect(call!.argv[2]).toContain('cat > "$1"');
    expect(call!.argv[2]).toContain('chmod "$2"');
    // sh -c "script" sh <path> <mode>
    expect(call!.argv[3]).toBe("sh");
    expect(call!.argv[4]).toBe("/home/alice/.claude/hooks/honeymux.py");
    expect(call!.argv[5]).toBe("755");
    expect(call!.stdin).toBe("print('hi')\n");
  });

  it("writeFile omits chmod when no mode is provided", async () => {
    const { exec, recorded } = fakeExec(() => ({}));
    const host = new RemoteInstallHost("prod-box", exec);
    await host.writeFile("/home/alice/.gemini/settings.json", "{}\n");
    const [call] = recorded;
    expect(call!.argv[5]).toBe("");
    expect(call!.stdin).toBe("{}\n");
  });

  it("resolveExecutable returns the first absolute path reported by command -v", async () => {
    const { exec, recorded } = fakeExec((argv) => {
      if (argv.includes("python3")) return { exitCode: 0, stdout: "/usr/bin/python3\n" };
      return { exitCode: 1, stdout: "" };
    });
    const host = new RemoteInstallHost("prod-box", exec);
    expect(await host.resolveExecutable("python3")).toBe("/usr/bin/python3");
    expect(await host.resolveExecutable("python3")).toBe("/usr/bin/python3"); // cached
    expect(recorded.length).toBe(1);
  });

  it("resolveExecutable returns null when command -v is empty or non-absolute", async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: "" }));
    const host = new RemoteInstallHost("prod-box", exec);
    expect(await host.resolveExecutable("missing")).toBe(null);
  });

  it("writeFile surfaces non-zero exit codes as errors", async () => {
    const { exec } = fakeExec(() => ({ exitCode: 5, stderr: "disk full" }));
    const host = new RemoteInstallHost("prod-box", exec);
    await expect(host.writeFile("/tmp/x", "")).rejects.toThrow(/disk full/);
  });
});
