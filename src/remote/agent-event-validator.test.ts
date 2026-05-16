import { describe, expect, it, mock } from "bun:test";

import type { AgentEvent } from "../agents/types.ts";

import { validateRemoteAgentEvent } from "./agent-event-validator.ts";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    agentType: "claude",
    cwd: "/srv/project",
    paneId: "%77",
    pid: 900,
    sessionId: "sess-1",
    status: "alive",
    timestamp: 1,
    ...overrides,
  };
}

describe("validateRemoteAgentEvent", () => {
  it("rejects events without a paneId", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent({ paneId: undefined }), {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBindingByPaneId).not.toHaveBeenCalled();
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events without a valid pid", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent({ pid: undefined }), {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBindingByPaneId).not.toHaveBeenCalled();
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events whose paneId does not resolve to a mapped remote pane", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => undefined);
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(resolvePaneBindingByPaneId).toHaveBeenCalledWith("%77");
    expect(validateProcessBinding).not.toHaveBeenCalled();
  });

  it("rejects events whose pid is not bound to the mapped pane", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => false);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(false);
    expect(validateProcessBinding).toHaveBeenCalledWith(900, 123);
  });

  it("accepts events whose pid is bound to the mapped pane", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => true);

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(true);
    expect(validateProcessBinding).toHaveBeenCalledWith(900, 123);
  });

  it("resolves the agent pid before the remote pid-binding check (sh -c wrapper dispatch)", async () => {
    // The remote ancestry probe would reject the transient wrapper (900)
    // because `/bin/sh -c` exits as soon as the hook returns, but the
    // long-lived claude ancestor (500) is still alive. The validator
    // must resolve before validating so the SSH probe sees the
    // still-alive pid.
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (pid: number, _panePid: number) => pid === 500);

    const parents = new Map<number, number>([
      [500, 123],
      [900, 500],
    ]);
    const commands = new Map<number, string>([
      [500, "claude"],
      [900, "sh -c python hook.py"],
    ]);
    const processLookup = {
      getCommand: (pid: number) => commands.get(pid) ?? null,
      getParentPid: (pid: number) => parents.get(pid) ?? null,
      getStdinTty: () => null,
    };

    expect(
      await validateRemoteAgentEvent(makeEvent(), {
        processLookup,
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(true);
    expect(validateProcessBinding).toHaveBeenCalledWith(500, 123);
    expect(validateProcessBinding).not.toHaveBeenCalledWith(900, 123);
  });

  it("accepts the original pid when the agent exec'd the hook directly (no wrapper)", async () => {
    // Direct-exec dispatch: `event.pid` is already the long-lived agent,
    // not a wrapper shell. The snapshot lookup matches on the first hop
    // and leaves the pid unchanged. The SSH probe then runs against the
    // agent's own pid — still alive — and the event is accepted.
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (pid: number, _panePid: number) => pid === 500);

    const parents = new Map<number, number>([[500, 123]]);
    const commands = new Map<number, string>([[500, "claude"]]);
    const processLookup = {
      getCommand: (pid: number) => commands.get(pid) ?? null,
      getParentPid: (pid: number) => parents.get(pid) ?? null,
      getStdinTty: () => null,
    };

    const event = makeEvent({ pid: 500 });
    expect(
      await validateRemoteAgentEvent(event, {
        processLookup,
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(true);
    expect(event.pid).toBe(500);
    expect(validateProcessBinding).toHaveBeenCalledWith(500, 123);
  });

  it("leaves event.pid unchanged when processLookup is omitted", async () => {
    const resolvePaneBindingByPaneId = mock(async (_paneId: string) => ({
      localPaneId: "%10",
      panePid: 123,
      remotePaneId: "%77",
    }));
    const validateProcessBinding = mock(async (_pid: number, _panePid: number) => true);

    const event = makeEvent();
    expect(
      await validateRemoteAgentEvent(event, {
        resolvePaneBindingByPaneId,
        validateProcessBinding,
      }),
    ).toBe(true);
    expect(event.pid).toBe(900);
  });
});
