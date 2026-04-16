import { describe, expect, it } from "bun:test";

import {
  detectRunningAgentTypes,
  detectWrappedAgentType,
  parsePaneProcessSnapshots,
} from "./agent-binary-detection-core.ts";

describe("parsePaneProcessSnapshots", () => {
  it("parses tmux pane_current_command snapshots", () => {
    expect(parsePaneProcessSnapshots("claude\t101\t/dev/ttys001\nnode\t202\tpts/7\n")).toEqual([
      { command: "claude", pid: 101, tty: "/dev/ttys001" },
      { command: "node", pid: 202, tty: "/dev/pts/7" },
    ]);
  });

  it("keeps commands even when the pid is invalid", () => {
    expect(parsePaneProcessSnapshots("node nope\n")).toEqual([{ command: "node", pid: NaN, tty: null }]);
  });
});

describe("detectWrappedAgentType", () => {
  it("matches wrapped agent command lines", () => {
    expect(detectWrappedAgentType("node /opt/claude/bin/cli.js")).toBe("claude");
    expect(detectWrappedAgentType("bun /srv/opencode/index.ts")).toBe("opencode");
    expect(detectWrappedAgentType("node /opt/codex/bin/worker.js")).toBe("codex");
    expect(detectWrappedAgentType("node /opt/gemini/dist/index.js")).toBe("gemini");
  });

  it("ignores unrelated command lines", () => {
    expect(detectWrappedAgentType("node /srv/app/server.js")).toBeUndefined();
  });
});

describe("detectRunningAgentTypes", () => {
  it("detects direct pane commands and process-table fallbacks", () => {
    const processes = [
      { command: "node /opt/claude/bin/cli.js", parentPid: 1, pid: 202, tty: "/dev/ttys001" },
      { command: "bun /srv/opencode/index.ts", parentPid: 1, pid: 303, tty: "/dev/ttys002" },
      { command: "node /opt/codex/bin/worker.js", parentPid: 303, pid: 304, tty: "/dev/ttys002" },
      { command: "node /opt/claude/bin/cli.js", parentPid: 1, pid: 500, tty: "/dev/ttys003" },
    ];

    const running = detectRunningAgentTypes(
      [
        "claude\t101\t/dev/ttys000",
        "2.1.110\t202\t/dev/ttys001",
        "shell\t303\t/dev/ttys002",
        "login\tnope\t/dev/ttys003",
      ].join("\n"),
      () => processes,
    );

    expect([...running].sort()).toEqual(["claude", "codex", "opencode"]);
  });

  it("ignores panes without a usable pid or tty", () => {
    const running = detectRunningAgentTypes("2.1.110\tnope\t?\n", () => []);
    expect([...running]).toEqual([]);
  });
});
