import { describe, expect, it } from "bun:test";

import { parseWireAgentEvent } from "./wire-event.ts";

describe("parseWireAgentEvent", () => {
  it("normalizes waitingForInput and preserves paneId for validator checks", () => {
    const event = parseWireAgentEvent({
      agentType: "claude",
      cwd: "/tmp/project",
      hookEvent: "PermissionRequest",
      isRemote: true,
      paneId: "%9",
      pid: 123,
      sessionId: "sess-1",
      sessionName: "spoofed",
      status: "waitingForInput",
      timestamp: 123.45,
      tty: "/dev/pts/9",
      windowId: "@9",
    });

    expect(event).not.toBeNull();
    expect(event?.status).toBe("alive");
    expect(event?.isRemote).toBeUndefined();
    expect(event?.paneId).toBe("%9");
    expect(event?.sessionName).toBeUndefined();
    expect(event?.windowId).toBeUndefined();
  });

  it("rejects malformed events", () => {
    expect(
      parseWireAgentEvent({
        agentType: "claude",
        cwd: "/tmp/project",
        sessionId: "",
        status: "alive",
        timestamp: 1,
      }),
    ).toBeNull();
  });
});
