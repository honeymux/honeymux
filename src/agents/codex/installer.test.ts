import { describe, expect, it } from "bun:test";

import {
  buildCodexHookCommand,
  ensureCodexHooksFeature,
  ensureCodexHooksTrust,
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
  it("stores the interpreter by name and quotes the script path safely", () => {
    expect(buildCodexHookCommand("/home/test user/.codex/hooks/honeymux.py", () => "/usr/bin/python3")).toBe(
      "python3 '/home/test user/.codex/hooks/honeymux.py'",
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

  it("registers every supported event on a clean install", () => {
    const settings = upsertCodexHookSettings({}, "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py");
    const expectedGroup = [
      {
        hooks: [
          {
            command: "/usr/bin/python3 /home/me/.codex/hooks/honeymux.py",
            type: "command" as const,
          },
        ],
      },
    ];
    expect(settings.hooks?.["PermissionRequest"]).toEqual(expectedGroup);
    expect(settings.hooks?.["PostToolUse"]).toEqual(expectedGroup);
    expect(settings.hooks?.["SessionStart"]).toEqual(expectedGroup);
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
    expect(ensureCodexHooksFeature("")).toBe("[features]\nhooks = true\n");
  });

  it("preserves existing config and appends a features section with one separator", () => {
    expect(ensureCodexHooksFeature("[other]\nkey = 1\n")).toBe("[other]\nkey = 1\n\n[features]\nhooks = true\n");
  });

  it("is idempotent — does not accumulate trailing newlines on repeat runs", () => {
    const initial = "[features]\nhooks = true\n";
    const once = ensureCodexHooksFeature(initial);
    const twice = ensureCodexHooksFeature(once);
    const thrice = ensureCodexHooksFeature(twice);
    expect(once).toBe(initial);
    expect(twice).toBe(initial);
    expect(thrice).toBe(initial);
  });

  it("normalizes pre-existing trailing whitespace down to a single newline", () => {
    expect(ensureCodexHooksFeature("[features]\nhooks = true\n\n\n\n")).toBe("[features]\nhooks = true\n");
  });

  it("inserts codex_hooks into an existing empty [features] section", () => {
    expect(ensureCodexHooksFeature("[features]\n")).toBe("[features]\nhooks = true\n");
  });
});

describe("ensureCodexHooksTrust", () => {
  // These three hashes are taken from a live `~/.codex/config.toml` after the
  // user trusted each hook via codex's UI. They pin the canonical hashing
  // algorithm — if any of these change, codex will reject the trust entry and
  // silently no-op the hook.
  const HOOKS_PATH = "/home/aaron/.codex/hooks.json";
  const COMMAND = "/home/linuxbrew/.linuxbrew/bin/python3 /home/aaron/.codex/hooks/honeymux.py";
  const PERMISSION_REQUEST_HASH = "sha256:70cea8a5f8b8853b8b62350aee7b9fd71edf38c40584a9d44cc3f7ea7b016ba4";
  const POST_TOOL_USE_HASH = "sha256:746c2ac973e59f08706463d4740f843734c2b93e070e2603a703acfd2514ea80";
  const SESSION_START_HASH = "sha256:6aea0e1c872d7316dd1b58b1bcf916a0666d37ea7427dcec6449df8978faefdd";

  it("appends trust entries for every managed event on a clean config", () => {
    const result = ensureCodexHooksTrust("", HOOKS_PATH, COMMAND);
    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:permission_request:0:0"]`);
    expect(result).toContain(`trusted_hash = "${PERMISSION_REQUEST_HASH}"`);
    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:post_tool_use:0:0"]`);
    expect(result).toContain(`trusted_hash = "${POST_TOOL_USE_HASH}"`);
    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:session_start:0:0"]`);
    expect(result).toContain(`trusted_hash = "${SESSION_START_HASH}"`);
  });

  it("trusts the honeymux hook at its preserved index after existing user hooks", () => {
    const settings = upsertCodexHookSettings(
      {
        hooks: {
          PermissionRequest: [
            {
              hooks: [
                {
                  command: "echo user-permission",
                  type: "command",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              hooks: [
                {
                  command: "echo user-post",
                  type: "command",
                },
              ],
            },
          ],
          SessionStart: [
            {
              hooks: [
                {
                  command: "echo user-session",
                  type: "command",
                },
              ],
            },
          ],
        },
      },
      COMMAND,
    );

    const result = ensureCodexHooksTrust("", HOOKS_PATH, COMMAND, settings);

    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:permission_request:1:0"]`);
    expect(result).toContain(`trusted_hash = "${PERMISSION_REQUEST_HASH}"`);
    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:post_tool_use:1:0"]`);
    expect(result).toContain(`trusted_hash = "${POST_TOOL_USE_HASH}"`);
    expect(result).toContain(`[hooks.state."${HOOKS_PATH}:session_start:1:0"]`);
    expect(result).toContain(`trusted_hash = "${SESSION_START_HASH}"`);
    expect(result).not.toContain(`[hooks.state."${HOOKS_PATH}:permission_request:0:0"]`);
    expect(result).not.toContain(`[hooks.state."${HOOKS_PATH}:post_tool_use:0:0"]`);
    expect(result).not.toContain(`[hooks.state."${HOOKS_PATH}:session_start:0:0"]`);
  });

  it("preserves unrelated config content", () => {
    const initial = "[features]\nhooks = true\n\n[other]\nkey = 1\n";
    const result = ensureCodexHooksTrust(initial, HOOKS_PATH, COMMAND);
    expect(result).toContain("[features]\nhooks = true");
    expect(result).toContain("[other]\nkey = 1");
  });

  it("is idempotent across repeat runs", () => {
    const once = ensureCodexHooksTrust("", HOOKS_PATH, COMMAND);
    const twice = ensureCodexHooksTrust(once, HOOKS_PATH, COMMAND);
    expect(twice).toBe(once);
  });

  it("updates a stale trusted_hash in place rather than appending a duplicate", () => {
    const stale = [`[hooks.state."${HOOKS_PATH}:post_tool_use:0:0"]`, `trusted_hash = "sha256:dead"`, ""].join("\n");
    const result = ensureCodexHooksTrust(stale, HOOKS_PATH, COMMAND);
    expect(result).toContain(`trusted_hash = "${POST_TOOL_USE_HASH}"`);
    expect(result).not.toContain("sha256:dead");
    const matches = result.match(new RegExp(`\\[hooks\\.state\\."${HOOKS_PATH}:post_tool_use:0:0"\\]`, "g"));
    expect(matches?.length).toBe(1);
  });

  it("preserves a sibling enabled=true line when only trusted_hash needs updating", () => {
    const initial = [
      `[hooks.state."${HOOKS_PATH}:permission_request:0:0"]`,
      `enabled = true`,
      `trusted_hash = "sha256:stale"`,
      "",
    ].join("\n");
    const result = ensureCodexHooksTrust(initial, HOOKS_PATH, COMMAND);
    expect(result).toContain("enabled = true");
    expect(result).toContain(`trusted_hash = "${PERMISSION_REQUEST_HASH}"`);
    expect(result).not.toContain("sha256:stale");
  });
});
