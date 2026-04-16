import { describe, expect, test } from "bun:test";

import type { AgentSession } from "../../agents/types.ts";

import {
  computeInteractiveAgent,
  computeMuxotronExpanded,
  matchZoomActionForModifierCode,
  toggleZoomStickyConfig,
} from "./use-muxotron-focus-and-agent-selection.ts";

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agentType: "claude",
    cwd: "/tmp/proj",
    lastEvent: {
      agentType: "claude",
      cwd: "/tmp/proj",
      sessionId: "s1",
      status: "unanswered",
      timestamp: 1,
    },
    paneId: "%1",
    sessionId: "s1",
    sessionName: "tmux-1",
    startedAt: 1,
    status: "unanswered",
    windowId: "@1",
    ...overrides,
  };
}

describe("muxotron focus and agent selection helpers", () => {
  test("computes muxotron expansion from unanswered sessions and explicit selection", () => {
    const unanswered = {
      agentType: "codex",
      cwd: "/tmp",
      lastEvent: { agentType: "codex", cwd: "/tmp", sessionId: "s1", status: "unanswered", timestamp: 1 },
      paneId: "%2",
      sessionId: "s1",
      startedAt: 1,
      status: "unanswered",
    };
    expect(computeMuxotronExpanded("adaptive", [unanswered as any], "%1", null)).toBe(true);
    expect(computeMuxotronExpanded("adaptive", [unanswered as any], "%2", null)).toBe(false);
    expect(computeMuxotronExpanded("raw", [], null, unanswered as any)).toBe(true);
  });

  test("matches modifier key codes against zoom bindings", () => {
    expect(matchZoomActionForModifierCode(57447, "right_shift", "right_ctrl")).toBe("zoomAgentsView");
    expect(matchZoomActionForModifierCode(57448, "right_shift", "right_ctrl")).toBe("zoomServerView");
    expect(matchZoomActionForModifierCode(57449, "right_shift", "right_ctrl")).toBeNull();
  });

  test("toggles the correct sticky-key config flag", () => {
    const baseConfig = {
      zoomAgentsViewStickyKey: false,
      zoomServerViewStickyKey: true,
    };
    expect(toggleZoomStickyConfig(baseConfig as any, "zoomAgentsView").zoomAgentsViewStickyKey).toBe(true);
    expect(toggleZoomStickyConfig(baseConfig as any, "zoomServerView").zoomServerViewStickyKey).toBe(false);
  });

  describe("computeInteractiveAgent", () => {
    const stickyOff = { zoomAgentsView: false, zoomServerView: false };
    const stickyOn = { zoomAgentsView: true, zoomServerView: false };

    test("returns null when nothing is active", () => {
      expect(
        computeInteractiveAgent({
          activePaneId: null,
          agentSessions: [],
          muxotronFocusActive: false,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: null,
          zoomSticky: stickyOff,
        }),
      ).toBeNull();
    });

    test("tree-selected session in preview (unlatched) is not interactive", () => {
      const tree = makeAgent({ sessionId: "tree" });
      expect(
        computeInteractiveAgent({
          activePaneId: null,
          agentSessions: [],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: tree,
          zoomAction: null,
          zoomSticky: stickyOff,
        }),
      ).toBeNull();
    });

    test("tree-selected session becomes interactive once latched", () => {
      const tree = makeAgent({ sessionId: "tree" });
      expect(
        computeInteractiveAgent({
          activePaneId: null,
          agentSessions: [],
          muxotronFocusActive: true,
          reviewLatched: true,
          treeSelectedSession: tree,
          zoomAction: null,
          zoomSticky: stickyOff,
        })?.sessionId,
      ).toBe("tree");
    });

    test("non-sticky held-key zoom is read-only (returns null)", () => {
      const agent = makeAgent({ sessionId: "u1" });
      expect(
        computeInteractiveAgent({
          activePaneId: "%2",
          agentSessions: [agent],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: "zoomAgentsView",
          zoomSticky: stickyOff,
        }),
      ).toBeNull();
    });

    test("sticky-latched zoom picks the oldest unanswered agent outside the active pane", () => {
      const newer = makeAgent({ paneId: "%5", sessionId: "newer", startedAt: 50 });
      const older = makeAgent({ paneId: "%6", sessionId: "older", startedAt: 10 });
      expect(
        computeInteractiveAgent({
          activePaneId: "%2",
          agentSessions: [newer, older],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: "zoomAgentsView",
          zoomSticky: stickyOn,
        })?.sessionId,
      ).toBe("older");
    });

    test("sticky-latched zoom with null zoomAction (muxotron auto-expanded) still latches interactive", () => {
      const unanswered = makeAgent({ paneId: "%5", sessionId: "waiting", startedAt: 10 });
      expect(
        computeInteractiveAgent({
          activePaneId: "%2",
          agentSessions: [unanswered],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: null,
          zoomSticky: stickyOn,
        })?.sessionId,
      ).toBe("waiting");
    });

    test("sticky-latched zoom falls back to a live agent when no unanswered prompt exists", () => {
      const alive = makeAgent({ paneId: "%5", sessionId: "alive", startedAt: 10, status: "alive" });
      expect(
        computeInteractiveAgent({
          activePaneId: "%2",
          agentSessions: [alive],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: "zoomAgentsView",
          zoomSticky: stickyOn,
        })?.sessionId,
      ).toBe("alive");
    });

    test("sticky-latched zoom prefers an unanswered agent over a live one", () => {
      const alive = makeAgent({ paneId: "%5", sessionId: "alive", startedAt: 5, status: "alive" });
      const unanswered = makeAgent({ paneId: "%6", sessionId: "waiting", startedAt: 50 });
      expect(
        computeInteractiveAgent({
          activePaneId: "%2",
          agentSessions: [alive, unanswered],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: "zoomAgentsView",
          zoomSticky: stickyOn,
        })?.sessionId,
      ).toBe("waiting");
    });

    test("sticky-latched zoom on the server view never goes interactive", () => {
      expect(
        computeInteractiveAgent({
          activePaneId: null,
          agentSessions: [makeAgent()],
          muxotronFocusActive: true,
          reviewLatched: false,
          treeSelectedSession: null,
          zoomAction: "zoomServerView",
          zoomSticky: { zoomAgentsView: true, zoomServerView: true },
        }),
      ).toBeNull();
    });

    test("rejects candidates missing pane/window/session metadata", () => {
      const partial = makeAgent({ paneId: undefined, sessionId: "no-pane" });
      expect(
        computeInteractiveAgent({
          activePaneId: null,
          agentSessions: [],
          muxotronFocusActive: true,
          reviewLatched: true,
          treeSelectedSession: partial,
          zoomAction: null,
          zoomSticky: stickyOff,
        }),
      ).toBeNull();
    });
  });
});
