import { describe, expect, it } from "bun:test";

import type { AgentEvent } from "../types.ts";

import { TeamService } from "./team-service.ts";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agentType: "claude",
    cwd: "/work",
    sessionId: "test-session",
    status: "alive",
    timestamp: 1,
    ...overrides,
  };
}

describe("TeamService", () => {
  it("enriches event with team info from event fields directly", () => {
    const service = new TeamService();
    const event = makeEvent({
      teamName: "my-team",
      teammateName: "colleague",
    });

    service.enrichEvent(event);

    expect(event.teamName).toBe("my-team");
    expect(event.teamRole).toBe("teammate");
    expect(event.teammateName).toBe("colleague");
  });

  it("caches team info from previous events", () => {
    const service = new TeamService();
    const event1 = makeEvent({
      sessionId: "session-1",
      teamName: "my-team",
      teammateName: "colleague",
    });
    const event2 = makeEvent({
      sessionId: "session-1",
      // No team info in this event
    });

    service.enrichEvent(event1);
    service.enrichEvent(event2);

    expect(event2.teamName).toBe("my-team");
    expect(event2.teamRole).toBe("teammate");
    expect(event2.teammateName).toBe("colleague");
  });

  it("detects team membership by paneId match with agentType: team-lead", () => {
    const service = new TeamService();
    // Simulate config discovery
    const configs = [
      {
        leadSessionId: "lead-uuid",
        members: [
          { agentId: "lead@test-team", agentType: "team-lead", name: "lead-name", tmuxPaneId: "%1" },
          { agentId: "mate@test-team", agentType: "claude", name: "mate-name", tmuxPaneId: "%2" },
        ],
        name: "test-team",
      },
    ];

    // Manually set configs (normally done via poll)
    (service as any).configs = new Map([["test-team", configs[0]]]);

    const leadEvent = makeEvent({ paneId: "%1", sessionId: "lead-uuid" });
    const mateEvent = makeEvent({ paneId: "%2", sessionId: "mate-uuid" });

    service.enrichEvent(leadEvent);
    service.enrichEvent(mateEvent);

    expect(leadEvent.teamName).toBe("test-team");
    expect(leadEvent.teamRole).toBe("lead");
    expect(leadEvent.teammateName).toBeUndefined();

    expect(mateEvent.teamName).toBe("test-team");
    expect(mateEvent.teamRole).toBe("teammate");
    expect(mateEvent.teammateName).toBe("mate-name");
  });

  it("detects team membership by paneId match with teamRole: lead", () => {
    const service = new TeamService();
    // Simulate config with teamRole field
    const configs = [
      {
        leadSessionId: "lead-uuid",
        members: [
          { agentId: "lead@test-team", agentType: "claude", name: "lead-name", teamRole: "lead", tmuxPaneId: "%1" },
          { agentId: "mate@test-team", agentType: "claude", name: "mate-name", teamRole: "teammate", tmuxPaneId: "%2" },
        ],
        name: "test-team",
      },
    ];

    (service as any).configs = new Map([["test-team", configs[0]]]);

    const leadEvent = makeEvent({ paneId: "%1", sessionId: "lead-uuid" });
    const mateEvent = makeEvent({ paneId: "%2", sessionId: "mate-uuid" });

    service.enrichEvent(leadEvent);
    service.enrichEvent(mateEvent);

    expect(leadEvent.teamName).toBe("test-team");
    expect(leadEvent.teamRole).toBe("lead");
    expect(leadEvent.teammateName).toBeUndefined();

    expect(mateEvent.teamName).toBe("test-team");
    expect(mateEvent.teamRole).toBe("teammate");
    expect(mateEvent.teammateName).toBe("mate-name");
  });

  it("detects lead by leadSessionId match", () => {
    const service = new TeamService();
    const configs = [
      {
        leadSessionId: "lead-uuid",
        members: [{ agentId: "lead@test-team", agentType: "team-lead", name: "lead-name" }],
        name: "test-team",
      },
    ];

    (service as any).configs = new Map([["test-team", configs[0]]]);

    const leadEvent = makeEvent({ sessionId: "lead-uuid" });

    service.enrichEvent(leadEvent);

    expect(leadEvent.teamName).toBe("test-team");
    expect(leadEvent.teamRole).toBe("lead");
    expect(leadEvent.teammateName).toBeUndefined();
  });
});
