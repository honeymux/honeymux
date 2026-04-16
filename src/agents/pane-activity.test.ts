import { describe, expect, test } from "bun:test";

import type { AgentSession } from "./types.ts";

import {
  computeDesiredAuxSessionNames,
  getCodingAgentPaneActivity,
  getConnectedCodingAgentPaneIds,
  getLatestCodingAgentPaneOutput,
  getLatestCodingAgentPaneOutputAt,
  pruneCodingAgentPaneActivity,
} from "./pane-activity.ts";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agentType: overrides.agentType ?? "codex",
    cwd: overrides.cwd ?? "/tmp",
    lastEvent:
      overrides.lastEvent ??
      ({
        agentType: overrides.agentType ?? "codex",
        cwd: overrides.cwd ?? "/tmp",
        sessionId: overrides.sessionId ?? "s1",
        status: overrides.status ?? "alive",
        timestamp: overrides.startedAt ?? 1,
      } as AgentSession["lastEvent"]),
    paneId: overrides.paneId,
    sessionId: overrides.sessionId ?? "s1",
    sessionName: overrides.sessionName,
    startedAt: overrides.startedAt ?? 1,
    status: overrides.status ?? "alive",
  };
}

describe("coding agent pane activity helpers", () => {
  test("collects pane ids only for non-ended sessions with a pane", () => {
    const paneIds = getConnectedCodingAgentPaneIds([
      session({ paneId: "%1", sessionId: "a" }),
      session({ paneId: "%2", sessionId: "b" }),
      session({ paneId: "%3", sessionId: "c", status: "ended" }),
      session({ paneId: undefined, sessionId: "d" }),
    ]);

    expect([...paneIds]).toEqual(["%1", "%2"]);
  });

  test("prunes stale pane activity for panes that no longer host agents", () => {
    const pruned = pruneCodingAgentPaneActivity(
      new Map([
        ["%1", { at: 10, tickAt: 100 }],
        ["%2", { at: 20, tickAt: 200 }],
        ["%3", { at: 30, tickAt: 300 }],
      ]),
      new Set(["%1", "%3"]),
    );

    expect([...pruned.entries()]).toEqual([
      ["%1", { at: 10, tickAt: 100 }],
      ["%3", { at: 30, tickAt: 300 }],
    ]);
  });

  test("uses the newest monotonic output sample across connected agent panes", () => {
    expect(
      getLatestCodingAgentPaneOutput(
        new Map([
          ["%1", { at: 100, tickAt: 1000 }],
          ["%2", { at: 200, tickAt: 2000 }],
          ["%3", { at: 150, tickAt: 1500 }],
        ]),
        new Set(["%1", "%3"]),
      ),
    ).toEqual({ at: 150, tickAt: 1500 });

    expect(
      getLatestCodingAgentPaneOutputAt(
        new Map([
          ["%1", { at: 100, tickAt: 1000 }],
          ["%2", { at: 200, tickAt: 2000 }],
          ["%3", { at: 150, tickAt: 1500 }],
        ]),
        new Set(["%1", "%3"]),
      ),
    ).toBe(150);
  });

  test("reports hidden activity when no connected agent panes remain", () => {
    expect(getCodingAgentPaneActivity(new Map([["%1", { at: 100, tickAt: 1000 }]]), new Set())).toEqual({
      hasConnectedAgent: false,
      lastOutputAt: null,
      lastOutputTickAt: null,
    });
  });
});

describe("computeDesiredAuxSessionNames", () => {
  test("includes non-primary sessions that host a live agent", () => {
    const result = computeDesiredAuxSessionNames(
      [
        session({ paneId: "%1", sessionId: "a", sessionName: "work" }),
        session({ paneId: "%2", sessionId: "b", sessionName: "side" }),
      ],
      "main",
    );
    expect([...result].sort()).toEqual(["side", "work"]);
  });

  test("excludes the primary session (its pane-output already flows through the primary client)", () => {
    const result = computeDesiredAuxSessionNames(
      [
        session({ paneId: "%1", sessionId: "a", sessionName: "main" }),
        session({ paneId: "%2", sessionId: "b", sessionName: "side" }),
      ],
      "main",
    );
    expect([...result]).toEqual(["side"]);
  });

  test("excludes ended sessions, sessions without a paneId, and sessions without a sessionName", () => {
    const result = computeDesiredAuxSessionNames(
      [
        session({ paneId: "%1", sessionId: "a", sessionName: "alive" }),
        session({ paneId: "%2", sessionId: "b", sessionName: "dead", status: "ended" }),
        session({ paneId: undefined, sessionId: "c", sessionName: "panicless" }),
        session({ paneId: "%4", sessionId: "d", sessionName: undefined }),
      ],
      "main",
    );
    expect([...result]).toEqual(["alive"]);
  });

  test("deduplicates when multiple agents live in the same tmux session", () => {
    const result = computeDesiredAuxSessionNames(
      [
        session({ paneId: "%1", sessionId: "a", sessionName: "shared" }),
        session({ paneId: "%2", sessionId: "b", sessionName: "shared" }),
      ],
      "main",
    );
    expect([...result]).toEqual(["shared"]);
  });

  test("returns every live agent session when there is no primary (disconnected state)", () => {
    const result = computeDesiredAuxSessionNames(
      [session({ paneId: "%1", sessionId: "a", sessionName: "work" })],
      null,
    );
    expect([...result]).toEqual(["work"]);
  });
});
