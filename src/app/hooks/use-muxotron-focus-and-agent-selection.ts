import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentSession } from "../../agents/types.ts";
import type { HoneymuxConfig, UIMode } from "../../util/config.ts";
import type { KeyAction, KeybindingConfig } from "../../util/keybindings.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { UiChromeState } from "./use-app-state-groups.ts";

import { groupSessionsForDisplay } from "../../components/agent-tree-groups.ts";
import { saveConfig } from "../../util/config.ts";
import { MODIFIER_KEY_CODES, formatBinding } from "../../util/keybindings.ts";
import { stripAnsiEscapes } from "../../util/text.ts";

const CAPTURE_POLL_MS = 2000;

export interface InteractiveAgentInputs {
  activePaneId: null | string;
  agentSessions: AgentSession[];
  muxotronFocusActive: boolean;
  reviewLatched: boolean;
  treeSelectedSession: AgentSession | null;
  zoomAction: KeyAction | null;
  zoomSticky: { zoomAgentsView: boolean; zoomServerView: boolean };
}

export interface MuxotronFocusAndAgentSelectionApi {
  /** Human-readable label for the agentLatch binding (e.g. "right shift"). */
  agentLatchBindingLabel: string | undefined;
  /**
   * Agent the muxotron should *render* live. Superset of `interactiveAgent`:
   * also includes the tree-selected agent while it is being previewed
   * (unlatched), so the PTY bridge displays styled, live content regardless
   * of latch state.
   */
  attachedAgent: AgentSession | null;
  capturedPaneLines: null | string[];
  clearTreeSelectedSession: () => void;
  handleToggleReviewLatch: () => void;
  handleToggleZoomSticky: (action: ZoomHoldAction) => void;
  handleTreeAgentSelect: (session: AgentSession) => void;
  /** Agent the keyboard input is currently routed to (latched or sticky). */
  interactiveAgent: AgentSession | null;
  /** True while the tree-selected agent is in interactive (latched) mode. */
  reviewLatched: boolean;
  treeSelectedSession: AgentSession | null;
  treeSelectedSessionRef: MutableRefObject<AgentSession | null>;
}

interface UseMuxotronFocusAndAgentSelectionOptions {
  activePaneId: null | string;
  agentSessions: AgentSession[];
  config: HoneymuxConfig;
  effectiveUIMode: UIMode;
  keybindingConfig: KeybindingConfig;
  refs: Pick<
    AppRuntimeRefs,
    | "agentPreviewRef"
    | "clientRef"
    | "handleMuxotronDismissRef"
    | "handleReviewAgentRef"
    | "handleZoomEndRef"
    | "handleZoomStartRef"
    | "interactiveAgentRef"
    | "matchZoomCodeRef"
    | "muxotronExpandedRef"
    | "muxotronFocusActiveRef"
    | "reEncodeActiveRef"
    | "reviewLatchedRef"
    | "toggleReviewLatchRef"
    | "treeAgentSelectRef"
    | "zoomActionRef"
    | "zoomStickyRef"
  >;
  setConfig: (value: HoneymuxConfig) => void;
  uiChromeState: Pick<
    UiChromeState,
    "muxotronFocusActive" | "muxotronFocusActiveRef" | "setMuxotronFocusActive" | "setZoomAction" | "zoomAction"
  >;
}

type ZoomHoldAction = "zoomAgentsView" | "zoomServerView";

/**
 * Decide which agent (if any) the focused muxotron should be bridging to as
 * an interactive PTY surface. Returns null in peek (held-key) mode and
 * when no candidate has the metadata required to attach.
 *
 * `zoomAction` is `null` when the zoom was auto-triggered by the muxotron
 * already being expanded in adaptive mode (see `handleZoomStartRef`). We
 * still honor the agents-view sticky latch in that case — the muxotron is
 * the interactive surface regardless of how it expanded.
 */
export function computeInteractiveAgent(inputs: InteractiveAgentInputs): AgentSession | null {
  const {
    activePaneId,
    agentSessions,
    muxotronFocusActive,
    reviewLatched,
    treeSelectedSession,
    zoomAction,
    zoomSticky,
  } = inputs;
  let candidate: AgentSession | null = null;
  if (treeSelectedSession) {
    // Tree-selected agents start in preview (not interactive) — the user
    // must press Enter to latch before keystrokes reach the agent's PTY.
    if (!reviewLatched) return null;
    candidate = treeSelectedSession;
  } else if (
    muxotronFocusActive &&
    zoomSticky.zoomAgentsView &&
    (zoomAction === "zoomAgentsView" || zoomAction === null)
  ) {
    // Prefer the oldest unanswered agent (so sticky-zoom targets pending
    // permission prompts), falling back to any live non-dismissed agent in
    // another pane so the user can still type into idle agents.
    const active = agentSessions.filter((s) => !s.dismissed && s.status !== "ended" && s.paneId !== activePaneId);
    candidate =
      active.filter((s) => s.status === "unanswered").sort((a, b) => a.startedAt - b.startedAt)[0] ??
      active.sort((a, b) => a.startedAt - b.startedAt)[0] ??
      null;
  }
  if (!candidate) return null;
  if (!candidate.sessionName || !candidate.paneId || !candidate.windowId) return null;
  return candidate;
}

export function computeMuxotronExpanded(
  effectiveUIMode: UIMode,
  agentSessions: AgentSession[],
  activePaneId: null | string,
  treeSelectedSession: AgentSession | null,
): boolean {
  return (
    (effectiveUIMode === "adaptive" &&
      agentSessions.some(
        (session) => session.status === "unanswered" && !session.dismissed && session.paneId !== activePaneId,
      )) ||
    !!treeSelectedSession
  );
}

export function matchZoomActionForModifierCode(
  code: number,
  zoomAgentsViewBinding: string,
  zoomServerViewBinding: string,
): ZoomHoldAction | null {
  const name = MODIFIER_KEY_CODES[code];
  if (!name) return null;
  if (name === zoomAgentsViewBinding) return "zoomAgentsView";
  if (name === zoomServerViewBinding) return "zoomServerView";
  return null;
}

/**
 * Mirrors the agents sidebar view's "first focusable row" — the agent
 * pressing spacebar would target when focus is on the first entry. Filters
 * out ended sessions and applies the same grouping/sorting as the tree so
 * the review workflow can be entered from non-sidebar contexts (main menu,
 * hotkey) without needing the sidebar mounted.
 */
export function pickFirstReviewAgent(sessions: AgentSession[]): AgentSession | null {
  const active = sessions.filter((s) => s.status !== "ended");
  const groups = groupSessionsForDisplay(active);
  for (const group of groups) {
    if (group.lead) return group.lead;
    if (group.members.length > 0) return group.members[0]!;
  }
  return null;
}

export function toggleZoomStickyConfig(config: HoneymuxConfig, action: ZoomHoldAction): HoneymuxConfig {
  const key = action === "zoomAgentsView" ? "zoomAgentsViewStickyKey" : "zoomServerViewStickyKey";
  return {
    ...config,
    [key]: !(config[key] ?? false),
  };
}

export function useMuxotronFocusAndAgentSelection({
  activePaneId,
  agentSessions,
  config,
  effectiveUIMode,
  keybindingConfig,
  refs,
  setConfig,
  uiChromeState,
}: UseMuxotronFocusAndAgentSelectionOptions): MuxotronFocusAndAgentSelectionApi {
  const {
    agentPreviewRef,
    clientRef,
    handleMuxotronDismissRef,
    handleReviewAgentRef,
    handleZoomEndRef,
    handleZoomStartRef,
    interactiveAgentRef,
    matchZoomCodeRef,
    muxotronExpandedRef,
    muxotronFocusActiveRef,
    reEncodeActiveRef,
    reviewLatchedRef,
    toggleReviewLatchRef,
    treeAgentSelectRef,
    zoomActionRef,
    zoomStickyRef,
  } = refs;
  const {
    muxotronFocusActive,
    muxotronFocusActiveRef: uiMuxotronFocusActiveRef,
    setMuxotronFocusActive,
    setZoomAction,
    zoomAction,
  } = uiChromeState;

  const [treeSelectedSession, setTreeSelectedSession] = useState<AgentSession | null>(null);
  const treeSelectedSessionRef = useRef<AgentSession | null>(treeSelectedSession);
  treeSelectedSessionRef.current = treeSelectedSession;

  const [reviewLatched, setReviewLatched] = useState(false);
  reviewLatchedRef.current = reviewLatched;
  agentPreviewRef.current = !!treeSelectedSession && !reviewLatched;

  const [capturedPaneLines, setCapturedPaneLines] = useState<null | string[]>(null);

  const zoomAgentsViewBinding = keybindingConfig.zoomAgentsView;
  const zoomServerViewBinding = keybindingConfig.zoomServerView;
  const agentLatchBinding = keybindingConfig.agentLatch;
  const agentLatchBindingLabel = agentLatchBinding ? formatBinding(agentLatchBinding) : undefined;

  const clearTreeSelectedSession = useCallback(() => {
    setTreeSelectedSession(null);
    setReviewLatched(false);
  }, []);

  const handleToggleReviewLatch = useCallback(() => {
    if (!treeSelectedSessionRef.current) return;
    setReviewLatched((prev) => !prev);
  }, []);
  toggleReviewLatchRef.current = handleToggleReviewLatch;

  const activateMuxotronFocus = useCallback(
    (action: KeyAction | null) => {
      uiMuxotronFocusActiveRef.current = true;
      muxotronFocusActiveRef.current = true;
      zoomActionRef.current = action;
      setMuxotronFocusActive(true);
      setZoomAction(action);
    },
    [muxotronFocusActiveRef, setMuxotronFocusActive, setZoomAction, uiMuxotronFocusActiveRef, zoomActionRef],
  );

  const deactivateMuxotronFocus = useCallback(() => {
    uiMuxotronFocusActiveRef.current = false;
    muxotronFocusActiveRef.current = false;
    zoomActionRef.current = null;
    setMuxotronFocusActive(false);
    setZoomAction(null);
    setTreeSelectedSession(null);
    setReviewLatched(false);
  }, [muxotronFocusActiveRef, setMuxotronFocusActive, setZoomAction, uiMuxotronFocusActiveRef, zoomActionRef]);

  const handleTreeAgentSelect = useCallback(
    (session: AgentSession) => {
      setTreeSelectedSession(session);
      setReviewLatched(false);
      activateMuxotronFocus(null);
    },
    [activateMuxotronFocus],
  );
  treeAgentSelectRef.current = handleTreeAgentSelect;

  handleReviewAgentRef.current = () => {
    const first = pickFirstReviewAgent(agentSessions);
    if (first) handleTreeAgentSelect(first);
  };

  muxotronExpandedRef.current = computeMuxotronExpanded(
    effectiveUIMode,
    agentSessions,
    activePaneId,
    treeSelectedSession,
  );

  zoomStickyRef.current = {
    zoomAgentsView: config.zoomAgentsViewStickyKey ?? true,
    zoomServerView: config.zoomServerViewStickyKey ?? true,
  };
  reEncodeActiveRef.current = true;

  const interactiveAgent = computeInteractiveAgent({
    activePaneId,
    agentSessions,
    muxotronFocusActive,
    reviewLatched,
    treeSelectedSession,
    zoomAction,
    zoomSticky: zoomStickyRef.current,
  });
  interactiveAgentRef.current = interactiveAgent;

  // Broader "attached" agent: used for PTY bridging / rendering. In preview
  // mode (tree-selected, unlatched) we still want the live styled PTY view
  // rather than a stripped capture-pane snapshot, so include the
  // tree-selected session here as long as it has the metadata needed to
  // attach a bridge.
  const attachedAgent: AgentSession | null =
    interactiveAgent ??
    (treeSelectedSession &&
    treeSelectedSession.sessionName &&
    treeSelectedSession.paneId &&
    treeSelectedSession.windowId
      ? treeSelectedSession
      : null);

  matchZoomCodeRef.current = (code: number) =>
    matchZoomActionForModifierCode(code, zoomAgentsViewBinding, zoomServerViewBinding);
  handleZoomStartRef.current = (action) => {
    // Held-key zoom is suppressed while the muxotron is interactive — the
    // PTY owns the keyboard, so a peek hold would conflict with typing.
    if (interactiveAgentRef.current) return;
    const overlayAction = action === "zoomAgentsView" && muxotronExpandedRef.current ? null : action;
    activateMuxotronFocus(overlayAction);
  };
  handleZoomEndRef.current = deactivateMuxotronFocus;
  handleMuxotronDismissRef.current = () => {
    if (muxotronFocusActiveRef.current) {
      deactivateMuxotronFocus();
      return;
    }
    setTreeSelectedSession(null);
    setReviewLatched(false);
  };

  // The attached agent (latched or preview) is shown via a live PTY bridge,
  // so capture-pane snapshots are only needed when we have a tree-selected
  // session that can't be bridged (missing metadata). In practice this
  // branch rarely runs now — the attached-agent path handles the common
  // case — but we keep it as a fallback for incomplete sessions.
  const attachedSessionId = attachedAgent?.sessionId ?? null;
  useEffect(() => {
    const session = treeSelectedSession;
    const paneId = session?.paneId;
    if (!session || !paneId || attachedSessionId === session.sessionId) {
      setCapturedPaneLines(null);
      return;
    }
    let cancelled = false;
    const capture = async () => {
      const client = clientRef.current;
      if (!client || cancelled) return;
      try {
        const output = await client.runCommandArgs(["capture-pane", "-p", "-e", "-t", paneId]);
        if (cancelled) return;
        setCapturedPaneLines(output.split("\n").map((line) => stripAnsiEscapes(line)));
      } catch {
        if (!cancelled) setCapturedPaneLines(null);
      }
    };
    void capture();
    const intervalId = setInterval(() => {
      void capture();
    }, CAPTURE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      setCapturedPaneLines(null);
    };
  }, [clientRef, attachedSessionId, treeSelectedSession]);

  const handleToggleZoomSticky = useCallback(
    (action: ZoomHoldAction) => {
      const nextConfig = toggleZoomStickyConfig(config, action);
      setConfig(nextConfig);
      void saveConfig(nextConfig);
    },
    [config, setConfig],
  );

  return {
    agentLatchBindingLabel,
    attachedAgent,
    capturedPaneLines,
    clearTreeSelectedSession,
    handleToggleReviewLatch,
    handleToggleZoomSticky,
    handleTreeAgentSelect,
    interactiveAgent,
    reviewLatched,
    treeSelectedSession,
    treeSelectedSessionRef,
  };
}
