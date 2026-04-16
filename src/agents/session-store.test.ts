import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "./types.ts";

import { AgentSessionStore } from "./session-store.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agentType: "claude",
    cwd: "/work",
    hookEvent: "SessionStart",
    sessionId: "test-session",
    status: "alive",
    timestamp: 1,
    ...overrides,
  };
}

describe("AgentSessionStore", () => {
  it("creates a session as alive on SessionStart", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    expect(store.getSession("test-session")?.status).toBe("alive");
    store.destroy();
  });

  it("marks session unanswered on PermissionRequest", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    store.handleEvent(
      makeEvent({
        hookEvent: "PermissionRequest",
        status: "unanswered",
        timestamp: 2,
      }),
    );
    expect(store.getSession("test-session")?.status).toBe("unanswered");
    store.destroy();
  });

  it("transitions unanswered → alive on markAnswered", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    store.handleEvent(
      makeEvent({
        hookEvent: "PermissionRequest",
        status: "unanswered",
        timestamp: 2,
      }),
    );
    store.markAnswered("test-session");
    expect(store.getSession("test-session")?.status).toBe("alive");
    store.destroy();
  });

  it("transitions unanswered → alive on PermissionCancelled", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    store.handleEvent(
      makeEvent({
        hookEvent: "PermissionRequest",
        status: "unanswered",
        timestamp: 2,
      }),
    );
    store.handleEvent(
      makeEvent({
        hookEvent: "PermissionCancelled",
        status: "alive",
        timestamp: 3,
      }),
    );
    expect(store.getSession("test-session")?.status).toBe("alive");
    store.destroy();
  });

  it("marks session ended on SessionEnd", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    store.handleEvent(makeEvent({ hookEvent: "SessionEnd", status: "ended", timestamp: 2 }));
    // ended sessions are excluded from getSessions
    expect(store.getSessions().length).toBe(0);
    store.destroy();
  });

  it("ignores ended events for unknown sessions", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent({ hookEvent: "SessionEnd", status: "ended" }));
    expect(store.getSessions().length).toBe(0);
    store.destroy();
  });

  it("markAnswered is a no-op for alive sessions", () => {
    const store = new AgentSessionStore();
    store.handleEvent(makeEvent());
    store.markAnswered("test-session");
    expect(store.getSession("test-session")?.status).toBe("alive");
    store.destroy();
  });

  it("creates session as unanswered when first event is PermissionRequest", () => {
    const store = new AgentSessionStore();
    store.handleEvent(
      makeEvent({
        hookEvent: "PermissionRequest",
        status: "unanswered",
      }),
    );
    expect(store.getSession("test-session")?.status).toBe("unanswered");
    store.destroy();
  });

  it("extracts the first real codex prompt from wrapped transcript entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hmx-session-store-"));
    tempDirs.push(dir);
    const transcriptPath = join(dir, "codex.jsonl");

    await Bun.write(
      transcriptPath,
      [
        JSON.stringify({ payload: { cwd: "/work" }, type: "session_meta" }),
        JSON.stringify({
          payload: {
            content: [
              {
                text: "# AGENTS.md instructions for /home/aaron/src/honeymux\n<INSTRUCTIONS>\n...\n</INSTRUCTIONS>",
                type: "input_text",
              },
              {
                text: "<environment_context>\n  <cwd>/home/aaron/src/honeymux</cwd>\n</environment_context>",
                type: "input_text",
              },
            ],
            role: "user",
            type: "message",
          },
          type: "response_item",
        }),
        JSON.stringify({
          payload: {
            content: [
              {
                text: "Implement busy and wait states for Codex",
                type: "input_text",
              },
            ],
            role: "user",
            type: "message",
          },
          type: "response_item",
        }),
      ].join("\n"),
    );

    const store = new AgentSessionStore();
    store.handleEvent(makeEvent({ agentType: "codex", sessionId: "codex-session", transcriptPath }));

    for (let i = 0; i < 20; i += 1) {
      const label = store.getSession("codex-session")?.conversationLabel;
      if (label) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(store.getSession("codex-session")?.conversationLabel).toBe("Implement busy and wait states for Codex");
    store.destroy();
  });

  it("never reads transcript files for remote sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hmx-session-store-"));
    tempDirs.push(dir);
    const transcriptPath = join(dir, "remote.jsonl");

    await Bun.write(
      transcriptPath,
      JSON.stringify({
        payload: {
          content: [{ text: "leak local transcript", type: "input_text" }],
          role: "user",
          type: "message",
        },
        type: "response_item",
      }),
    );

    const store = new AgentSessionStore();
    store.handleEvent(
      makeEvent({
        isRemote: true,
        sessionId: "remote-session",
        transcriptPath,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = store.getSession("remote-session");
    expect(session?.conversationLabel).toBeUndefined();
    expect(session?.isRemote).toBe(true);
    expect(session?.transcriptPath).toBe(transcriptPath);
    store.destroy();
  });

  it("detects team membership by paneId match with agentType: team-lead", () => {
    const store = new AgentSessionStore();
    // Create lead session
    store.handleEvent(makeEvent({ paneId: "%1", sessionId: "lead-uuid" }));
    // Create teammate session
    store.handleEvent(makeEvent({ paneId: "%2", sessionId: "mate-uuid" }));

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

    store.retroactivelyEnrichFromConfigs(configs);

    const lead = store.getSession("lead-uuid");
    expect(lead?.teamName).toBe("test-team");
    expect(lead?.teamRole).toBe("lead");
    expect(lead?.teammateName).toBeUndefined();

    const mate = store.getSession("mate-uuid");
    expect(mate?.teamName).toBe("test-team");
    expect(mate?.teamRole).toBe("teammate");
    expect(mate?.teammateName).toBe("mate-name");

    store.destroy();
  });

  it("detects team membership by paneId match with teamRole: lead", () => {
    const store = new AgentSessionStore();
    // Create lead session
    store.handleEvent(makeEvent({ paneId: "%1", sessionId: "lead-uuid" }));
    // Create teammate session
    store.handleEvent(makeEvent({ paneId: "%2", sessionId: "mate-uuid" }));

    const configs: Array<{
      leadSessionId: string;
      members: Array<{ agentType?: string; name: string; teamRole?: "lead" | "teammate"; tmuxPaneId?: string }>;
      name: string;
    }> = [
      {
        leadSessionId: "lead-uuid",
        members: [
          { agentType: "claude", name: "lead-name", teamRole: "lead", tmuxPaneId: "%1" },
          { agentType: "claude", name: "mate-name", teamRole: "teammate", tmuxPaneId: "%2" },
        ],
        name: "test-team",
      },
    ];

    store.retroactivelyEnrichFromConfigs(configs);

    const lead = store.getSession("lead-uuid");
    expect(lead?.teamName).toBe("test-team");
    expect(lead?.teamRole).toBe("lead");
    expect(lead?.teammateName).toBeUndefined();

    const mate = store.getSession("mate-uuid");
    expect(mate?.teamName).toBe("test-team");
    expect(mate?.teamRole).toBe("teammate");
    expect(mate?.teammateName).toBe("mate-name");

    store.destroy();
  });
});
