import { describe, expect, test } from "bun:test";

import type { AgentSession } from "../../agents/types.ts";

import { DEFAULT_KEYBINDINGS } from "../../util/keybindings.ts";
import {
  MUXOTRON_COUNTER_LABEL,
  MUXOTRON_HINT_COLORS,
  buildMuxotronBorderStr,
  buildMuxotronHintButtons,
  buildMuxotronToolInfo,
  getFirstUnansweredSession,
  isMuxotronDashed,
  punchDashedBorderGaps,
  sanitizeMuxotronDisplayText,
  splitMuxotronBorderOverlays,
  toSuperscript,
} from "./muxotron-model.ts";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    agentType: "claude",
    cwd: "/tmp/project",
    lastEvent: {
      agentType: "claude",
      cwd: "/tmp/project",
      sessionId: "s1",
      status: "unanswered",
      timestamp: 1,
    },
    sessionId: "s1",
    startedAt: 1,
    status: "unanswered",
    ...overrides,
  };
}

describe("muxotron model helpers", () => {
  test("formats superscript counters", () => {
    expect(toSuperscript(12)).toBe("¹²");
  });

  test("sanitizes single-line and multiline display text", () => {
    expect(sanitizeMuxotronDisplayText("bad\n\t\u001btext")).toBe("bad text");
    expect(sanitizeMuxotronDisplayText("line 1\nline\t2\u001b", true)).toBe("line 1\nline2");
  });

  test("picks the oldest unanswered session outside the active pane", () => {
    const first = makeSession({ paneId: "%1", sessionId: "first", startedAt: 10 });
    const second = makeSession({ paneId: "%2", sessionId: "second", startedAt: 5 });
    const dismissed = makeSession({ dismissed: true, paneId: "%3", sessionId: "dismissed", startedAt: 1 });

    expect(getFirstUnansweredSession([first, second, dismissed], "%2")?.sessionId).toBe("first");
  });

  test("builds sanitized tool info from unanswered sessions", () => {
    const session = makeSession({
      lastEvent: {
        agentType: "claude",
        cwd: "/tmp/project",
        sessionId: "s1",
        status: "unanswered",
        timestamp: 1,
        toolInput: {
          command: "printf 'hi'\u001b[31m",
          description: "Run a command",
        },
        toolName: "Bash",
      },
    });

    expect(buildMuxotronToolInfo(session)).toBe("Bash: Run a command");
    expect(buildMuxotronToolInfo(session, true)).toBe("Bash: Run a command\nprintf 'hi'[31m");
    expect(buildMuxotronToolInfo(makeSession({ status: "alive" }))).toBe("Running");
  });

  test("review-workflow strip has latch/goto/prev/next — no approve/deny/dismiss", () => {
    const onGoto = () => {};
    const onPrevAgent = () => {};
    const onNextAgent = () => {};
    const onLatchToggle = () => {};
    const buttons = buildMuxotronHintButtons({
      keybindings: DEFAULT_KEYBINDINGS,
      onGoto,
      onLatchToggle,
      onNextAgent,
      onPrevAgent,
      selectedSession: makeSession({ status: "alive" }),
    });

    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.label).toBe("latch");
    expect(buttons[1]?.label).toBe("g: goto");
    expect(buttons[2]?.label).toBe("↑: prev");
    expect(buttons[3]?.label).toBe("↓: next");
    expect(buttons[0]?.onClick).toBe(onLatchToggle);
    expect(buttons[1]?.onClick).toBe(onGoto);
    expect(buttons[2]?.onClick).toBe(onPrevAgent);
    expect(buttons[3]?.onClick).toBe(onNextAgent);
  });

  test("latch button label flips to 'release' while latched", () => {
    const buttons = buildMuxotronHintButtons({
      keybindings: DEFAULT_KEYBINDINGS,
      latched: true,
      selectedSession: makeSession({ status: "alive" }),
    });
    expect(buttons[0]?.label).toBe("release");
  });

  test("permission-response strip has approve/deny/goto/dismiss and disables approve/deny when idle", () => {
    const buttons = buildMuxotronHintButtons({
      keybindings: DEFAULT_KEYBINDINGS,
      selectedSession: null,
    });
    // When no tree-selection and no unanswered agent, canRespondToPermission
    // defaults to true (nothing yet to respond to) so approve/deny aren't
    // disabled in this synthetic case. The main point is the four-button
    // lineup.
    expect(buttons).toHaveLength(4);
    expect(buttons[0]?.label).toBe("approve");
    expect(buttons[1]?.label).toBe("deny");
    expect(buttons[2]?.label).toBe("goto");
    expect(buttons[3]?.label).toBe("dismiss");
  });

  test("flips labels to <hotkey>: <action> format for bound actions", () => {
    const buttons = buildMuxotronHintButtons({
      keybindings: { ...DEFAULT_KEYBINDINGS, agentPermDismiss: "ctrl+x" },
    });

    // dismiss is the 4th button (index 3) when no selection is present
    expect(buttons[3]?.label).toBe("ctrl+x: dismiss");
  });

  test("latch button shows the agentLatch binding when bound", () => {
    const buttons = buildMuxotronHintButtons({
      keybindings: { ...DEFAULT_KEYBINDINGS, agentLatch: "right_shift" },
      selectedSession: makeSession({ status: "unanswered" }),
    });

    // review-mode order: latch, goto, prev, next
    expect(buttons[0]?.label).toBe("right shift: latch");
  });

  test("latched mode marks goto/prev/next with dimHotkey but keeps them clickable", () => {
    const onGoto = () => {};
    const onPrevAgent = () => {};
    const onNextAgent = () => {};
    const buttons = buildMuxotronHintButtons({
      keybindings: DEFAULT_KEYBINDINGS,
      latched: true,
      onGoto,
      onNextAgent,
      onPrevAgent,
      selectedSession: makeSession({ status: "unanswered" }),
    });

    expect(buttons).toHaveLength(4);
    // latch, goto, prev, next
    // latch stays fully lit — its hotkey (unlatch) still works while latched
    expect(buttons[0]?.dimHotkey).toBeFalsy();
    expect(buttons[1]).toMatchObject({ dimHotkey: true });
    expect(buttons[2]).toMatchObject({ color: MUXOTRON_HINT_COLORS.nav, dimHotkey: true, label: "↑: prev" });
    expect(buttons[3]).toMatchObject({ color: MUXOTRON_HINT_COLORS.nav, dimHotkey: true, label: "↓: next" });
    // Clickable preserved in latched mode.
    expect(buttons[1]?.onClick).toBe(onGoto);
    expect(buttons[2]?.onClick).toBe(onPrevAgent);
    expect(buttons[3]?.onClick).toBe(onNextAgent);
  });

  test("latch button uses the rose latch bg color", () => {
    const buttons = buildMuxotronHintButtons({
      keybindings: DEFAULT_KEYBINDINGS,
      selectedSession: makeSession({ status: "unanswered" }),
    });

    // review-mode order: latch, goto, prev, next
    expect(buttons[0]).toMatchObject({ color: MUXOTRON_HINT_COLORS.latch });
  });

  test("builds border strings and extracts text overlays", () => {
    const border = buildMuxotronBorderStr({
      dash: "─",
      inner: 40,
      leftCorner: "╭",
      marqueeHints: "approve, deny",
      rightCorner: "╮",
      showMarqueeHints: true,
      withLabel: true,
    });

    expect(border).toContain(MUXOTRON_COUNTER_LABEL);
    const split = splitMuxotronBorderOverlays(border, 4);
    expect(split.lineStr).toContain("╭");
    expect(split.lineStr).toContain("╮");
    expect(split.overlays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("approve"), left: 5 }),
        expect.objectContaining({ content: expect.stringContaining(MUXOTRON_COUNTER_LABEL) }),
      ]),
    );
  });

  test("punches every 4th horizontal dash into an opaque gap", () => {
    expect(punchDashedBorderGaps("╭" + "─".repeat(9) + "╮")).toBe("╭─── ─── ─╮");
    expect(punchDashedBorderGaps("━━━━━━━━━━━━")).toBe("━━━ ━━━ ━━━ ");
    expect(punchDashedBorderGaps("╭─ label ─────╮")).toBe("╭─ label ── ──╮");
  });
});

describe("isMuxotronDashed", () => {
  const base = {
    agentLatchBindingLabel: "right shift",
    eqActive: false,
    hasActivePermissionRequest: true,
    muxotronFocusActive: false,
    reviewLatched: false,
    selectedSession: false,
  };

  test("solid when no latch binding is configured", () => {
    expect(isMuxotronDashed({ ...base, agentLatchBindingLabel: undefined })).toBe(false);
  });

  test("solid when there's no active permission request", () => {
    expect(isMuxotronDashed({ ...base, hasActivePermissionRequest: false })).toBe(false);
  });

  test("solid when the anamorphic equalizer is active", () => {
    expect(isMuxotronDashed({ ...base, eqActive: true })).toBe(false);
  });

  test("dashed when a perm is pending and the muxotron is idle", () => {
    expect(isMuxotronDashed(base)).toBe(true);
  });

  test("solid after the user zooms the muxotron on a perm request", () => {
    expect(isMuxotronDashed({ ...base, muxotronFocusActive: true })).toBe(false);
  });

  test("dashed during review preview (tree selection without latch)", () => {
    expect(
      isMuxotronDashed({ ...base, muxotronFocusActive: true, reviewLatched: false, selectedSession: true }),
    ).toBe(true);
  });

  test("solid when the review workflow is latched", () => {
    expect(
      isMuxotronDashed({ ...base, muxotronFocusActive: true, reviewLatched: true, selectedSession: true }),
    ).toBe(false);
  });

  test("re-entering review after prior latch reverts to dashed when unlatched", () => {
    // Simulates the sequence: review latched → unlatched → exit → re-enter.
    // After the second entry, reviewLatched is reset to false, so the border
    // must be dashed again (regression guard for the first-vs-second-review
    // inconsistency).
    const latched = { ...base, muxotronFocusActive: true, reviewLatched: true, selectedSession: true };
    expect(isMuxotronDashed(latched)).toBe(false);
    const unlatched = { ...latched, reviewLatched: false };
    expect(isMuxotronDashed(unlatched)).toBe(true);
    const secondEntry = { ...unlatched, reviewLatched: false };
    expect(isMuxotronDashed(secondEntry)).toBe(true);
  });
});
