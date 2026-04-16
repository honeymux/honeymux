import { describe, expect, it } from "bun:test";

import {
  collectProcessSubtreeCommandLines,
  normalizeTtyPath,
  parseProcStatParentPid,
  parsePsParentPidOutput,
  parsePsProcessSnapshotOutput,
  parsePsProcessTableOutput,
  parsePsTtyOutput,
} from "./process-introspection.ts";

describe("normalizeTtyPath", () => {
  it("keeps fully qualified tty paths", () => {
    expect(normalizeTtyPath("/dev/ttys001")).toBe("/dev/ttys001");
  });

  it("normalizes ps tty names to /dev paths", () => {
    expect(normalizeTtyPath("pts/7")).toBe("/dev/pts/7");
  });

  it("drops unknown tty sentinels", () => {
    expect(normalizeTtyPath("?")).toBeNull();
    expect(normalizeTtyPath("")).toBeNull();
  });
});

describe("parseProcStatParentPid", () => {
  it("extracts the parent pid from /proc stat lines with spaces in the command", () => {
    const stat = "12345 (bun worker thread) S 678 123 123 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 1 2 3";
    expect(parseProcStatParentPid(stat)).toBe(678);
  });

  it("returns null for malformed stat lines", () => {
    expect(parseProcStatParentPid("12345 bun worker")).toBeNull();
  });
});

describe("parsePsParentPidOutput", () => {
  it("parses a numeric parent pid", () => {
    expect(parsePsParentPidOutput("  4321\n")).toBe(4321);
  });

  it("rejects invalid output", () => {
    expect(parsePsParentPidOutput("n/a")).toBeNull();
  });
});

describe("parsePsProcessTableOutput", () => {
  it("parses pid, ppid, and command columns", () => {
    expect(parsePsProcessTableOutput("  100   1 /bin/zsh\n  200 100 node /opt/codex/bin/cli.js\n")).toEqual([
      { command: "/bin/zsh", parentPid: 1, pid: 100 },
      { command: "node /opt/codex/bin/cli.js", parentPid: 100, pid: 200 },
    ]);
  });

  it("ignores malformed rows", () => {
    expect(parsePsProcessTableOutput("oops\n  100 nope cmd\n")).toEqual([]);
  });
});

describe("parsePsProcessSnapshotOutput", () => {
  it("parses pid, ppid, tty, and command columns", () => {
    expect(
      parsePsProcessSnapshotOutput("  100   1 ttys001 /bin/zsh\n  200 100 ?? node /opt/codex/bin/cli.js\n"),
    ).toEqual([
      { command: "/bin/zsh", parentPid: 1, pid: 100, tty: "/dev/ttys001" },
      { command: "node /opt/codex/bin/cli.js", parentPid: 100, pid: 200, tty: null },
    ]);
  });
});

describe("collectProcessSubtreeCommandLines", () => {
  it("returns the root process and every descendant command", () => {
    const entries = [
      { command: "/bin/zsh", parentPid: 1, pid: 100 },
      { command: "node /opt/claude/bin/cli.js", parentPid: 100, pid: 200 },
      { command: "bun /srv/opencode/index.ts", parentPid: 100, pid: 300 },
      { command: "ignored child", parentPid: 999, pid: 400 },
      { command: "node /opt/codex/bin/worker.js", parentPid: 200, pid: 500 },
    ];

    expect(collectProcessSubtreeCommandLines(100, entries)).toEqual([
      "/bin/zsh",
      "node /opt/claude/bin/cli.js",
      "bun /srv/opencode/index.ts",
      "node /opt/codex/bin/worker.js",
    ]);
  });

  it("returns an empty list for an invalid root pid", () => {
    expect(collectProcessSubtreeCommandLines(0, [])).toEqual([]);
  });
});

describe("parsePsTtyOutput", () => {
  it("normalizes ps tty output", () => {
    expect(parsePsTtyOutput("ttys003\n")).toBe("/dev/ttys003");
  });

  it("drops unknown ps tty output", () => {
    expect(parsePsTtyOutput("?\n")).toBeNull();
  });
});
