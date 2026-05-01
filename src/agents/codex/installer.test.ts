import { describe, expect, it } from "bun:test";

import {
  buildCodexHookCommand,
  ensureCodexHooksFeature,
  resolveCodexHookPython,
  upsertCodexHookSettings,
} from "./installer.ts";

describe("resolveCodexHookPython", () => {
  it("prefers python3 when available", () => {
    expect(resolveCodexHookPython((name) => (name === "python3" ? "/usr/bin/python3" : undefined))).toBe(
      "/usr/bin/python3",
    );
  });

  it("falls back to python when python3 is unavailable", () => {
    expect(resolveCodexHookPython((name) => (name === "python" ? "/usr/bin/python" : undefined))).toBe(
      "/usr/bin/python",
    );
  });

  it("returns null when no interpreter is available", () => {
    expect(resolveCodexHookPython(() => undefined)).toBeNull();
  });
});

describe("buildCodexHookCommand", () => {
  it("formats an absolute interpreter command safely", () => {
    expect(buildCodexHookCommand("/home/test user/.codex/hooks/honeymux.py", () => "/usr/bin/python3")).toBe(
      "/usr/bin/python3 '/home/test user/.codex/hooks/honeymux.py'",
    );
  });
});

describe("upsertCodexHookSettings", () => {
  it("replaces existing honeymux hook entries for every registered event", () => {
    const settings = upsertCodexHookSettings(
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
                  command: "python3 /old/honeymux.py",
                  type: "command",
                },
              ],
            },
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
      "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
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
            command: "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);

    expect(settings.hooks?.["PermissionRequest"]).toEqual([
      {
        hooks: [
          {
            command: "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);
  });

  it("registers PermissionRequest on a clean install", () => {
    const settings = upsertCodexHookSettings({}, "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py");
    expect(settings.hooks?.["PermissionRequest"]).toEqual([
      {
        hooks: [
          {
            command: "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);
    expect(settings.hooks?.["SessionStart"]).toEqual([
      {
        hooks: [
          {
            command: "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
            type: "command",
          },
        ],
      },
    ]);
  });

  it("is idempotent across repeat installs", () => {
    const command = "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py";
    const once = upsertCodexHookSettings({}, command);
    const twice = upsertCodexHookSettings(once, command);
    expect(twice).toEqual(once);
  });
});

describe("ensureCodexHooksFeature", () => {
  it("adds the features section to an empty config without leading blank lines", () => {
    expect(ensureCodexHooksFeature("")).toBe("[features]\ncodex_hooks = true\n");
  });

  it("preserves existing config and appends a features section with one separator", () => {
    expect(ensureCodexHooksFeature("[other]\nkey = 1\n")).toBe("[other]\nkey = 1\n\n[features]\ncodex_hooks = true\n");
  });

  it("is idempotent — does not accumulate trailing newlines on repeat runs", () => {
    const initial = "[features]\ncodex_hooks = true\n";
    const once = ensureCodexHooksFeature(initial);
    const twice = ensureCodexHooksFeature(once);
    const thrice = ensureCodexHooksFeature(twice);
    expect(once).toBe(initial);
    expect(twice).toBe(initial);
    expect(thrice).toBe(initial);
  });

  it("normalizes pre-existing trailing whitespace down to a single newline", () => {
    expect(ensureCodexHooksFeature("[features]\ncodex_hooks = true\n\n\n\n")).toBe("[features]\ncodex_hooks = true\n");
  });

  it("inserts codex_hooks into an existing empty [features] section", () => {
    expect(ensureCodexHooksFeature("[features]\n")).toBe("[features]\ncodex_hooks = true\n");
  });
});
