/**
 * Harness-only hooks. Activated solely when `process.env.HMX_HARNESS === "1"`,
 * which is set by `scripts/docs-screenshots.ts` when launching honeymux for
 * documentation screenshots. Every code path here must compile out to a no-op
 * effect when the env var is absent so production behavior is unaffected.
 *
 * Inputs are read from environment variables so the harness driving honeymux
 * can request small bits of state (info items, the pane border menu) without
 * needing IPC.
 *
 * Recognized env vars:
 *
 *   HMX_HARNESS=1                       — master switch
 *   HMX_HARNESS_INFO=<message>          — seed an info item; "|" separates lines
 *   HMX_HARNESS_WARNING=<message>       — seed a warning notification (uses the
 *                                         info path tagged with "warning-" so it
 *                                         appears in the same review frame)
 *   HMX_HARNESS_OPEN_NOTIFICATIONS=1    — auto-trigger the notifications click
 *                                         after a short delay
 *   HMX_HARNESS_OPEN_PANE_BORDER_MENU=1 — auto-open the pane border menu on the
 *                                         active pane after a short delay
 *   HMX_HARNESS_AGENT_WAITING=<label>   — inject one synthetic unanswered agent
 *                                         into the session list so the
 *                                         Mux-o-Tron auto-expands. Value is used
 *                                         as the displayed tool summary, e.g.
 *                                         "Edit: src/components/example.tsx".
 *   HMX_HARNESS_AGENT_ALIVE=<cwd>       — inject one synthetic alive (non-
 *                                         unanswered) agent so the Mux-o-Tron
 *                                         shows "000/001" in its collapsed
 *                                         shape. Value is the agent's working
 *                                         directory label.
 *   HMX_HARNESS_MUXOTRON_REVIEW=1       — after the synthetic agent is seeded,
 *                                         enter review mode on it (treeAgent-
 *                                         Select) without toggling the latch.
 *                                         The muxotron renders the review-
 *                                         workflow button strip with live
 *                                         (non-dimmed) hotkey prefixes.
 *   HMX_HARNESS_MUXOTRON_LATCH=1        — after the synthetic agent is seeded,
 *                                         enter review mode on it and toggle
 *                                         the latch on, so the muxotron renders
 *                                         the review-workflow button strip
 *                                         with dimmed hotkey prefixes (the
 *                                         agent PTY owns the keyboard).
 *   HMX_HARNESS_MUXOTRON_FOCUS_PERM=1   — after the synthetic agent is seeded,
 *                                         trigger the perm-request latch
 *                                         (handleAgentLatch with no tree
 *                                         selection), flipping muxotronFocus
 *                                         active so the muxotron renders the
 *                                         approve/deny/goto/dismiss strip with
 *                                         a solid border and the bridged agent
 *                                         PTY inside.
 *   HMX_HARNESS_AGENT_PANE_ID=<id>      — override the synthetic session's
 *   HMX_HARNESS_AGENT_WINDOW_ID=<id>      paneId/windowId so the bridged PTY
 *   HMX_HARNESS_AGENT_SESSION_NAME=<n>    attaches to a real tmux window/pane
 *                                         (e.g. a harness-seeded window that
 *                                         prints a fake permission dialog
 *                                         instead of the workspace shell).
 *   HMX_HARNESS_RENAME_PANE_TABS=<pfx>  — rename every pane-tab in every group
 *                                         to `${pfx}${index+1}`. The helper
 *                                         polls until every group has at
 *                                         least HMX_HARNESS_RENAME_PANE_TABS_
 *                                         MIN_TABS tabs and the count stops
 *                                         changing before renaming, so the
 *                                         harness can finish creating tabs
 *                                         asynchronously via keystrokes
 *                                         before the rename fires.
 *   HMX_HARNESS_RENAME_PANE_TABS_MIN_TABS=<n>
 *                                       — paired with the above: require at
 *                                         least `n` tabs in every group
 *                                         before the rename fires. Defaults
 *                                         to 1.
 */
import type { MutableRefObject } from "react";

import { useEffect } from "react";

import type { AgentEvent, AgentSession } from "../../agents/types.ts";

interface UseHarnessHooksOptions {
  addInfoRef: MutableRefObject<((id: string, message: string | string[]) => void) | null>;
  handleActivateMenuRef: MutableRefObject<() => void>;
  /** Called to trigger the perm-request latch flow (no tree selection). */
  handleAgentLatchRef: MutableRefObject<() => void>;
  handleNotificationsClickRef: MutableRefObject<() => void>;
  /**
   * Rename every pane-tab in every group to `${prefix}${index+1}`. Called
   * from the harness hook when HMX_HARNESS_RENAME_PANE_TABS is set. Polls
   * until every group has at least `minTabsPerGroup` tabs and the per-group
   * count stops changing before emitting the rename ops.
   */
  renameAllPaneTabsRef: MutableRefObject<((prefix: string, minTabsPerGroup: number) => Promise<void>) | null>;
  /** Used to push a synthetic agent session for muxotron-expanded screenshots. */
  setAgentSessionsRef: MutableRefObject<((sessions: AgentSession[]) => void) | null>;
  /** Called after the synthetic session is pushed, when latching is requested. */
  toggleReviewLatchRef: MutableRefObject<(() => void) | null>;
  /** Called after the synthetic session is pushed, to enter review mode on it. */
  treeAgentSelectRef: MutableRefObject<((session: AgentSession) => void) | null>;
}

const HARNESS_SEED_DELAY_MS = 600;
const HARNESS_TRIGGER_DELAY_MS = (() => {
  const raw = process.env["HMX_HARNESS_TRIGGER_DELAY_MS"];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_400;
})();

interface PaneOverrides {
  paneId?: string;
  sessionName?: string;
  windowId?: string;
}

export function useHarnessHooks({
  addInfoRef,
  handleActivateMenuRef,
  handleAgentLatchRef,
  handleNotificationsClickRef,
  renameAllPaneTabsRef,
  setAgentSessionsRef,
  toggleReviewLatchRef,
  treeAgentSelectRef,
}: UseHarnessHooksOptions): void {
  useEffect(() => {
    if (process.env["HMX_HARNESS"] !== "1") return;

    const seedInfo = process.env["HMX_HARNESS_INFO"];
    const seedWarning = process.env["HMX_HARNESS_WARNING"];
    const openNotifications = process.env["HMX_HARNESS_OPEN_NOTIFICATIONS"] === "1";
    const openPaneBorderMenu = process.env["HMX_HARNESS_OPEN_PANE_BORDER_MENU"] === "1";
    const agentWaitingLabel = process.env["HMX_HARNESS_AGENT_WAITING"];
    const agentAliveCwd = process.env["HMX_HARNESS_AGENT_ALIVE"];
    const agentPaneIdOverride = process.env["HMX_HARNESS_AGENT_PANE_ID"];
    const agentWindowIdOverride = process.env["HMX_HARNESS_AGENT_WINDOW_ID"];
    const agentSessionNameOverride = process.env["HMX_HARNESS_AGENT_SESSION_NAME"];
    const muxotronReview = process.env["HMX_HARNESS_MUXOTRON_REVIEW"] === "1";
    const muxotronLatch = process.env["HMX_HARNESS_MUXOTRON_LATCH"] === "1";
    const muxotronFocusPerm = process.env["HMX_HARNESS_MUXOTRON_FOCUS_PERM"] === "1";
    const renamePaneTabsPrefix = process.env["HMX_HARNESS_RENAME_PANE_TABS"];
    const renamePaneTabsMinRaw = process.env["HMX_HARNESS_RENAME_PANE_TABS_MIN_TABS"];
    const renamePaneTabsMin = (() => {
      const parsed = renamePaneTabsMinRaw ? Number.parseInt(renamePaneTabsMinRaw, 10) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })();
    const paneOverrides = {
      paneId: agentPaneIdOverride,
      sessionName: agentSessionNameOverride,
      windowId: agentWindowIdOverride,
    };

    const seedTimer = setTimeout(() => {
      const addInfo = addInfoRef.current;
      if (addInfo) {
        if (seedInfo) addInfo("harness-info", splitMessage(seedInfo));
        if (seedWarning) addInfo("harness-warning", splitMessage(seedWarning));
      }
    }, HARNESS_SEED_DELAY_MS);

    // Agent-session injection and muxotron latch are deferred to the trigger
    // timer so the muxotron's continuous animations don't interfere with the
    // prime-screen settlement that runs in parallel on the harness side.
    const triggerTimer = setTimeout(() => {
      const sessions: AgentSession[] = [];
      if (agentWaitingLabel) sessions.push(buildSyntheticUnansweredSession(agentWaitingLabel, paneOverrides));
      if (agentAliveCwd) sessions.push(buildSyntheticAliveSession(agentAliveCwd, paneOverrides));
      if (sessions.length > 0) {
        const setSessions = setAgentSessionsRef.current;
        if (setSessions) setSessions(sessions);
      }
      if (openNotifications) handleNotificationsClickRef.current?.();
      if (openPaneBorderMenu) handleActivateMenuRef.current?.();
      if (muxotronReview || muxotronLatch) {
        // Prefer the unanswered session if both are seeded so the review
        // surface keeps the perm-request header visible. Otherwise fall
        // back to the alive session for the plain review workflow shot.
        const reviewSession = agentWaitingLabel
          ? buildSyntheticUnansweredSession(agentWaitingLabel, paneOverrides)
          : agentAliveCwd
            ? buildSyntheticAliveSession(agentAliveCwd, paneOverrides)
            : null;
        const select = treeAgentSelectRef.current;
        if (reviewSession && select) {
          select(reviewSession);
          if (muxotronLatch) {
            // Give React a frame to apply the tree selection before flipping
            // the latch; otherwise the latch toggle sees no selected session
            // and no-ops.
            setTimeout(() => {
              toggleReviewLatchRef.current?.();
            }, 120);
          }
        }
      } else if (muxotronFocusPerm) {
        // Perm-request latch: no tree selection. handleAgentLatch flips
        // muxotronFocusActive on, which (with an unanswered session pending
        // in another pane) makes the muxotron zoom to full viewport with
        // the approve/deny/goto/dismiss strip and a solid border.
        setTimeout(() => {
          handleAgentLatchRef.current?.();
        }, 120);
      }
      if (renamePaneTabsPrefix !== undefined) {
        renameAllPaneTabsRef.current?.(renamePaneTabsPrefix, renamePaneTabsMin);
      }
    }, HARNESS_TRIGGER_DELAY_MS);

    return () => {
      clearTimeout(seedTimer);
      clearTimeout(triggerTimer);
    };
  }, [
    addInfoRef,
    handleActivateMenuRef,
    handleAgentLatchRef,
    handleNotificationsClickRef,
    renameAllPaneTabsRef,
    setAgentSessionsRef,
    toggleReviewLatchRef,
    treeAgentSelectRef,
  ]);
}

/**
 * Build a synthetic alive (non-unanswered) AgentSession used for the collapsed
 * Mux-o-Tron screenshot — just a single connected agent so the counter reads
 * "000/001" instead of "no agents".
 */
function buildSyntheticAliveSession(cwd: string, overrides: PaneOverrides = {}): AgentSession {
  const now = Date.now();
  const paneId = overrides.paneId ?? "%9998";
  const windowId = overrides.windowId ?? "@9998";
  const sessionName = overrides.sessionName ?? "My Project";
  const event: AgentEvent = {
    agentType: "claude",
    cwd,
    paneId,
    sessionId: "harness-muxotron-alive",
    sessionName,
    status: "alive",
    timestamp: now,
    windowId,
  };
  return {
    agentType: "claude",
    conversationLabel: `claude (${cwd})`,
    cwd,
    lastEvent: event,
    paneId,
    sessionId: "harness-muxotron-alive",
    sessionName,
    startedAt: now,
    status: "alive",
    windowId,
  };
}

/**
 * Build a synthetic AgentSession that looks like a Claude Code permission
 * request waiting in some pane other than the active one. The paneId defaults
 * to a fabricated tmux identifier (`%9999`) that won't collide with the live
 * demo session; pass `overrides` to route the PTY bridge to a real harness-
 * seeded window (e.g. the fake-agent dialog window).
 */
function buildSyntheticUnansweredSession(label: string, overrides: PaneOverrides = {}): AgentSession {
  const now = Date.now();
  const paneId = overrides.paneId ?? "%9999";
  const windowId = overrides.windowId ?? "@9999";
  const sessionName = overrides.sessionName ?? "My Project";
  const event: AgentEvent = {
    agentType: "claude",
    cwd: "~/src/project",
    hookEvent: "PermissionRequest",
    paneId,
    sessionId: "harness-muxotron",
    sessionName,
    status: "unanswered",
    timestamp: now,
    toolInput: { file_path: label.replace(/^[^:]+:\s*/, "") },
    toolName: label.split(":")[0]?.trim() || "Edit",
    toolUseId: "harness-tool",
    windowId,
  };
  return {
    agentType: "claude",
    conversationLabel: "claude (~/src/project)",
    cwd: "~/src/project",
    lastEvent: event,
    paneId,
    sessionId: "harness-muxotron",
    sessionName,
    startedAt: now,
    status: "unanswered",
    windowId,
  };
}

function splitMessage(raw: string): string[] {
  return raw.split("|").map((line) => line.trim());
}
