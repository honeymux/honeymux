import { describe, expect, it } from "bun:test";

import { buildClaudeHookCommand, resolveClaudeHookPython, upsertClaudeHookSettings } from "./installer.ts";

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
