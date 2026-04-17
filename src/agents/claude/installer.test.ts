import { describe, expect, it } from "bun:test";

import type { InstallHost } from "../install-host.ts";

import {
  areClaudeHooksInstalled,
  buildClaudeHookCommand,
  installClaudeHooks,
  resolveClaudeHookPython,
  upsertClaudeHookSettings,
} from "./installer.ts";

function makeFakeHost(options: { hostId?: string } = {}): {
  dirs: Set<string>;
  files: Map<string, string>;
  host: InstallHost;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const host: InstallHost = {
    async homeDir() {
      return "/home/test";
    },
    hostId: options.hostId ?? "test",
    async mkdir(path) {
      dirs.add(path);
    },
    async readFile(path) {
      return files.has(path) ? files.get(path)! : null;
    },
    async resolveExecutable(name) {
      if (name === "python3") return "/usr/bin/python3";
      return null;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
  };
  return { dirs, files, host };
}

describe("resolveClaudeHookPython", () => {
  it("prefers python3 when available", () => {
    expect(resolveClaudeHookPython((name) => (name === "python3" ? "/opt/homebrew/bin/python3" : undefined))).toBe(
      "/opt/homebrew/bin/python3",
    );
  });

  it("falls back to python when python3 is unavailable", () => {
    expect(resolveClaudeHookPython((name) => (name === "python" ? "/usr/bin/python" : undefined))).toBe(
      "/usr/bin/python",
    );
  });

  it("returns null when no interpreter is available", () => {
    expect(resolveClaudeHookPython(() => undefined)).toBeNull();
  });
});

describe("buildClaudeHookCommand", () => {
  it("formats an absolute interpreter command safely", () => {
    expect(
      buildClaudeHookCommand("/Users/test user/.claude/hooks/honeymux.py", () => "/opt/homebrew/bin/python3"),
    ).toBe("/opt/homebrew/bin/python3 '/Users/test user/.claude/hooks/honeymux.py'");
  });
});

describe("installClaudeHooks (via InstallHost)", () => {
  it("writes the hook script and merges settings.json against the InstallHost", async () => {
    const { files, host } = makeFakeHost();
    const ok = await installClaudeHooks(host);
    expect(ok).toBe(true);

    const scriptPath = "/home/test/.claude/hooks/honeymux.py";
    const settingsPath = "/home/test/.claude/settings.json";
    expect(files.get(scriptPath)).toBeString();
    const settings = JSON.parse(files.get(settingsPath)!);
    expect(Array.isArray(settings.hooks.SessionStart)).toBe(true);
    const sessionStartCommand = settings.hooks.SessionStart.at(-1).hooks[0].command as string;
    expect(sessionStartCommand).toContain("/usr/bin/python3");
    expect(sessionStartCommand).toContain(scriptPath);
  });

  it("reports not-installed when the script is missing", async () => {
    const { host } = makeFakeHost();
    expect(await areClaudeHooksInstalled(host)).toBe(false);
  });

  it("reports installed after installClaudeHooks runs", async () => {
    const { host } = makeFakeHost();
    await installClaudeHooks(host);
    expect(await areClaudeHooksInstalled(host)).toBe(true);
  });
});

describe("upsertClaudeHookSettings", () => {
  it("replaces existing honeymux hook entries for every event", () => {
    const settings = upsertClaudeHookSettings(
      {
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                {
                  command: "python3 /old/honeymux.py",
                  type: "command",
                },
              ],
            },
          ],
          SessionStart: [
            {
              hooks: [
                {
                  command: "echo keep-me",
                  type: "command",
                },
              ],
            },
          ],
        },
      },
      "/opt/homebrew/bin/python3 /Users/me/.claude/hooks/honeymux.py",
    );

    expect(settings.hooks?.["SessionStart"]).toEqual([
      {
        hooks: [
          {
            command: "echo keep-me",
            type: "command",
          },
        ],
      },
      {
        hooks: [
          {
            async: true,
            command: "/opt/homebrew/bin/python3 /Users/me/.claude/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);

    expect(settings.hooks?.["PermissionRequest"]).toEqual([
      {
        hooks: [
          {
            command: "/opt/homebrew/bin/python3 /Users/me/.claude/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);

    expect(settings.hooks?.["SessionEnd"]).toEqual([
      {
        hooks: [
          {
            async: true,
            command: "/opt/homebrew/bin/python3 /Users/me/.claude/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);
  });
});
