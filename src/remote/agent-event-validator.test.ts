import { describe, expect, it, mock } from "bun:test";

import type { AgentEvent } from "../agents/types.ts";

import { validateRemoteAgentEvent } from "./agent-event-validator.ts";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agentType: "claude",
    cwd: "/srv/project",
    pid: 900,
    sessionId: "sess-1",
    status: "alive",
    timestamp: 1,
    tty: "/dev/pts/7",
    ...overrides,
  };
}

describe("validateRemoteAgentEvent", () => {
  it("rejects events without a tty", async () => {
    const resolvePaneBinding = mock(async (_tty: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _tty: string, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent({ tty: undefined }), {
        resolvePaneBinding,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBinding).not.toHaveBeenCalled();
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events without a valid pid", async () => {
    const resolvePaneBinding = mock(async (_tty: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _tty: string, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent({ pid: undefined }), {
        resolvePaneBinding,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBinding).not.toHaveBeenCalled();
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events whose tty does not resolve to a mapped remote pane", async () => {
    const resolvePaneBinding = mock(async (_tty: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _tty: string, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBinding,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBinding).toHaveBeenCalledWith("/dev/pts/7");
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events whose pid is not bound to the mapped pane", async () => {
    const resolvePaneBinding = mock(async (_tty: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (_pid: number, _tty: string, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBinding,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(validateProcessBinding).toHaveBeenCalledWith(900, "/dev/pts/7", 123);
  });

  it("accepts events whose pid is bound to the mapped pane", async () => {
    const resolvePaneBinding = mock(async (_tty: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (_pid: number, _tty: string, _panePid: number) => true);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBinding,
        validateProcessBinding,
      }),
    ).toBe(true);
    expect(validateProcessBinding).toHaveBeenCalledWith(900, "/dev/pts/7", 123);
  });
});
