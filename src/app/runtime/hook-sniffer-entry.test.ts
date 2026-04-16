import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "../../agents/types.ts";

import { buildHookSnifferEntry } from "./hook-sniffer-entry.ts";

describe("buildHookSnifferEntry", () => {
  test("strips control characters from rendered hook sniffer fields", () => {
    const entry = buildHookSnifferEntry({
      agentType: "claude",
      cwd: "/tmp",
      hookEvent: "Permi\tsion\nRequest",
      pid: 123,
      sessionId: "sess-\u001b42",
      status: "unanswered",
      timestamp: 1,
      toolInput: { command: "printf hi" },
      toolName: "Ba\u0007sh\rTool",
    } satisfies AgentEvent);

    expect(entry).toEqual({
      agentType: "claude",
      hookEvent: "PermisionRequest",
      pid: 123,
      sessionId: "sess-42",
      status: "unanswered",
      timestamp: 1,
      toolInput: { command: "printf hi" },
      toolName: "BashTool",
    });
  });

  test("falls back when hook event sanitizes to empty", () => {
    const entry = buildHookSnifferEntry({
      agentType: "gemini",
      cwd: "/tmp",
      hookEvent: "\u0007\r\n",
      sessionId: "\u0000sess-1",
      status: "alive",
      timestamp: 1,
    } satisfies AgentEvent);

    expect(entry.hookEvent).toBe("alive");
    expect(entry.sessionId).toBe("sess-1");
    expect(entry.toolName).toBeUndefined();
  });
});
