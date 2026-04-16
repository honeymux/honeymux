import { describe, expect, test } from "bun:test";

import type { AgentSession } from "../../agents/types.ts";
import type { HoneymuxConfig } from "../../util/config.ts";

import { defaultConfig } from "../../util/config.ts";
import {
  applyTerminalCursorVisibility,
  getUnansweredCount,
  getWatermarkState,
  hasFavoriteLayoutProfile,
  shouldShowTerminalCursor,
} from "./use-app-overlay-model.tsx";

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

describe("app overlay model helpers", () => {
  test("counts unanswered sessions outside the active pane", () => {
    expect(
      getUnansweredCount(
        [
          session({ paneId: "%1", sessionId: "a", status: "unanswered" }),
          session({ paneId: "%2", sessionId: "b", status: "unanswered" }),
          session({ paneId: "%3", sessionId: "c", status: "alive" }),
        ],
        "%2",
      ),
    ).toBe(1);
  });

  test("derives watermark state from config and options focus", () => {
    const config: HoneymuxConfig = { ...defaultConfig(), agentAlertWatermark: "bear face" };
    expect(
      getWatermarkState({
        config,
        configAgentAlertWatermark: "off",
        optionsDialogOpen: false,
        optionsDialogRow: 0,
        optionsDialogTab: "general",
        unansweredCount: 0,
      }),
    ).toEqual({
      enabled: true,
      previewFocused: false,
      shape: "bear face",
      showInRootOverlay: false,
    });

    expect(
      getWatermarkState({
        config,
        configAgentAlertWatermark: "bear paw",
        optionsDialogOpen: true,
        optionsDialogRow: 5,
        optionsDialogTab: "agents",
        unansweredCount: 0,
      }),
    ).toEqual({
      enabled: true,
      previewFocused: true,
      shape: "bear paw",
      showInRootOverlay: true,
    });
  });

  test("detects favorite layout profiles for overlay state", () => {
    expect(hasFavoriteLayoutProfile([{ favorite: false, layout: "", name: "alpha", paneCount: 1, savedAt: 1 }])).toBe(
      false,
    );
    expect(hasFavoriteLayoutProfile([{ favorite: true, layout: "", name: "beta", paneCount: 1, savedAt: 1 }])).toBe(
      true,
    );
  });

  test("hides the terminal cursor while dialogs or zoom overlays own focus", () => {
    expect(
      shouldShowTerminalCursor({
        dialogOpen: true,
        interactiveAgent: null,
        muxotronFocusActive: false,
        tooSmallForUse: false,
      }),
    ).toBe(false);
    expect(
      shouldShowTerminalCursor({
        dialogOpen: false,
        interactiveAgent: session({ sessionId: "overlay" }),
        muxotronFocusActive: false,
        tooSmallForUse: false,
      }),
    ).toBe(false);
    expect(
      shouldShowTerminalCursor({
        dialogOpen: false,
        interactiveAgent: null,
        muxotronFocusActive: true,
        tooSmallForUse: false,
      }),
    ).toBe(false);
  });

  test("applies hidden cursor state to a newly ready terminal while a dialog is open", () => {
    const terminal: { showCursor: boolean } = { showCursor: true };
    applyTerminalCursorVisibility(terminal, {
      dialogOpen: true,
      interactiveAgent: null,
      muxotronFocusActive: false,
      tooSmallForUse: false,
    });
    expect(terminal.showCursor).toBe(false);
  });

  test("shows the terminal cursor when no other UI owner is active", () => {
    const terminal: { showCursor: boolean } = { showCursor: false };
    applyTerminalCursorVisibility(terminal, {
      dialogOpen: false,
      interactiveAgent: null,
      muxotronFocusActive: false,
      tooSmallForUse: false,
    });
    expect(terminal.showCursor).toBe(true);
  });
});
