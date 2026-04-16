import { describe, expect, it } from "bun:test";

import type { AgentEvent, AgentSession } from "../agents/types.ts";

import { buildAgentTreeRows } from "./agent-tree.tsx";

function makeSession(overrides: { sessionId: string } & Partial<AgentSession>): AgentSession {
  return {
    agentType: "claude",
    conversationLabel: "test prompt",
    cwd: "/home/user/src",
    lastEvent: { pid: 1234 } as AgentEvent,
    startedAt: Date.now(),
    status: "alive",
    ...overrides,
  };
}

describe("buildAgentTreeRows", () => {
  it("returns only root for empty sessions", () => {
    const rows = buildAgentTreeRows([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("root");
    expect(rows[0]!.label).toBe("\u2299");
  });

  it("builds a single standalone agent", () => {
    const sessions = [makeSession({ conversationLabel: "fix bug", sessionId: "aaaa-bbbb-cccc" })];
    const rows = buildAgentTreeRows(sessions);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe("root");
    expect(rows[1]!.type).toBe("session");
    expect(rows[1]!.label).toContain("claude");
    expect(rows[1]!.label).not.toContain("fix bug");
    expect(rows[1]!.prompt).toBe("fix bug");
    expect(rows[1]!.sid).toBe("aaaa");
    expect(rows[1]!.prefix).toBe("\u2514\u2500 "); // last item: └─
  });

  it("builds multiple standalone agents with correct connectors", () => {
    const sessions = [
      makeSession({ agentType: "claude", conversationLabel: "task A", sessionId: "aaa-1", startedAt: 100 }),
      makeSession({ agentType: "opencode", conversationLabel: "task B", sessionId: "bbb-2", startedAt: 200 }),
      makeSession({ agentType: "gemini", conversationLabel: "task C", sessionId: "ccc-3", startedAt: 300 }),
    ];
    const rows = buildAgentTreeRows(sessions);
    expect(rows).toHaveLength(4); // root + 3 sessions
    expect(rows[1]!.prefix).toBe("\u251C\u2500 "); // ├─
    expect(rows[2]!.prefix).toBe("\u251C\u2500 "); // ├─
    expect(rows[3]!.prefix).toBe("\u2514\u2500 "); // └─ (last)
    expect(rows[1]!.label).toContain("claude");
    expect(rows[2]!.label).toContain("opencode");
    expect(rows[3]!.label).toContain("gemini");
  });

  it("builds a team with lead and teammates", () => {
    const sessions = [
      makeSession({
        conversationLabel: "coordinate",
        sessionId: "lead-1",
        startedAt: 100,
        teamName: "my-team",
        teamRole: "lead",
      }),
      makeSession({
        conversationLabel: "find docs",
        sessionId: "mate-1",
        startedAt: 200,
        teamName: "my-team",
        teamRole: "teammate",
        teammateName: "researcher",
      }),
      makeSession({
        conversationLabel: "write code",
        sessionId: "mate-2",
        startedAt: 300,
        teamName: "my-team",
        teamRole: "teammate",
        teammateName: "coder",
      }),
    ];
    const rows = buildAgentTreeRows(sessions);
    // root + lead + 2 teammates = 4
    expect(rows).toHaveLength(4);
    expect(rows[1]!.type).toBe("session"); // lead
    expect(rows[1]!.label).toContain("my-team");
    expect(rows[1]!.label).toContain("3 agents");
    expect(rows[1]!.prefix).toBe("\u2514\u2500 "); // last group
    expect(rows[2]!.type).toBe("teammate");
    expect(rows[2]!.label).toContain("researcher");
    expect(rows[2]!.label).not.toContain("find docs");
    expect(rows[2]!.prompt).toBe("find docs");
    expect(rows[2]!.prefix).toBe("   \u251C\u2500 "); // continuation + ├─
    expect(rows[3]!.type).toBe("teammate");
    expect(rows[3]!.label).toContain("coder");
    expect(rows[3]!.prompt).toBe("write code");
    expect(rows[3]!.prefix).toBe("   \u2514\u2500 "); // continuation + └─
  });

  it("sorts unanswered agents to the top", () => {
    const sessions = [
      makeSession({ conversationLabel: "running", sessionId: "alive-1", startedAt: 100, status: "alive" }),
      makeSession({
        conversationLabel: "needs input",
        sessionId: "waiting-1",
        startedAt: 200,
        status: "unanswered",
      }),
    ];
    const rows = buildAgentTreeRows(sessions);
    expect(rows).toHaveLength(3);
    // Unanswered should be first (after root)
    expect(rows[1]!.session?.sessionId).toBe("waiting-1");
    expect(rows[1]!.active).toBe(true);
    expect(rows[2]!.session?.sessionId).toBe("alive-1");
    expect(rows[2]!.active).toBe(false);
  });

  it("filters out ended sessions", () => {
    const sessions = [
      makeSession({ conversationLabel: "running", sessionId: "alive-1", status: "alive" }),
      makeSession({ conversationLabel: "done", sessionId: "ended-1", status: "ended" }),
    ];
    const rows = buildAgentTreeRows(sessions);
    expect(rows).toHaveLength(2); // root + 1 alive
    expect(rows[1]!.session?.sessionId).toBe("alive-1");
  });

  it("mixed standalone and team sessions", () => {
    const sessions = [
      makeSession({ conversationLabel: "solo task", sessionId: "solo-1", startedAt: 100 }),
      makeSession({
        conversationLabel: "lead task",
        sessionId: "lead-1",
        startedAt: 200,
        teamName: "builders",
        teamRole: "lead",
      }),
      makeSession({
        conversationLabel: "sub task",
        sessionId: "mate-1",
        startedAt: 300,
        teamName: "builders",
        teamRole: "teammate",
        teammateName: "worker",
      }),
    ];
    const rows = buildAgentTreeRows(sessions);
    // root + solo + lead + teammate = 4
    expect(rows).toHaveLength(4);
    expect(rows[1]!.type).toBe("session"); // solo
    expect(rows[1]!.prefix).toBe("\u251C\u2500 "); // not last
    expect(rows[2]!.type).toBe("session"); // lead
    expect(rows[2]!.prefix).toBe("\u2514\u2500 "); // last group
    expect(rows[3]!.type).toBe("teammate");
  });

  it("includes cwd and pid from session data", () => {
    const home = process.env.HOME ?? "";
    const sessions = [
      makeSession({
        cwd: `${home}/project`,
        lastEvent: { pid: 9876 } as AgentEvent,
        sessionId: "abc-def",
      }),
    ];
    const rows = buildAgentTreeRows(sessions);
    expect(rows[1]!.cwd).toBe("~/project");
    expect(rows[1]!.pid).toBe(9876);
  });

  it("sanitizes cwd before rendering tree rows", () => {
    const sessions = [
      makeSession({
        cwd: "/tmp/\nproject\t\x1b[31mname\x1b[0m",
        isRemote: true,
        remoteHost: "example-host",
        sessionId: "abc-def",
      }),
    ];
    const rows = buildAgentTreeRows(sessions);
    expect(rows[1]!.cwd).toBe("/tmp/projectname");
  });
});
