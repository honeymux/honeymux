import { describe, expect, mock, test } from "bun:test";

import type { AgentSession } from "../../agents/types.ts";

import {
  completeReviewGoto,
  getDismissTargetSession,
  getPaneBorderMenuAnchor,
  getTargetOrFirstWaitingSession,
} from "./use-app-runtime-shortcuts.ts";

function session(overrides: Partial<AgentSession>): AgentSession {
  return {
    agentType: overrides.agentType ?? "codex",
    cwd: overrides.cwd ?? "/tmp",
    dismissed: overrides.dismissed,
    lastEvent:
      overrides.lastEvent ??
      ({
        agentType: overrides.agentType ?? "codex",
        cwd: overrides.cwd ?? "/tmp",
        sessionId: overrides.sessionId ?? "sess-1",
        status: overrides.status ?? "unanswered",
        timestamp: overrides.startedAt ?? 1,
      } as AgentSession["lastEvent"]),
    paneId: overrides.paneId,
    sessionId: overrides.sessionId ?? "sess-1",
    sessionName: overrides.sessionName,
    startedAt: overrides.startedAt ?? 1,
    status: overrides.status ?? "unanswered",
    windowId: overrides.windowId,
  };
}

describe("app runtime shortcut helpers", () => {
  test("prefers the selected session, otherwise the earliest unanswered session", () => {
    const earliest = session({ sessionId: "a", startedAt: 1 });
    const later = session({ sessionId: "b", startedAt: 2 });
    const selected = session({ sessionId: "selected", startedAt: 5 });

    expect(getTargetOrFirstWaitingSession(selected, [later, earliest])?.sessionId).toBe("selected");
    expect(getTargetOrFirstWaitingSession(null, [later, earliest])?.sessionId).toBe("a");
  });

  test("dismiss target skips dismissed unanswered sessions", () => {
    const dismissed = session({ dismissed: true, sessionId: "dismissed", startedAt: 1 });
    const live = session({ sessionId: "live", startedAt: 2 });

    expect(getDismissTargetSession(null, [live, dismissed])?.sessionId).toBe("live");
  });

  test("computes the pane-border menu anchor from pane geometry and sidebar offset", () => {
    expect(getPaneBorderMenuAnchor({ left: 10, top: 4, width: 20 }, false, 32)).toEqual({
      screenX: 29,
      screenY: 7,
    });
    expect(getPaneBorderMenuAnchor({ left: 10, top: 4, width: 20 }, true, 32)).toEqual({
      screenX: 62,
      screenY: 7,
    });
  });

  test("completeReviewGoto waits for the target pane before tearing down review state", async () => {
    const events: string[] = [];
    const activePaneIdRef = { current: "%1" };
    const dropdownInputRef = { current: (() => false) as ((data: string) => boolean) | null };

    await completeReviewGoto({
      activePaneIdRef,
      clearTreeSelectedSession: () => {
        events.push("clear");
      },
      dropdownInputRef,
      handleGoToPane: mock((_session: AgentSession) => {
        events.push("goto");
        setTimeout(() => {
          activePaneIdRef.current = "%2";
          events.push("focused");
        }, 5);
      }),
      handleSidebarCancel: () => {
        events.push("sidebar");
      },
      handleToolbarCancel: () => {
        events.push("toolbar");
      },
      handleZoomEnd: () => {
        events.push("zoom");
      },
      paneFocusPollMs: 1,
      paneFocusTimeoutMs: 50,
      session: session({ paneId: "%2", sessionId: "target" }),
      setAgentsDialogOpen: ((open: boolean) => {
        events.push(`dialog:${String(open)}`);
      }) as any,
    });

    expect(events).toEqual(["goto", "focused", "zoom", "dialog:false", "clear", "sidebar", "toolbar"]);
    expect(dropdownInputRef.current).toBeNull();
  });

  test("completeReviewGoto still tears down if the target pane never becomes active", async () => {
    const events: string[] = [];
    const activePaneIdRef = { current: "%1" };
    const dropdownInputRef = { current: (() => false) as ((data: string) => boolean) | null };

    await completeReviewGoto({
      activePaneIdRef,
      clearTreeSelectedSession: () => {
        events.push("clear");
      },
      dropdownInputRef,
      handleGoToPane: mock((_session: AgentSession) => {
        events.push("goto");
      }),
      handleZoomEnd: () => {
        events.push("zoom");
      },
      paneFocusPollMs: 1,
      paneFocusTimeoutMs: 5,
      session: session({ paneId: "%2", sessionId: "target" }),
      setAgentsDialogOpen: ((open: boolean) => {
        events.push(`dialog:${String(open)}`);
      }) as any,
    });

    expect(events).toEqual(["goto", "zoom", "dialog:false", "clear", "goto"]);
    expect(dropdownInputRef.current).toBeNull();
  });

  test("completeReviewGoto retries goto if teardown snaps focus back to the previous pane", async () => {
    const events: string[] = [];
    const activePaneIdRef = { current: "%1" };
    const dropdownInputRef = { current: (() => false) as ((data: string) => boolean) | null };
    let gotoCalls = 0;

    await completeReviewGoto({
      activePaneIdRef,
      clearTreeSelectedSession: () => {
        events.push("clear");
      },
      dropdownInputRef,
      handleGoToPane: mock((_session: AgentSession) => {
        gotoCalls += 1;
        events.push(`goto:${gotoCalls}`);
        setTimeout(() => {
          activePaneIdRef.current = "%2";
          events.push(`focused:${gotoCalls}`);
        }, 5);
      }),
      handleZoomEnd: () => {
        activePaneIdRef.current = "%1";
        events.push("zoom");
      },
      paneFocusPollMs: 1,
      paneFocusTimeoutMs: 50,
      postTeardownSettleMs: 1,
      retryPaneFocusTimeoutMs: 50,
      session: session({ paneId: "%2", sessionId: "target" }),
      setAgentsDialogOpen: ((open: boolean) => {
        events.push(`dialog:${String(open)}`);
      }) as any,
    });

    expect(gotoCalls).toBe(2);
    expect(activePaneIdRef.current).toBe("%2");
    expect(events).toEqual(["goto:1", "focused:1", "zoom", "dialog:false", "clear", "goto:2", "focused:2"]);
    expect(dropdownInputRef.current).toBeNull();
  });
});
