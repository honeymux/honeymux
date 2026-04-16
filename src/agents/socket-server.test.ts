import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "./types.ts";

import { HookSocketServer, isPidBoundToPane, loadPersistedSessions, parseProcStatParentPid } from "./socket-server.ts";

describe("parseProcStatParentPid", () => {
  it("extracts the parent pid from /proc stat lines with spaces in the command", () => {
    const stat = "12345 (bun worker thread) S 678 123 123 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 1 2 3";
    expect(parseProcStatParentPid(stat)).toBe(678);
  });

  it("returns null for malformed stat lines", () => {
    expect(parseProcStatParentPid("12345 bun worker")).toBeNull();
  });
});

describe("loadPersistedSessions", () => {
  let tempDir: string;
  let prevRuntimeDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hmx-sockserver-"));
    prevRuntimeDir = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = tempDir;
    mkdirSync(join(tempDir, "honeymux", "sessions"), { recursive: true });
  });

  afterEach(() => {
    if (prevRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR;
    } else {
      process.env.XDG_RUNTIME_DIR = prevRuntimeDir;
    }
    rmSync(tempDir, { force: true, recursive: true });
  });

  it("clears stale permission metadata on reload so an answered session does not flip back to unanswered", () => {
    // Simulate the on-disk state from a previous honeymux run: an unanswered
    // PermissionRequest that the user answered before detaching (but which
    // was never rewritten on disk).
    const stale: AgentEvent = {
      agentType: "claude",
      cwd: "/work",
      hookEvent: "PermissionRequest",
      pid: process.pid, // live pid so loadPersistedSessions keeps it
      sessionId: "abc",
      status: "unanswered",
      timestamp: 1,
      toolInput: { command: "rm -rf /" },
      toolName: "Bash",
      toolUseId: "tu-1",
    };
    writeFileSync(join(tempDir, "honeymux", "sessions", "abc.json"), JSON.stringify(stale));

    const events = loadPersistedSessions("claude");
    expect(events.length).toBe(1);
    const reloaded = events[0]!;
    // Status forced to alive
    expect(reloaded.status).toBe("alive");
    // Permission-specific fields cleared so session-store does not re-derive
    // unanswered state from the stale hookEvent.
    expect(reloaded.hookEvent).toBeUndefined();
    expect(reloaded.toolInput).toBeUndefined();
    expect(reloaded.toolName).toBeUndefined();
    expect(reloaded.toolUseId).toBeUndefined();
  });
});

describe("isPidBoundToPane", () => {
  it("accepts a pid whose stdin tty matches and whose ancestry reaches the pane shell", () => {
    const parents = new Map([
      [100, 1],
      [500, 100],
      [900, 500],
    ]);

    expect(
      isPidBoundToPane(
        900,
        "/dev/pts/7",
        100,
        () => "/dev/pts/7",
        (pid) => parents.get(pid) ?? null,
      ),
    ).toBe(true);
  });

  it("rejects a pid on the wrong tty", () => {
    expect(
      isPidBoundToPane(
        900,
        "/dev/pts/7",
        100,
        () => "/dev/pts/8",
        () => 100,
      ),
    ).toBe(false);
  });

  it("rejects a pid outside the pane process tree", () => {
    const parents = new Map([
      [700, 1],
      [900, 700],
    ]);

    expect(
      isPidBoundToPane(
        900,
        "/dev/pts/7",
        100,
        () => "/dev/pts/7",
        (pid) => parents.get(pid) ?? null,
      ),
    ).toBe(false);
  });
});

describe("HookSocketServer", () => {
  let tempDir: string;
  let prevRuntimeDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hmx-hookserver-"));
    prevRuntimeDir = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = tempDir;
    mkdirSync(join(tempDir, "honeymux"), { recursive: true });
  });

  afterEach(() => {
    if (prevRuntimeDir === undefined) {
      delete process.env.XDG_RUNTIME_DIR;
    } else {
      process.env.XDG_RUNTIME_DIR = prevRuntimeDir;
    }
    rmSync(tempDir, { force: true, recursive: true });
  });

  it("denies unanswered events rejected by an async validator", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: async () => false,
      persistEvents: false,
    });

    const writes: string[] = [];
    let ended = false;
    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {
        ended = true;
      },
      flush() {},
      write(data: string) {
        writes.push(data);
        return data.length;
      },
    };

    await (server as any).processLine(
      socket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "PermissionRequest",
        pid: 900,
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
        tty: "/dev/pts/7",
      }),
    );

    expect(writes).toEqual([JSON.stringify({ decision: "deny" }) + "\n"]);
    expect(ended).toBe(true);
  });
});
