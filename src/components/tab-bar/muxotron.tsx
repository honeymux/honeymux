import type { ReactNode } from "react";

import { type MouseEvent } from "@opentui/core";
import { Fragment, useEffect, useRef, useState } from "react";

import type { CodingAgentPaneActivity } from "../../agents/pane-activity.ts";
import type { AgentSession, HoneymuxState } from "../../agents/types.ts";
import type { UIMode } from "../../util/config.ts";

import { AGENT_COLORS, HONEYMUX_ANIMATIONS } from "../../agents/types.ts";
import { hexToRgb, lerpRgb, rgbToHex, terminalBgRgb, theme } from "../../themes/theme.ts";
import { EQ_BORDER, computeScannerColors } from "../../util/anamorphic-equalizer.ts";
import { isMarqueeMode } from "../../util/config.ts";
import { homoglyphCycle } from "../../util/homoglyphs.ts";
import { loadKeybindings } from "../../util/keybindings.ts";
import { COLLAPSED_MUXOTRON_WIDTH, getMuxotronWidth } from "../../util/muxotron-size.ts";
import { scribbleCycle } from "../../util/scribble.ts";
import { MuxotronCollapsedView } from "./muxotron-collapsed.tsx";
import { MuxotronExpandedView } from "./muxotron-expanded.tsx";
import {
  MUXOTRON_COUNTER_LABEL,
  MUXOTRON_HINT_COLORS,
  type MuxotronHintButton,
  buildMuxotronBorderStr,
  buildMuxotronHintButtons,
  buildMuxotronHintsText,
  buildMuxotronToolInfo,
  formatMuxotronCount,
  getFirstUnansweredSession,
  isMuxotronDashed,
  punchDashedBorderGaps,
  sanitizeMuxotronDisplayText,
  splitMuxotronBorderOverlays,
} from "./muxotron-model.ts";

/**
 * Fixed 27-wide Mux-o-Tron with unanswered/total counters and mascot.
 *
 * Layout:
 *
 * ╭────── unanswered/total ╮
 * │ ʕ·ᴥ·ʔ          000/001 │
 * ╰────────────────────────╯
 */
export interface MuxotronProps {
  activePaneId?: null | string;
  agentAlertAnimConfusables?: boolean;
  /** Number of animation cycles to play before each delay (minimum 1). */
  agentAlertAnimCycleCount?: number;
  /** Seconds between intermittent animation bursts (0 = always animate). */
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  /** Human-readable label for the agentLatch binding (e.g. "right shift"). */
  agentLatchBindingLabel?: string;
  agentSessions: AgentSession[];
  /** honeymux's own tmux-client column count — used to size the interactive PTY content area. */
  agentTermCols?: number;
  /** honeymux's own tmux-client row count — used to size the interactive PTY content area. */
  agentTermRows?: number;
  /** Pre-built interactive PTY terminal node to render in the focused body. */
  agentTerminalNode?: React.ReactNode;
  agentsDialogOpen?: boolean;
  /** Captured pane content lines for non-unanswered agents (ANSI-stripped). */
  capturedPaneLines?: null | string[];
  codingAgentActivity?: CodingAgentPaneActivity;
  configAgentsPreview?: null | string;
  infoCount?: number;
  /** When non-null, the focused muxotron is bridging this agent's PTY interactively. */
  interactiveAgent?: AgentSession | null;
  /** Maximum width when expanded — leaves room for overflow tab + padding. */
  maxExpandedWidth?: number;
  muxotronExpanded?: boolean;
  /** True while the muxotron focus surface is active. */
  muxotronFocusActive?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  /** Called when the expanded muxotronEnabled's computed width changes. */
  onExpandedWidthChange?: (width: number) => void;
  onGoto?: () => void;
  onInteractiveScrollSequence?: (sequence: string) => void;
  /** Called when the expanded muxotron body is clicked (collapsed clicks
   *  are routed by the tab bar's zone detection). */
  onMuxotronClick?: () => void;
  /** Navigate to next agent in the sidebar tree (tree-selection mode only). */
  onNextAgent?: () => void;
  onNotificationsClick?: () => void;
  /** Navigate to previous agent in the sidebar tree (tree-selection mode only). */
  onPrevAgent?: () => void;
  onReviewLatchToggle?: () => void;
  /** True when the focused muxotron is review-latched — the PTY is receiving input. */
  reviewLatched?: boolean;
  /** Agent selected from tree view — forces expansion for this specific session. */
  selectedSession?: AgentSession | null;
  /** Terminal height in rows (for clamping vertical expansion). */
  termHeight?: number;
  uiMode?: UIMode;
  warningCount?: number;
  width: number;
}

export function Muxotron({
  activePaneId,
  agentAlertAnimConfusables,
  agentAlertAnimCycleCount,
  agentAlertAnimDelay,
  agentAlertAnimEqualizer,
  agentAlertAnimGlow,
  agentAlertAnimScribble,
  agentLatchBindingLabel,
  agentSessions,
  agentTermCols,
  agentTermRows,
  agentTerminalNode,
  agentsDialogOpen,
  capturedPaneLines: capturedPaneLinesProp,
  codingAgentActivity,
  configAgentsPreview,
  infoCount,
  interactiveAgent,
  maxExpandedWidth,
  muxotronExpanded,
  muxotronFocusActive,
  onApprove,
  onDeny,
  onDismiss,
  onExpandedWidthChange,
  onGoto,
  onInteractiveScrollSequence,
  onMuxotronClick,
  onNextAgent,
  onNotificationsClick,
  onPrevAgent,
  onReviewLatchToggle,
  reviewLatched,
  selectedSession: selectedSessionProp,
  termHeight,
  uiMode: uiModeProp,
  warningCount,
  width,
}: MuxotronProps) {
  const uiMode = uiModeProp ?? "adaptive";

  const zoomScrollRef = useRef(0);
  const prevZoomSessionRef = useRef<string | undefined>(undefined);

  // Track expanded width and report to parent for overflow computation.
  // Placed before any early returns so hooks are called unconditionally.
  const [reportedExpandedWidth, setReportedExpandedWidth] = useState(0);
  const onExpandedWidthChangeRef = useRef(onExpandedWidthChange);
  onExpandedWidthChangeRef.current = onExpandedWidthChange;
  useEffect(() => {
    onExpandedWidthChangeRef.current?.(reportedExpandedWidth);
  }, [reportedExpandedWidth]);

  const muxotronEnabledWidth = getMuxotronWidth(width, uiMode, true, !!muxotronExpanded);
  if (muxotronEnabledWidth === 0) return null;
  const inner = muxotronEnabledWidth - 2;
  const il = Math.floor((width - muxotronEnabledWidth) / 2);

  // Tick counter - drives all animations via Date.now()
  const [, setTick] = useState(0);

  // Filter out ended sessions
  const active = agentSessions.filter((s) => s.status !== "ended");

  // Compute counters
  let totalCount = active.length;
  let unansweredCount = active.filter((s) => s.status === "unanswered").length;

  // Override counters for config agents preview
  if (configAgentsPreview) {
    totalCount = 3;
    unansweredCount = 1;
  }

  // Status flags
  const hasUnanswered = unansweredCount > 0;
  let hasAnyAgent = totalCount > 0;
  if (configAgentsPreview) hasAnyAgent = true;

  // Permission requests in a pane other than the currently focused one drive
  // the attention-grabbing visuals: yellow border, glow, scanner, needInput
  // mascot state, marquee hints. When the only unanswered request is in the
  // focused pane, the user can already see it directly, so the muxotron stays
  // calm and only the mascot changes color (orange).
  const unansweredElsewhere =
    !!configAgentsPreview || active.some((s) => s.status === "unanswered" && s.paneId !== activePaneId);

  // Honeymux state
  const now = Date.now();
  const sineWaveHasConnectedAgent = codingAgentActivity?.hasConnectedAgent ?? false;
  const sineWaveLastOutputTickAt = codingAgentActivity?.lastOutputTickAt ?? null;

  // Intermittent animation gating: when agentAlertAnimDelay > 0, animations
  // play for cycleCount complete back-and-forth sweeps then pause for the delay.
  const SWEEP_MS = 1800; // ms for one complete back-and-forth scanner sweep
  const cycleCount = Math.max(1, agentAlertAnimCycleCount ?? 1);
  const burstMs = SWEEP_MS * cycleCount;
  const delayMs = (agentAlertAnimDelay ?? 0) * 1000;
  const totalCycleMs = burstMs + delayMs;
  const burstPos = delayMs <= 0 ? 0 : now % totalCycleMs;
  const intermittentActive = delayMs <= 0 || burstPos < burstMs || !!configAgentsPreview;

  // Scanner phase (0–1): synchronized to burst so each burst starts at the
  // left end and completes exactly cycleCount sweeps before the delay.
  const scannerPhase = delayMs <= 0 ? ((now % SWEEP_MS) / SWEEP_MS) % 1 : ((burstPos / burstMs) * cycleCount) % 1;

  // Anamorphic Equalizer active when enabled AND (has unanswered elsewhere or config agents preview) AND intermittent window open
  const eqActive = !!agentAlertAnimEqualizer && (unansweredElsewhere || !!configAgentsPreview) && intermittentActive;
  const idleStartRef = useRef<null | number>(null);
  if (hasUnanswered || totalCount > 0) {
    idleStartRef.current = null;
  } else if (idleStartRef.current === null) {
    idleStartRef.current = now;
  }
  const isLongIdle = idleStartRef.current !== null && now - idleStartRef.current >= 5 * 60 * 1000;
  const honeymuxState: HoneymuxState = unansweredElsewhere
    ? "needInput"
    : hasUnanswered
      ? "needInputFocused"
      : isLongIdle
        ? "sleeping"
        : "idle";
  const hmAnim = HONEYMUX_ANIMATIONS[honeymuxState];

  // Mascot frame advancement is owned by MuxotronMascotOverlay via the
  // imperative animation hook, so we don't compute hmFace here anymore.
  // This is what lets muxotron skip its 500ms setTick in the common case
  // (no unansweredElsewhere / no eqActive) — the mascot repaints itself without
  // forcing a React re-render of the whole muxotron subtree.

  // Animation timer — only fires when the muxotron body itself has
  // something animating that isn't covered by an imperative overlay.
  // Currently that's the scanner (eqActive) and the border glow effect
  // (unansweredElsewhere && agentAlertAnimGlow).  When neither is active,
  // no interval runs and muxotron only re-renders on actual prop changes.
  const needsFastTick = unansweredElsewhere || eqActive;
  useEffect(() => {
    if (!needsFastTick) return;
    const id = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [needsFastTick]);

  // Border color reflects overall mood. When a permission request is
  // pending elsewhere, brand the border with the requesting agent's color
  // (e.g. orange for claude, purple for gemini, blue for codex) so the
  // user can tell at a glance which agent is waiting. Falls back to the
  // generic warning hue only for synthetic previews or edge cases where
  // no specific agent can be identified.
  const firstUnanswered = unansweredElsewhere ? getFirstUnansweredSession(active, activePaneId) : undefined;
  const alertBorderColor = firstUnanswered ? AGENT_COLORS[firstUnanswered.agentType] : theme.statusWarning;
  const baseBorderColor = unansweredElsewhere ? alertBorderColor : hasAnyAgent ? theme.textSecondary : theme.border;

  // Smooth glow when unanswered
  let borderColor = baseBorderColor;
  if (unansweredElsewhere && agentAlertAnimGlow === true && intermittentActive) {
    const glowT = (Math.sin((now / 1000) * Math.PI) + 1) / 2;
    const from = hexToRgb(theme.border);
    const to = hexToRgb(alertBorderColor);
    borderColor = rgbToHex(lerpRgb(from, to, glowT));
  }

  // Anamorphic Equalizer overrides border color after glow computation
  if (eqActive) {
    borderColor = EQ_BORDER;
  }

  const hasActivePermissionRequest =
    !!configAgentsPreview || active.some((s) => s.status === "unanswered" && !s.dismissed);
  const isDashed = isMuxotronDashed({
    agentLatchBindingLabel,
    eqActive,
    hasActivePermissionRequest,
    muxotronFocusActive: !!muxotronFocusActive,
    reviewLatched: !!reviewLatched,
    selectedSession: !!selectedSessionProp,
  });

  // Use actual probed terminal bg for the opaque box — theme.bg may not match.
  // Hoisted so both collapsed and expanded paths can paint dashed-gap cells
  // opaque (otherwise the gap spaces would let underlying content through).
  const realBg = rgbToHex(terminalBgRgb);

  // Anamorphic Equalizer border characters
  const cornerTL = eqActive ? "┏" : "╭";
  const cornerTR = eqActive ? "┓" : "╮";
  const cornerBL = eqActive ? "┗" : "╰";
  const cornerBR = eqActive ? "┛" : "╯";
  const hDash = eqActive ? "━" : "─";
  const vBar = eqActive ? "┃" : "│";

  // Grace period: don't show "no agents" until 1.5s after mount
  const mountTimeRef = useRef(Date.now());
  const startupElapsed = now - mountTimeRef.current >= 1500;

  // Format counter string
  const counterStr = `${formatMuxotronCount(unansweredCount)}/${formatMuxotronCount(totalCount)}`;

  // Confusables: homoglyph cycling on tool permission text
  const danceActive = unansweredElsewhere && agentAlertAnimConfusables !== false && intermittentActive;
  const counterDisplay = counterStr;

  // Middle row content
  const hmW = hmAnim.width;
  const hmPad = 1;

  const showNoAgents = !hasAnyAgent && startupElapsed;

  // Marquee mode: show tool detail for the first unanswered agent
  const isMarquee = isMarqueeMode(uiMode);
  // When a session is explicitly selected from the tree, use it as the target for expansion.
  // During config agents preview, force undefined so the dummy preview content is shown
  // instead of any real permission request that may be active.
  const expandedTarget = configAgentsPreview ? undefined : (selectedSessionProp ?? firstUnanswered);

  // Build marquee tool info string (between mascot and counters)
  // Only shown when NOT expanded (dropdown shows the details instead)
  let marqueeToolInfo = "";
  if (isMarquee && !agentsDialogOpen && firstUnanswered) {
    marqueeToolInfo = buildMuxotronToolInfo(firstUnanswered);
    if (danceActive) marqueeToolInfo = homoglyphCycle(marqueeToolInfo, now);
  }

  // Label color: mood-colored but never glows
  const labelColor = baseBorderColor;
  let keybindingsCache: ReturnType<typeof loadKeybindings> | null = null;
  const getKeybindings = () => {
    keybindingsCache ??= loadKeybindings();
    return keybindingsCache;
  };

  // Marquee approval hints (shown only when NOT expanded)
  const showMarqueeHints = isMarquee && unansweredElsewhere && !agentsDialogOpen;
  const marqueeHints = showMarqueeHints ? buildMuxotronHintsText(getKeybindings()) : "";

  // For marquee-bottom, the label goes on the bottom border
  const labelOnBottom = uiMode === "marquee-bottom";
  const topBorderStr = buildMuxotronBorderStr({
    dash: hDash,
    inner,
    leftCorner: cornerTL,
    marqueeHints,
    rightCorner: cornerTR,
    showMarqueeHints,
    withLabel: !labelOnBottom,
  });

  // === EXPANDED ADAPTIVE MODE ===
  // When expanded (full-width), use a different layout:
  //   Top border: session name left, total/unanswered label right
  //   Middle: mascot left, tool info centered, counter right
  //   Bottom border: key hints right, Anamorphic Equalizer centered (small width)
  // Also enters this path during config agents preview to show a dummy expanded muxotronEnabled.
  const showExpanded = (!!muxotronExpanded && expandedTarget) || !!configAgentsPreview;
  const capturedPaneLines = capturedPaneLinesProp?.map((line) => sanitizeMuxotronDisplayText(line));
  if (showExpanded) {
    let expandedToolInfo = expandedTarget ? buildMuxotronToolInfo(expandedTarget) : "Edit: src/components/example.tsx";
    if (danceActive) expandedToolInfo = homoglyphCycle(expandedToolInfo, now);
    // Newline-preserving version for the focused wrapped display
    const focusedToolInfo = expandedTarget ? buildMuxotronToolInfo(expandedTarget, true) : expandedToolInfo;
    const conversationPrompt = expandedTarget
      ? sanitizeMuxotronDisplayText(
          expandedTarget.conversationLabel ?? `${expandedTarget.agentType} (${expandedTarget.cwd})`,
        )
      : "opencode (~/src/project)";
    const hintButtons = buildMuxotronHintButtons({
      keybindings: getKeybindings(),
      latched: reviewLatched,
      onApprove,
      onDeny,
      onDismiss,
      onGoto,
      onLatchToggle: onReviewLatchToggle,
      onNextAgent,
      onPrevAgent,
      selectedSession: selectedSessionProp,
    });

    const hasZoomMode = !!agentLatchBindingLabel;
    const showAllButtons = !configAgentsPreview && (!!selectedSessionProp || !hasZoomMode || muxotronFocusActive);
    const expandLabel = agentLatchBindingLabel ? `${agentLatchBindingLabel}: latch` : "latch";

    // Always size the muxotronEnabled for the full button strip width
    const allButtonTexts = hintButtons.map((b) => ` ${b.label} `);
    const allButtonsWidth = allButtonTexts.reduce((sum, t) => sum + t.length, 0) + (allButtonTexts.length - 1);
    // Middle row: │ + hmPad + mascot + space + toolInfo + space + counter + │
    const counterWidth = counterStr.length + 1;
    const middleRowContent = hmPad + hmW + 1 + expandedToolInfo.length + 1 + counterWidth;
    // Bottom row: always sized for full button strip + side padding
    const bottomRowContent = allButtonsWidth + 2 + 1;
    const minInner = Math.max(middleRowContent, bottomRowContent);
    // Add 15% breathing room, then clamp: at least collapsed width, at most terminal width
    // (respecting maxExpandedWidth to leave room for the overflow tab)
    // (d) Add 1-char outer padding on each side of the muxotronEnabled border
    const outerPad = 1;
    const paddedInner = Math.ceil(minInner * 1.15);
    const widthCap = maxExpandedWidth != null ? Math.min(width, maxExpandedWidth) : width;
    // When muxotron focus is active (key held or tree-selected), expand to full available width
    const zoomOrSelected = muxotronFocusActive || !!selectedSessionProp;
    // Interactive mode sizes the content area to honeymux's own tmux-client
    // dimensions (agentTermCols/agentTermRows). This matches the size the
    // grouped overlay PTY is spawned at, which equals the original honeymux
    // client's dimensions so tmux doesn't see a window-size mismatch and
    // doesn't render its dot-grid in the extra viewport cells.
    const interactiveActive = !!interactiveAgent && !!agentTerminalNode;
    const interactiveContentCols = agentTermCols && agentTermCols > 0 ? agentTermCols : Math.max(10, width - 4);
    const interactiveDesiredWidth = interactiveContentCols + 2 + outerPad * 2;
    const expandedWidth = interactiveActive
      ? Math.max(COLLAPSED_MUXOTRON_WIDTH, Math.min(width, interactiveDesiredWidth))
      : zoomOrSelected
        ? Math.max(COLLAPSED_MUXOTRON_WIDTH, widthCap)
        : Math.max(COLLAPSED_MUXOTRON_WIDTH, Math.min(widthCap, paddedInner + 2 + outerPad * 2));
    if (expandedWidth !== reportedExpandedWidth) setReportedExpandedWidth(expandedWidth);
    const expandedInner = expandedWidth - 2 - outerPad * 2;
    const expandedIl = Math.floor((width - expandedWidth) / 2);
    // Border starts after outer padding
    // Border content offset within the full-width box
    const bx = outerPad; // border-left within the box (box itself is at expandedIl)

    // Vertical expansion during zoom: if tool info was truncated, add extra rows
    // to show the full text, clamped by available terminal height.
    const singleLineAvail = expandedInner - hmPad - hmW - 1 - counterWidth; // avail width for tool info on row 1
    const toolInfoTruncated = expandedToolInfo.length > singleLineAvail;
    const focusedToolInfoHasNewlines = focusedToolInfo.includes("\n");
    const wrapWidth = expandedInner - 2; // 1-char padding each side inside borders
    // For non-unanswered agents, show captured pane content instead of tool info
    const usePaneCapture =
      !interactiveActive &&
      zoomOrSelected &&
      expandedTarget &&
      expandedTarget.status !== "unanswered" &&
      capturedPaneLines != null;
    // Count lines needed: split on newlines first, then wrap each sub-line by width
    const zoomNeeded = usePaneCapture || toolInfoTruncated || focusedToolInfoHasNewlines;
    // Reset scroll offset on session change or zoom deactivate
    const curZoomSid = expandedTarget?.sessionId;
    if (curZoomSid !== prevZoomSessionRef.current || (!muxotronFocusActive && !selectedSessionProp)) {
      zoomScrollRef.current = 0;
      prevZoomSessionRef.current = curZoomSid;
    }
    let zoomLineCount = 0;
    if (interactiveActive) {
      // Interactive mode: size content rows to honeymux's own tmux-client
      // rows so the grouped overlay PTY matches and tmux doesn't show dots.
      // Fall back to viewport-minus-chrome if agentTermRows is unavailable.
      zoomLineCount = agentTermRows && agentTermRows > 0 ? agentTermRows : Math.max(1, (termHeight ?? 24) - 3 - 1 - 1);
    } else if (usePaneCapture) {
      zoomLineCount = capturedPaneLines!.length;
    } else if (zoomOrSelected && zoomNeeded) {
      for (const sub of focusedToolInfo.split("\n")) {
        zoomLineCount += Math.max(1, Math.ceil(sub.length / wrapWidth));
      }
    }
    const extraLines = interactiveActive
      ? zoomLineCount
      : zoomOrSelected && zoomNeeded
        ? zoomLineCount // all wrapped lines are "extra" — row 1 shows a truncated summary
        : 0;
    // Clamp: muxotronEnabled can't exceed terminal height (leave room for content below)
    const maxExtraLines = Math.max(0, (termHeight ?? 24) - 3 - 1); // -3 for base muxotronEnabled, -1 margin
    const clampedExtraLines = Math.min(extraLines, maxExtraLines);
    const hasSeparator = clampedExtraLines > 0;
    const totalHeight = 3 + (hasSeparator ? 1 : 0) + clampedExtraLines;

    // Top border: ╭─ "prompt text" ──── total/unanswered ─╮
    // 1-space padding between truncated prompt and the label
    const topRightBlock = ` ${MUXOTRON_COUNTER_LABEL} `;
    const maxLeftLen = expandedInner - topRightBlock.length - 2; // -2 for the padding spaces in topLeftBlock
    const promptTruncated =
      conversationPrompt.length > maxLeftLen ? conversationPrompt.slice(0, maxLeftLen - 1) + "…" : conversationPrompt;
    const topLeftBlock = ` ${promptTruncated} `;
    const topDashGap = expandedInner - topLeftBlock.length - topRightBlock.length;
    let expandedTopStr = `${cornerTL}${topLeftBlock}${hDash.repeat(Math.max(0, topDashGap))}${topRightBlock}${cornerTR}`;
    // Apply scribble to expanded border line-drawing chars
    const scribbleActive = !!agentAlertAnimScribble && unansweredElsewhere && intermittentActive;
    if (scribbleActive) expandedTopStr = scribbleCycle(expandedTopStr, now);
    // Positions relative to the muxotronEnabled box (not the tab bar)
    const split = splitMuxotronBorderOverlays(expandedTopStr, 0);
    const expandedTopLineStr = isDashed ? punchDashedBorderGaps(split.lineStr) : split.lineStr;
    const expandedTopOverlays = split.overlays;

    // Bottom border row index (shifts down when vertically expanded)
    const botRow = totalHeight - 1;
    const collapsedInner = COLLAPSED_MUXOTRON_WIDTH - 2;

    // Build the bottom border as a single complete string per segment (no overlays).
    // Anamorphic Equalizer colors are rendered as individual <text> elements on top.
    let expandedBottomNode: ReactNode;

    if (showAllButtons) {
      // Full button strip: cornerBL + dashes + [space btn space btn ... space] + cornerBR
      // Build the base string with spaces where buttons go (not dashes)
      const buttonRowWidth = allButtonsWidth + 2; // +2 for side padding
      const dashCount = Math.max(0, expandedInner - buttonRowWidth);
      let baseDashes = hDash.repeat(dashCount);
      if (scribbleActive) baseDashes = scribbleCycle(baseDashes, now);
      if (isDashed) baseDashes = punchDashedBorderGaps(baseDashes);

      // Compute button positions (relative to box)
      const buttonAreaStart = 1 + dashCount + 1; // after cornerBL + dashes + left pad space
      const buttonPositions: Array<{ boxLeft: number; btn: MuxotronHintButton; text: string }> = [];
      let col = buttonAreaStart;
      for (let i = 0; i < hintButtons.length; i++) {
        buttonPositions.push({ boxLeft: bx + col, btn: hintButtons[i]!, text: allButtonTexts[i]! });
        col += allButtonTexts[i]!.length;
        if (i < hintButtons.length - 1) col += 1; // space separator
      }

      // Anamorphic Equalizer elements (relative to box)
      const eqEls = eqActive
        ? (() => {
            const scannerColors = computeScannerColors(collapsedInner, scannerPhase);
            const scannerStartCol = bx + 1 + Math.max(0, Math.floor((expandedInner - collapsedInner) / 2));
            return scannerColors.map((c, i) => (
              <text
                bg={realBg}
                content="━"
                fg={c}
                key={`sc-${i}`}
                left={scannerStartCol + i}
                position="absolute"
                selectable={false}
                top={botRow}
              />
            ));
          })()
        : null;

      const botBaseStr = cornerBL + baseDashes + " ".repeat(buttonRowWidth) + cornerBR;
      expandedBottomNode = (
        <>
          <text
            bg={realBg}
            content={botBaseStr}
            fg={borderColor}
            left={bx}
            position="absolute"
            selectable={false}
            top={botRow}
          />
          {eqEls}
          {buttonPositions.map((bp, i) => {
            const bg = bp.btn.disabled ? theme.bgChrome : bp.btn.color;
            const fg = bp.btn.disabled ? theme.textSecondary : (bp.btn.fg ?? realBg);
            const onMouseDown = bp.btn.onClick
              ? (e: MouseEvent) => {
                  e.stopPropagation();
                  bp.btn.onClick!();
                }
              : undefined;
            const colonIdx = bp.btn.dimHotkey && !bp.btn.disabled ? bp.text.indexOf(": ") : -1;
            if (colonIdx < 0) {
              return (
                <text
                  bg={bg}
                  content={bp.text}
                  fg={fg}
                  key={`hb-${i}`}
                  left={bp.boxLeft}
                  onMouseDown={onMouseDown}
                  position="absolute"
                  selectable={false}
                  top={botRow}
                />
              );
            }
            const prefix = bp.text.slice(0, colonIdx + 1);
            const suffix = bp.text.slice(colonIdx + 1);
            return (
              <Fragment key={`hb-${i}`}>
                <text
                  bg="#4a4a5a"
                  content={prefix}
                  fg="#909090"
                  left={bp.boxLeft}
                  onMouseDown={onMouseDown}
                  position="absolute"
                  selectable={false}
                  top={botRow}
                />
                <text
                  bg={bg}
                  content={suffix}
                  fg={fg}
                  left={bp.boxLeft + prefix.length}
                  onMouseDown={onMouseDown}
                  position="absolute"
                  selectable={false}
                  top={botRow}
                />
              </Fragment>
            );
          })}
        </>
      );
    } else {
      // Only the expand button, right-aligned
      const expandBtnText = ` ${expandLabel} `;
      const expandRegionWidth = expandBtnText.length + 2; // button + 1-space padding each side
      const dashCount = Math.max(0, expandedInner - expandRegionWidth);
      let baseDashes = hDash.repeat(dashCount);
      if (scribbleActive) baseDashes = scribbleCycle(baseDashes, now);
      if (isDashed) baseDashes = punchDashedBorderGaps(baseDashes);

      const botBaseStr = cornerBL + baseDashes + " ".repeat(expandRegionWidth) + cornerBR;
      const expandPadLeft = bx + 1 + dashCount; // left padding space
      const expandBtnLeft = expandPadLeft + 1; // button text starts after left pad
      const expandPadRight = expandBtnLeft + expandBtnText.length; // right padding space

      // Anamorphic Equalizer elements (relative to box)
      const eqEls = eqActive
        ? (() => {
            const scannerColors = computeScannerColors(collapsedInner, scannerPhase);
            const scannerStartCol = bx + 1 + Math.max(0, Math.floor((expandedInner - collapsedInner) / 2));
            return scannerColors.map((c, i) => (
              <text
                bg={realBg}
                content="━"
                fg={c}
                key={`sc-${i}`}
                left={scannerStartCol + i}
                position="absolute"
                selectable={false}
                top={botRow}
              />
            ));
          })()
        : null;

      expandedBottomNode = (
        <>
          <text
            bg={realBg}
            content={botBaseStr}
            fg={borderColor}
            left={bx}
            position="absolute"
            selectable={false}
            top={botRow}
          />
          {eqEls}
          <text
            bg={realBg}
            content=" "
            fg={realBg}
            left={expandPadLeft}
            position="absolute"
            selectable={false}
            top={botRow}
          />
          <text
            bg={MUXOTRON_HINT_COLORS.dismiss}
            content={expandBtnText}
            fg={realBg}
            left={expandBtnLeft}
            position="absolute"
            selectable={false}
            top={botRow}
          />
          <text
            bg={realBg}
            content=" "
            fg={realBg}
            left={expandPadRight}
            position="absolute"
            selectable={false}
            top={botRow}
          />
        </>
      );
    }

    // Tool info for the interior
    const availStart = 1 + hmPad + hmW + 1;
    const availEnd = 1 + expandedInner - counterWidth;
    const availWidth = availEnd - availStart;
    const truncatedInfo =
      expandedToolInfo.length > availWidth ? expandedToolInfo.slice(0, availWidth - 1) + "…" : expandedToolInfo;
    const centeredLeft = availStart + Math.floor((availWidth - truncatedInfo.length) / 2);

    // When vertically expanded (zoom active + truncated/multiline), wrap tool info across extra rows.
    // Splits on real newlines first, then wraps each sub-line by width.
    // Compute ALL wrapped lines (for mouse-scroll support), then slice to visible window.
    // For pane capture mode, use the pre-stripped lines directly (already truncated).
    // Interactive mode renders a live terminal node instead of wrapped text.
    const allWrappedLines: string[] = [];
    if (!interactiveActive && clampedExtraLines > 0) {
      if (usePaneCapture) {
        for (const line of capturedPaneLines!) {
          allWrappedLines.push(line.length > wrapWidth ? line.slice(0, wrapWidth) : line);
        }
      } else {
        for (const sub of focusedToolInfo.split("\n")) {
          if (sub.length <= wrapWidth) {
            allWrappedLines.push(sub);
          } else {
            for (let i = 0; i < sub.length; i += wrapWidth) {
              allWrappedLines.push(sub.slice(i, i + wrapWidth));
            }
          }
        }
      }
    }
    // Scrollable window into allWrappedLines
    const maxScrollOffset = Math.max(0, allWrappedLines.length - clampedExtraLines);
    if (zoomScrollRef.current > maxScrollOffset) zoomScrollRef.current = maxScrollOffset;
    const scrollOffset = zoomScrollRef.current;
    const wrappedLines = allWrappedLines.slice(scrollOffset, scrollOffset + clampedExtraLines);
    // Ellipsis indicators for truncated content above/below
    if (scrollOffset + clampedExtraLines < allWrappedLines.length && wrappedLines.length > 0) {
      const last = wrappedLines[wrappedLines.length - 1]!;
      wrappedLines[wrappedLines.length - 1] = last.slice(0, -1) + "…";
    }
    if (scrollOffset > 0 && wrappedLines.length > 0) {
      wrappedLines[0] = "…" + wrappedLines[0]!.slice(1);
    }

    const sideBar = scribbleActive ? scribbleCycle(vBar, now) : vBar;

    return (
      <MuxotronExpandedView
        agentTerminalNode={interactiveActive ? agentTerminalNode : null}
        borderColor={borderColor}
        bottomNode={expandedBottomNode}
        bx={bx}
        centeredLeft={centeredLeft}
        counterDisplay={counterDisplay}
        counterStr={counterStr}
        expandedIl={expandedIl}
        expandedInner={expandedInner}
        expandedTopLineStr={expandedTopLineStr}
        expandedTopOverlays={expandedTopOverlays}
        expandedWidth={expandedWidth}
        hasAnyAgent={hasAnyAgent}
        hasUnansweredElsewhere={unansweredElsewhere}
        hmPad={hmPad}
        honeymuxState={honeymuxState}
        isDashed={isDashed}
        labelColor={labelColor}
        onInteractiveScrollSequence={interactiveActive ? onInteractiveScrollSequence : undefined}
        onMouseDown={
          onMuxotronClick && !interactiveActive
            ? (e: MouseEvent) => {
                e.stopPropagation();
                onMuxotronClick();
              }
            : undefined
        }
        onMouseScroll={
          !interactiveActive && allWrappedLines.length > clampedExtraLines
            ? (e: MouseEvent) => {
                e.stopPropagation();
                const delta = e.scroll?.direction === "up" ? -3 : 3;
                const next = Math.max(0, Math.min(maxScrollOffset, zoomScrollRef.current + delta));
                if (next !== zoomScrollRef.current) {
                  zoomScrollRef.current = next;
                  setTick((t) => t + 1);
                }
              }
            : undefined
        }
        realBg={realBg}
        sideBar={sideBar}
        sineWaveLastOutputTickAt={sineWaveLastOutputTickAt}
        terminalContentRows={interactiveActive ? clampedExtraLines : 0}
        totalHeight={totalHeight}
        truncatedInfo={truncatedInfo}
        wrappedLines={wrappedLines}
        zIndex={selectedSessionProp ? 22 : 12}
      />
    );
  }

  // Collapsed path — reset reported width so the tab bar uses normal overflow.
  if (reportedExpandedWidth !== 0) setReportedExpandedWidth(0);

  const topSplit = splitMuxotronBorderOverlays(topBorderStr, il);
  const topLineStr = isDashed ? punchDashedBorderGaps(topSplit.lineStr) : topSplit.lineStr;
  const topTextOverlays = topSplit.overlays;

  // Bottom border: Anamorphic Equalizer or normal (with optional label for marquee-bottom)
  let bottomBorderNode: ReactNode;
  if (eqActive) {
    // ┗ + per-cell colored ━ + ┛
    const scannerColors = computeScannerColors(inner, scannerPhase);
    bottomBorderNode = (
      <box flexDirection="row" height={1} left={il} position="absolute" top={2} width={muxotronEnabledWidth}>
        <text content="┗" fg={borderColor} selectable={false} />
        {scannerColors.map((c, i) => (
          <text content="━" fg={c} key={i} selectable={false} />
        ))}
        <text content="┛" fg={borderColor} selectable={false} />
      </box>
    );
  } else if (labelOnBottom) {
    const bottomBorderStr = buildMuxotronBorderStr({
      dash: hDash,
      inner,
      leftCorner: cornerBL,
      marqueeHints,
      rightCorner: cornerBR,
      showMarqueeHints,
      withLabel: true,
    });
    const botSplit = splitMuxotronBorderOverlays(bottomBorderStr, il);
    const botLineStr = isDashed ? punchDashedBorderGaps(botSplit.lineStr) : botSplit.lineStr;
    const botTextOverlays = botSplit.overlays;
    bottomBorderNode = (
      <>
        <text
          bg={isDashed ? realBg : undefined}
          content={botLineStr}
          fg={borderColor}
          left={il}
          position="absolute"
          selectable={false}
          top={2}
        />
        {botTextOverlays.map((ov, idx) => (
          <text
            bg={isDashed ? realBg : undefined}
            content={ov.content}
            fg={labelColor}
            key={`bot-ov-${idx}`}
            left={ov.left}
            position="absolute"
            selectable={false}
            top={2}
          />
        ))}
      </>
    );
  } else {
    const plainBottom = `${cornerBL}${hDash.repeat(inner)}${cornerBR}`;
    bottomBorderNode = (
      <text
        bg={isDashed ? realBg : undefined}
        content={isDashed ? punchDashedBorderGaps(plainBottom) : plainBottom}
        fg={borderColor}
        left={il}
        position="absolute"
        selectable={false}
        top={2}
      />
    );
  }

  return (
    <MuxotronCollapsedView
      agentsDialogOpen={agentsDialogOpen}
      borderColor={borderColor}
      bottomNode={bottomBorderNode}
      counterDisplay={counterDisplay}
      hasAnyAgent={hasAnyAgent}
      hasUnansweredElsewhere={unansweredElsewhere}
      hmPad={hmPad}
      hmW={hmW}
      honeymuxState={honeymuxState}
      il={il}
      infoCount={infoCount}
      inner={inner}
      isDashed={isDashed}
      isMarquee={isMarquee}
      labelColor={labelColor}
      marqueeToolInfo={marqueeToolInfo}
      onNotificationsClick={onNotificationsClick}
      realBg={realBg}
      showNoAgents={showNoAgents}
      sineWaveHasConnectedAgent={sineWaveHasConnectedAgent}
      sineWaveLastOutputTickAt={sineWaveLastOutputTickAt}
      topLineStr={topLineStr}
      topTextOverlays={topTextOverlays}
      vBar={vBar}
      warningCount={warningCount}
    />
  );
}
