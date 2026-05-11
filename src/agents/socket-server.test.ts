import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "./types.ts";

import {
  HookSocketServer,
  isPidBoundToPane,
  isPidDescendedFromPane,
  loadPersistedSessions,
  parseProcStatParentPid,
  resolveAgentSessionPid,
} from "./socket-server.ts";

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
      isPidBoundToPane(900, "/dev/pts/7", 100, {
        getCommand: () => null,
        getParentPid: (pid) => parents.get(pid) ?? null,
        getStdinTty: () => "/dev/pts/7",
      }),
    ).toBe(true);
  });

  it("rejects a pid on the wrong tty", () => {
    expect(
      isPidBoundToPane(900, "/dev/pts/7", 100, {
        getCommand: () => null,
        getParentPid: () => 100,
        getStdinTty: () => "/dev/pts/8",
      }),
    ).toBe(false);
  });

  it("rejects a pid outside the pane process tree", () => {
    const parents = new Map([
      [700, 1],
      [900, 700],
    ]);

    expect(
      isPidBoundToPane(900, "/dev/pts/7", 100, {
        getCommand: () => null,
        getParentPid: (pid) => parents.get(pid) ?? null,
        getStdinTty: () => "/dev/pts/7",
      }),
    ).toBe(false);
  });
});

describe("isPidDescendedFromPane", () => {
  it("accepts a pid whose ancestry reaches the pane shell", () => {
    const parents = new Map([
      [100, 1],
      [500, 100],
      [900, 500],
    ]);

    expect(
      isPidDescendedFromPane(900, 100, {
        getCommand: () => null,
        getParentPid: (pid) => parents.get(pid) ?? null,
        getStdinTty: () => null,
      }),
    ).toBe(true);
  });

  it("rejects a pid outside the pane process tree", () => {
    const parents = new Map([
      [700, 1],
      [900, 700],
    ]);

    expect(
      isPidDescendedFromPane(900, 100, {
        getCommand: () => null,
        getParentPid: (pid) => parents.get(pid) ?? null,
        getStdinTty: () => null,
      }),
    ).toBe(false);
  });
});

describe("resolveAgentSessionPid", () => {
  function fakeLookup(processes: Array<{ command: string; parentPid: null | number; pid: number }>) {
    const byPid = new Map(processes.map((p) => [p.pid, p]));
    return {
      getCommand: (pid: number) => byPid.get(pid)?.command ?? null,
      getParentPid: (pid: number) => byPid.get(pid)?.parentPid ?? null,
      getStdinTty: () => null,
    };
  }

  it("substitutes the wrapper shell pid with the claude ancestor", () => {
    // claude (911803) → /bin/sh -c "... hook ..." (912389) → python honeymux.py
    // os.getppid() in the hook reports the wrapper sh as event.pid; we walk
    // up and find the claude ancestor instead.
    const lookup = fakeLookup([
      { command: "claude", parentPid: 100, pid: 911803 },
      { command: "sh -c /path/to/honeymux.py", parentPid: 911803, pid: 912389 },
    ]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(911803);
  });

  it("leaves the pid unchanged when the hook was exec'd directly by claude", () => {
    // No wrapper — claude is the immediate parent and matches on the first hop.
    const lookup = fakeLookup([{ command: "claude", parentPid: 100, pid: 911803 }]);
    expect(resolveAgentSessionPid(911803, "claude", 100, lookup)).toBe(911803);
  });

  it("matches a node-wrapped claude binary by word boundary", () => {
    const lookup = fakeLookup([
      { command: "node /Users/aaron/.local/bin/claude --resume", parentPid: 100, pid: 911803 },
      { command: "/bin/sh -c python hook.py", parentPid: 911803, pid: 912389 },
    ]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(911803);
  });

  it("picks the nearest teammate, not the lead, for team setups", () => {
    // lead_claude → teammate_claude → sh -c → hook. The teammate's session
    // should report the teammate pid, not the lead, so liveness tracks the
    // teammate's actual lifetime.
    const lookup = fakeLookup([
      { command: "claude", parentPid: 100, pid: 5000 }, // lead
      { command: "claude --team-member", parentPid: 5000, pid: 6000 }, // teammate
      { command: "sh -c python hook.py", parentPid: 6000, pid: 7000 }, // wrapper
    ]);
    expect(resolveAgentSessionPid(7000, "claude", 100, lookup)).toBe(6000);
  });

  it("returns the original pid when no ancestor matches the agent binary", () => {
    const lookup = fakeLookup([
      { command: "sh", parentPid: 100, pid: 912389 },
      // Note: no claude ancestor in the chain.
    ]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(912389);
  });

  it("stops at the pane shell pid", () => {
    // Even if the pane shell's command happens to contain "claude" in argv,
    // we don't substitute it — the pane shell isn't the agent.
    const lookup = fakeLookup([
      { command: "/bin/zsh /path/with/claude/in/it", parentPid: 1, pid: 100 }, // pane shell
      { command: "sh -c python hook.py", parentPid: 100, pid: 912389 },
    ]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(912389);
  });

  it("tolerates ppid cycles defensively", () => {
    // Synthetic cycle — should not loop forever, returns original on failure.
    const lookup = fakeLookup([{ command: "sh", parentPid: 912389, pid: 912389 }]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(912389);
  });

  it("stops at pid 1 (init reparented after agent exit)", () => {
    // If the agent already exited, the wrapper sh gets reparented to init.
    // We walk to init, find no match, and return the original pid — the
    // liveness check will then correctly mark the (now-dead) wrapper ended.
    const lookup = fakeLookup([{ command: "sh", parentPid: 1, pid: 912389 }]);
    expect(resolveAgentSessionPid(912389, "claude", 100, lookup)).toBe(912389);
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

  it("keeps only the newest held permission socket per session", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: async () => true,
      persistEvents: false,
    });

    const events: AgentEvent[] = [];
    server.on("event", (event: AgentEvent) => {
      events.push(event);
    });

    let firstEndCount = 0;
    const firstSocket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {
        firstEndCount += 1;
      },
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      firstSocket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "PermissionRequest",
        pid: 900,
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-1",
        tty: "/dev/pts/7",
      }),
    );

    expect((server as any).pendingConnections.size).toBe(1);

    let secondEndCount = 0;
    const secondSocket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {
        secondEndCount += 1;
      },
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      secondSocket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "PermissionRequest",
        pid: 901,
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 2,
        toolUseId: "tool-2",
        tty: "/dev/pts/7",
      }),
    );

    expect(firstEndCount).toBe(1);
    expect(secondEndCount).toBe(0);
    expect((server as any).pendingConnections.size).toBe(1);
    expect((server as any).pendingConnectionKeysBySessionId.get("sess-1")).toBe("tool-2");
    expect(events.filter((event) => event.hookEvent === "PermissionCancelled")).toHaveLength(0);

    (server as any).handleSocketClose(firstSocket);

    expect(events.filter((event) => event.hookEvent === "PermissionCancelled")).toHaveLength(0);
  });

  it("closes a held permission socket when SessionEnd arrives for the same session", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: async () => true,
      persistEvents: false,
    });

    let endCount = 0;
    const permissionSocket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {
        endCount += 1;
      },
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      permissionSocket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "PermissionRequest",
        pid: 900,
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-1",
        tty: "/dev/pts/7",
      }),
    );

    const sessionEndSocket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      sessionEndSocket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "SessionEnd",
        pid: 901,
        sessionId: "sess-1",
        status: "ended",
        timestamp: 2,
        tty: "/dev/pts/7",
      }),
    );

    expect(endCount).toBe(1);
    expect((server as any).pendingConnections.size).toBe(0);
    expect((server as any).pendingConnectionKeysBySessionId.size).toBe(0);
  });

  it("cancelPendingPermissionsForSession hangs up a held permission socket", async () => {
    // Simulates what happens when the session-store's liveness check
    // notices the agent has exited: it tells the provider, which calls
    // through to this method, which closes the socket so the hook
    // script (blocked in recv) sees EOF and gives up instead of waiting
    // forever for a decision that will never come.
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: async () => true,
      persistEvents: false,
    });

    let endCount = 0;
    const permissionSocket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {
        endCount += 1;
      },
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      permissionSocket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "PermissionRequest",
        pid: 900,
        sessionId: "sess-orphaned",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-1",
        tty: "/dev/pts/7",
      }),
    );

    expect((server as any).pendingConnections.size).toBe(1);

    const closed = server.cancelPendingPermissionsForSession("sess-orphaned");
    expect(closed).toBe(true);
    expect(endCount).toBe(1);
    expect((server as any).pendingConnections.size).toBe(0);
    expect((server as any).pendingConnectionKeysBySessionId.size).toBe(0);

    // Idempotent: a second call for an already-cleaned session is a no-op.
    expect(server.cancelPendingPermissionsForSession("sess-orphaned")).toBe(false);
  });

  it("hands a snapshot-backed ProcessLookup to the validator when processSnapshot is supplied", async () => {
    let observedCtx: { processLookup?: unknown } | null = null;
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: (_event, ctx) => {
        observedCtx = ctx;
        return true;
      },
      persistEvents: false,
    });

    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    const snapshot = ["100 1 ? bash", "500 100 ? claude --resume", "900 500 ? sh -c python hook.py"].join("\n");

    await (server as any).processLine(
      socket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "SessionStart",
        pid: 900,
        processSnapshot: snapshot,
        sessionId: "sess-snap",
        status: "alive",
        timestamp: 1,
        tty: "/dev/pts/7",
      }),
    );

    expect(observedCtx).not.toBeNull();
    const lookup = observedCtx!.processLookup as
      | { getCommand: (pid: number) => null | string; getParentPid: (pid: number) => null | number }
      | undefined;
    expect(lookup).toBeDefined();
    expect(lookup!.getCommand(500)).toBe("claude --resume");
    expect(lookup!.getParentPid(900)).toBe(500);
  });

  it("writes the resolution line first on successful validation", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: (event) => {
        // Simulate the wrapper-shell → agent-pid substitution that the
        // real local validator performs.
        event.pid = 911803;
        return true;
      },
      persistEvents: false,
    });

    const writes: string[] = [];
    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
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
        hookEvent: "SessionStart",
        pid: 912389,
        sessionId: "sess-resolve",
        status: "alive",
        timestamp: 1,
        tty: "/dev/pts/7",
      }),
    );

    expect(writes[0]).toBe(JSON.stringify({ resolvedPid: 911803 }) + "\n");
  });

  it("writes resolution line before decision line for held permission sockets", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: () => true,
      persistEvents: false,
    });

    const writes: string[] = [];
    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
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
        sessionId: "sess-perm",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-perm",
        tty: "/dev/pts/7",
      }),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(JSON.stringify({ resolvedPid: 900 }) + "\n");

    server.respondToPermission("tool-perm", "allow");

    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe(JSON.stringify({ decision: "allow" }) + "\n");
  });

  it("skips the resolution line on the deny path", async () => {
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: () => false,
      persistEvents: false,
    });

    const writes: string[] = [];
    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
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
        sessionId: "sess-deny",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-deny",
        tty: "/dev/pts/7",
      }),
    );

    expect(writes).toEqual([JSON.stringify({ decision: "deny" }) + "\n"]);
  });

  it("passes ctx.processLookup undefined when the event omits processSnapshot", async () => {
    const observed: { hasLookup?: boolean } = {};
    const server = new HookSocketServer(join(tempDir, "honeymux", "remote-hook.sock"), true, {
      eventValidator: (_event, ctx) => {
        observed.hasLookup = ctx.processLookup !== undefined;
        return true;
      },
      persistEvents: false,
    });

    const socket = {
      data: { buffer: "", pendingWork: Promise.resolve() },
      end() {},
      flush() {},
      write(data: string) {
        return data.length;
      },
    };

    await (server as any).processLine(
      socket,
      JSON.stringify({
        agentType: "claude",
        cwd: "/srv/project",
        hookEvent: "SessionStart",
        pid: 900,
        sessionId: "sess-no-snap",
        status: "alive",
        timestamp: 1,
        tty: "/dev/pts/7",
      }),
    );

    expect(observed.hasLookup).toBe(false);
  });
});
