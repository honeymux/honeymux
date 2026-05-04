import { useCallback, useEffect, useRef, useState } from "react";

import type { CodingAgentPaneActivity } from "../agents/pane-activity.ts";
import type { AgentSession } from "../agents/types.ts";
import type { TmuxSession, TmuxWindow } from "../tmux/types.ts";
import type { UIMode } from "../util/config.ts";

import { SESSION_PALETTE, isBright, theme } from "../themes/theme.ts";
import { isMarqueeMode } from "../util/config.ts";
import { stringWidth } from "../util/text.ts";
import { HotkeyHint } from "./hotkey-hint.tsx";
import { Muxotron } from "./tab-bar/muxotron.tsx";
import { TabBarMenus } from "./tab-bar/tab-bar-menus.tsx";
import { buildTabBarModel } from "./tab-bar/tab-bar-model.ts";
import {
  tabIndexFromXWithTolerance,
  useTabBarDragState,
  useTabBarInteractions,
} from "./tab-bar/use-tab-bar-interactions.ts";
import { useTabBarMenus } from "./tab-bar/use-tab-bar-menus.ts";

export { computeOverflow } from "./tab-bar/layout.ts";
export { Muxotron } from "./tab-bar/muxotron.tsx";

// The new-window button: just the glyph with padding, no tab border
const PLUS_GLYPH = " ✚ ";
interface TabBarProps {
  activeIndex: number;
  activePaneId?: null | string;
  activeWindowIdDisplayEnabled?: boolean;
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimCycleCount?: number;
  agentAlertAnimDelay?: number;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  agentLatchBindingLabel?: string;
  agentSessions?: AgentSession[];
  agentTermCols?: number;
  agentTermRows?: number;
  agentTerminalNode?: React.ReactNode;
  agentsDialogOpen?: boolean;
  badgeColor?: string;
  capturedPaneLines?: null | string[];
  codingAgentActivity?: CodingAgentPaneActivity;
  color?: string;
  configAgentsPreview?: null | string;
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  expandedMuxotronWidth?: number;
  hint?: null | string;
  infoCount?: number;
  interactiveAgent?: AgentSession | null;
  layoutDropdownOpen?: boolean;
  mainMenuBindingLabel?: string;
  muxotronEnabled?: boolean;
  muxotronExpanded?: boolean;
  muxotronFocusActive?: boolean;
  onApprove?: () => void;
  onCloseWindow?: (index: number) => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  onDragChange?: (dragging: boolean) => void;
  onExpandedWidthChange?: (width: number) => void;
  onGoto?: () => void;
  onInteractiveScrollSequence?: (sequence: string) => void;
  onLayoutProfileClick?: () => void;
  onMoveWindowToSession?: (index: number, targetSession: string) => void;
  onMuxotronClick?: () => void;
  onNewWindow?: () => void;
  onNextAgent?: () => void;
  onNotificationsClick?: () => void;
  onOpenMainMenu?: () => void;
  onOverflowOpen?: () => void;
  onPrevAgent?: () => void;
  onReviewLatchToggle?: () => void;
  onSessionClick?: () => void;
  onSidebarToggle?: () => void;
  onTabClick?: (index: number) => void;
  onTabRename?: (index: number, newName: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onTextInputActive?: (active: boolean) => void;
  onToolbarToggle?: () => void;
  reviewLatched?: boolean;
  selectedSession?: import("../agents/types.ts").AgentSession | null;
  sessionName?: string;
  sessions?: TmuxSession[];
  shineColors?: string[];
  sidebarOpen?: boolean;
  tabDragEndRef?: React.MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef?: React.MutableRefObject<((x: number) => void) | null>;
  tabRightClickRef?: React.MutableRefObject<((x: number) => void) | null>;
  termHeight?: number;
  textInputEscapeHandlerRef?: React.MutableRefObject<(() => void) | null>;
  tmuxKeyBindingHint?: null | string;
  toolbarOpen?: boolean;
  toolbarToggleChar?: string;
  uiMode?: UIMode;
  warningCount?: number;
  width: number;
  windows: TmuxWindow[];
}

export function TabBar({
  activeIndex,
  activePaneId,
  activeWindowIdDisplayEnabled,
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
  badgeColor,
  capturedPaneLines,
  codingAgentActivity,
  color,
  configAgentsPreview,
  dropdownInputRef,
  expandedMuxotronWidth: expandedMuxotronWidthProp,
  hint,
  infoCount,
  interactiveAgent,
  layoutDropdownOpen,
  mainMenuBindingLabel,
  muxotronEnabled: muxotronEnabledProp,
  muxotronExpanded,
  muxotronFocusActive,
  onApprove,
  onCloseWindow,
  onDeny,
  onDismiss,
  onDragChange,
  onExpandedWidthChange,
  onGoto,
  onInteractiveScrollSequence,
  onLayoutProfileClick,
  onMoveWindowToSession,
  onMuxotronClick,
  onNewWindow,
  onNextAgent,
  onNotificationsClick,
  onOpenMainMenu,
  onOverflowOpen,
  onPrevAgent,
  onReviewLatchToggle,
  onSessionClick,
  onSidebarToggle,
  onTabClick,
  onTabRename,
  onTabReorder,
  onTextInputActive,
  onToolbarToggle,
  reviewLatched,
  selectedSession,
  sessionName,
  sessions,
  shineColors,
  sidebarOpen,
  tabDragEndRef,
  tabDragMoveRef,
  tabRightClickRef,
  termHeight,
  textInputEscapeHandlerRef,
  tmuxKeyBindingHint,
  toolbarOpen,
  toolbarToggleChar,
  uiMode: uiModeProp,
  warningCount,
  width,
  windows,
}: TabBarProps) {
  const fg = color ?? theme.accent;
  const dragState = useTabBarDragState();
  const { dragFrom, dragOver, dragX } = dragState;

  // Scribble activates only when enabled AND an agent is unanswered (or config preview)
  // When muxotronEnabled is expanded, scribble is handled by the muxotronEnabled component, not the tab bar
  const hasUnanswered = (agentSessions ?? []).some((s) => s.status === "unanswered");
  const uiMode = uiModeProp ?? "adaptive";

  // Animation suppression: zooming an agent notification permanently suppresses
  // animations until the next new unanswered notification arrives.
  const animsSuppressedRef = useRef(false);
  const prevMuxotronFocusActiveRef = useRef(false);
  const prevUnansweredCountRef = useRef(0);
  const unansweredCount = (agentSessions ?? []).filter((s) => s.status === "unanswered").length;
  // Suppress on zoom start (rising edge) when there's an active notification
  if (muxotronFocusActive && !prevMuxotronFocusActiveRef.current && hasUnanswered) {
    animsSuppressedRef.current = true;
  }
  prevMuxotronFocusActiveRef.current = !!muxotronFocusActive;
  // Clear suppression when a new unanswered notification arrives (count increases)
  if (unansweredCount > prevUnansweredCountRef.current) {
    animsSuppressedRef.current = false;
  }
  prevUnansweredCountRef.current = unansweredCount;

  const animsOff = animsSuppressedRef.current;

  // --- tmux key binding hint fade state ---
  const TMUX_KEY_BINDING_HINT_STEP_MS = 166;
  const [tmuxKeyBindingHintDisplay, setTmuxKeyBindingHintDisplay] = useState<null | string>(null);
  const [tmuxKeyBindingHintColorIdx, setTmuxKeyBindingHintColorIdx] = useState(0);
  const tmuxKeyBindingHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tmuxKeyBindingHintStepRef = useRef(0);
  const tmuxKeyBindingHintMountedRef = useRef(false);

  useEffect(() => {
    if (!tmuxKeyBindingHintMountedRef.current) {
      tmuxKeyBindingHintMountedRef.current = true;
      return;
    }
    if (!tmuxKeyBindingHint) return;
    const text =
      tmuxKeyBindingHint.indexOf("\0") >= 0
        ? tmuxKeyBindingHint.slice(0, tmuxKeyBindingHint.indexOf("\0"))
        : tmuxKeyBindingHint;
    setTmuxKeyBindingHintDisplay(text);
    setTmuxKeyBindingHintColorIdx(0);
    tmuxKeyBindingHintStepRef.current = 0;
    if (tmuxKeyBindingHintTimerRef.current) clearTimeout(tmuxKeyBindingHintTimerRef.current);
    const tick = () => {
      tmuxKeyBindingHintStepRef.current++;
      if (tmuxKeyBindingHintStepRef.current >= theme.hintFadeSequence.length) {
        setTmuxKeyBindingHintDisplay(null);
        return;
      }
      setTmuxKeyBindingHintColorIdx(tmuxKeyBindingHintStepRef.current);
      tmuxKeyBindingHintTimerRef.current = setTimeout(tick, TMUX_KEY_BINDING_HINT_STEP_MS);
    };
    tmuxKeyBindingHintTimerRef.current = setTimeout(tick, TMUX_KEY_BINDING_HINT_STEP_MS);
    return () => {
      if (tmuxKeyBindingHintTimerRef.current) clearTimeout(tmuxKeyBindingHintTimerRef.current);
    };
  }, [tmuxKeyBindingHint]);

  useEffect(() => {
    return () => {
      if (tmuxKeyBindingHintTimerRef.current) clearTimeout(tmuxKeyBindingHintTimerRef.current);
    };
  }, []);

  const MIN_HINT_WIDTH = 10; // minimum space (including 2 padding) to show hint
  const model = buildTabBarModel({
    activeIndex,
    activeWindowIdDisplayEnabled,
    dragFrom,
    dragOver,
    dragX,
    expandedMuxotronWidth: expandedMuxotronWidthProp ?? 0,
    hasLayoutProfileClick: !!onLayoutProfileClick,
    hasNewWindow: !!onNewWindow,
    hasSidebarToggle: !!onSidebarToggle,
    hasToolbarToggle: !!onToolbarToggle,
    muxotronEnabledProp,
    muxotronExpanded,
    sessionName,
    uiMode,
    width,
    windows,
  });
  const {
    activeHiddenInOverflow,
    badgeLabel,
    badgeWidth,
    bot,
    displayNames,
    hasOverflow,
    hintGap,
    maxExpandedWidth,
    mid,
    midSegments,
    muxotronEnabled,
    muxotronLeft,
    muxotronRight,
    muxotronWidth,
    overflowIndicatorWidth,
    overflowLabel,
    overflowStartX,
    plusStartX,
    showId,
    sidebarReserve,
    tabsEndX,
    toolbarIconReserve,
    toolbarReserve,
    top,
    visibleCount,
    visibleWindows,
    windowDisplayNames,
  } = model;

  const resolveContextMenuIndexFromX = useCallback(
    (x: number) => {
      if (sidebarReserve > 0 && x - 1 < sidebarReserve) return -1;
      const tabWindows = hasOverflow ? visibleWindows : windows;
      return tabIndexFromXWithTolerance(tabWindows, x - 1, activeIndex, showId, sidebarReserve, displayNames);
    },
    [activeIndex, displayNames, hasOverflow, showId, sidebarReserve, visibleWindows, windows],
  );

  const {
    closeContextMenu,
    closeRenameEditor,
    contextMenuFocused,
    contextMenuIndex,
    contextMenuItems,
    contextMenuMode,
    handleContextMenuSelect,
    handleMoveSessionSelect,
    moveMenuFocused,
    openContextMenu,
    otherSessions,
    renameDropdownWidth,
    renameIndex,
    renameInitialName,
    renameInputRef,
    renameItemWidth,
    renameWindowId,
    submitRename,
  } = useTabBarMenus({
    dropdownInputRef,
    hasOverflow,
    onCloseWindow,
    onMoveWindowToSession,
    onTabRename,
    onTextInputActive,
    resolveTabIndexFromX: resolveContextMenuIndexFromX,
    sessionName,
    sessions,
    tabRightClickRef,
    textInputEscapeHandlerRef,
    visibleCount,
    width,
    windows,
  });

  const {
    handleBadgeMouseDown,
    handleLayoutProfileMouseDown,
    handleSidebarMouseDown,
    handleTabMouseDown,
    handleToolbarMouseDown,
  } = useTabBarInteractions({
    activeIndex,
    closeContextMenu,
    closeRenameEditor,
    contextMenuIndex,
    displayNames,
    dragState,
    hasOverflow,
    infoCount,
    muxotronWidth,
    onDragChange,
    onLayoutProfileClick,
    onMuxotronClick,
    onNewWindow,
    onNotificationsClick,
    onOverflowOpen,
    onSessionClick,
    onSidebarToggle,
    onTabClick,
    onTabReorder,
    onToolbarToggle,
    openContextMenu,
    overflowIndicatorWidth,
    overflowStartX,
    plusStartX,
    renameWindowId,
    showId,
    sidebarReserve,
    tabDragEndRef,
    tabDragMoveRef,
    visibleWindows,
    warningCount,
    width,
    windowDisplayNames,
    windows,
  });

  return (
    <>
      <box
        flexDirection="column"
        height={3}
        id="honeyshots:tab-bar"
        onMouseDown={handleTabMouseDown}
        selectable={false}
        width="100%"
      >
        <text content={top} fg={fg} selectable={false} />
        {midSegments ? (
          <box flexDirection="row" height={1} selectable={false} width="100%">
            <text content={midSegments[0]} fg={fg} selectable={false} />
            <text content={midSegments[1]} fg={theme.textDim} selectable={false} />
            <text content={midSegments[2]} fg={fg} selectable={false} />
          </box>
        ) : (
          <text content={mid} fg={fg} selectable={false} />
        )}
        {shineColors ? (
          <box flexDirection="row" height={1} selectable={false} width="100%">
            {[...bot].map((char, i) => (
              <text content={char} fg={shineColors[i] ?? fg} key={i} selectable={false} />
            ))}
          </box>
        ) : (
          <text content={bot} fg={fg} selectable={false} />
        )}
        {badgeLabel && (
          <box
            flexDirection="column"
            height={3}
            onMouseDown={handleBadgeMouseDown}
            position="absolute"
            right={toolbarReserve + 2}
            selectable={false}
            top={0}
            width={badgeWidth}
            zIndex={muxotronExpanded ? 13 : undefined}
          >
            <text content={"▄".repeat(badgeWidth)} fg={badgeColor ?? SESSION_PALETTE[0]} selectable={false} />
            <text
              bg={badgeColor ?? SESSION_PALETTE[0]}
              content={badgeLabel}
              fg={isBright(badgeColor ?? SESSION_PALETTE[0]!) ? theme.textOnBright : theme.textBright}
              selectable={false}
            />
            <text content={"▀".repeat(badgeWidth)} fg={badgeColor ?? SESSION_PALETTE[0]} selectable={false} />
          </box>
        )}
        {onLayoutProfileClick && (
          <box
            height={1}
            onMouseDown={handleLayoutProfileMouseDown}
            position="absolute"
            right={toolbarIconReserve + 1}
            selectable={false}
            top={1}
            width={3}
          >
            <text
              bg={layoutDropdownOpen ? fg : undefined}
              content={` ⌗ `}
              fg={layoutDropdownOpen ? theme.bgSurface : fg}
              left={0}
              selectable={false}
            />
          </box>
        )}
        {onToolbarToggle && (
          <box
            height={1}
            onMouseDown={handleToolbarMouseDown}
            position="absolute"
            right={0}
            selectable={false}
            top={1}
            width={3}
          >
            <text
              bg={toolbarOpen ? fg : undefined}
              content={` ${toolbarToggleChar ?? "⚒"} `}
              fg={toolbarOpen ? theme.bgSurface : fg}
              left={0}
              selectable={false}
            />
          </box>
        )}
        {(onToolbarToggle || onLayoutProfileClick) && (
          <text
            content={"─".repeat(toolbarReserve + 1)}
            fg={fg}
            position="absolute"
            right={0}
            selectable={false}
            top={2}
          />
        )}
        {onSidebarToggle && (
          <box
            height={1}
            left={0}
            onMouseDown={handleSidebarMouseDown}
            position="absolute"
            selectable={false}
            top={1}
            width={2}
          >
            <text content={`${sidebarOpen ? "\u25E7" : "\u25E8"} `} fg={fg} left={0} selectable={false} />
          </box>
        )}
        {onSidebarToggle && (
          <text content={"─".repeat(sidebarReserve)} fg={fg} left={0} position="absolute" selectable={false} top={2} />
        )}
        {onNewWindow && plusStartX >= 0 && (
          <text
            content={PLUS_GLYPH}
            fg={theme.textPlus}
            left={plusStartX}
            position="absolute"
            selectable={false}
            top={1}
          />
        )}
        {hasOverflow &&
          overflowStartX >= 0 &&
          (() => {
            const oColor = activeHiddenInOverflow ? fg : theme.textSecondary;
            const topLine = "╭" + "─".repeat(overflowLabel.length + 2) + "╮";
            const midLine = "│ " + overflowLabel + " │";
            return (
              <>
                <text
                  content={topLine}
                  fg={oColor}
                  left={overflowStartX}
                  position="absolute"
                  selectable={false}
                  top={0}
                />
                <text
                  content={midLine}
                  fg={oColor}
                  left={overflowStartX}
                  position="absolute"
                  selectable={false}
                  top={1}
                />
              </>
            );
          })()}
        {muxotronEnabled && !muxotronExpanded && (
          <Muxotron
            activePaneId={activePaneId}
            agentAlertAnimConfusables={
              configAgentsPreview === "agentAlertAnimConfusables" ||
              (isMarqueeMode(uiMode) && !animsOff ? agentAlertAnimConfusables : false)
            }
            agentAlertAnimCycleCount={agentAlertAnimCycleCount}
            agentAlertAnimDelay={agentAlertAnimDelay}
            agentAlertAnimEqualizer={
              configAgentsPreview === "agentAlertAnimEqualizer" ||
              (isMarqueeMode(uiMode) && !animsOff ? agentAlertAnimEqualizer : false)
            }
            agentAlertAnimGlow={
              configAgentsPreview === "agentAlertAnimGlow" ||
              (isMarqueeMode(uiMode) && !animsOff ? agentAlertAnimGlow : false)
            }
            agentAlertAnimScribble={
              configAgentsPreview === "agentAlertAnimScribble" ||
              (isMarqueeMode(uiMode) && !animsOff ? agentAlertAnimScribble : false)
            }
            agentLatchBindingLabel={agentLatchBindingLabel}
            agentSessions={agentSessions ?? []}
            agentsDialogOpen={agentsDialogOpen}
            capturedPaneLines={capturedPaneLines}
            codingAgentActivity={codingAgentActivity}
            configAgentsPreview={configAgentsPreview}
            infoCount={infoCount}
            muxotronExpanded={false}
            muxotronFocusActive={muxotronFocusActive}
            onApprove={onApprove}
            onDeny={onDeny}
            onDismiss={onDismiss}
            onGoto={onGoto}
            onNextAgent={onNextAgent}
            onNotificationsClick={onNotificationsClick}
            onPrevAgent={onPrevAgent}
            onReviewLatchToggle={onReviewLatchToggle}
            reviewLatched={reviewLatched}
            selectedSession={selectedSession}
            termHeight={termHeight}
            uiMode={uiMode}
            warningCount={warningCount}
            width={width}
          />
        )}
        {hintGap >= MIN_HINT_WIDTH &&
          !muxotronExpanded &&
          (() => {
            const idleContent = `${mainMenuBindingLabel || "ctrl+g"} = main menu`;
            // The HotkeyHint box spans [muxotronRight, muxotronRight + hintGap),
            // but the text is centered inside it — only the centered text is opaque.
            // Tabs may freely overlap the empty padding to either side of the text,
            // so hide the hint only once tabs would actually reach the text glyphs.
            const hintTextLeft = muxotronRight + Math.floor((hintGap - stringWidth(idleContent)) / 2);
            if (tabsEndX > hintTextLeft) return null;
            const idleFg = undefined;
            const idleBg = undefined;
            return (
              <HotkeyHint
                align="center"
                colorMode="fg"
                hint={hint ?? null}
                idleBg={idleBg}
                idleBold={true}
                idleContent={idleContent}
                idleFg={idleFg}
                left={muxotronRight}
                onIdleClick={onOpenMainMenu}
                shimmer={false}
                top={1}
                width={hintGap}
              />
            );
          })()}
        {tmuxKeyBindingHintDisplay &&
          !muxotronExpanded &&
          (() => {
            const hintContent = ` ${tmuxKeyBindingHintDisplay} `;
            const hintWidth = stringWidth(hintContent);
            const gap = muxotronLeft - tabsEndX;
            if (gap < hintWidth + 1) return null;
            const hintLeft = tabsEndX + 1;
            const color =
              theme.hintFadeSequence[tmuxKeyBindingHintColorIdx] ??
              theme.hintFadeSequence[theme.hintFadeSequence.length - 1]!;
            return (
              <text
                bg={color}
                content={hintContent}
                fg={theme.textOnBright}
                left={hintLeft}
                position="absolute"
                selectable={false}
                top={1}
                width={hintWidth}
              />
            );
          })()}
      </box>
      {muxotronEnabled && muxotronExpanded && (
        <Muxotron
          activePaneId={activePaneId}
          agentAlertAnimConfusables={
            configAgentsPreview === "agentAlertAnimConfusables" || (!animsOff && agentAlertAnimConfusables)
          }
          agentAlertAnimCycleCount={agentAlertAnimCycleCount}
          agentAlertAnimDelay={agentAlertAnimDelay}
          agentAlertAnimEqualizer={
            configAgentsPreview === "agentAlertAnimEqualizer" || (!animsOff && agentAlertAnimEqualizer)
          }
          agentAlertAnimGlow={configAgentsPreview === "agentAlertAnimGlow" || (!animsOff && agentAlertAnimGlow)}
          agentAlertAnimScribble={
            configAgentsPreview === "agentAlertAnimScribble" || (!animsOff && agentAlertAnimScribble)
          }
          agentLatchBindingLabel={agentLatchBindingLabel}
          agentSessions={agentSessions ?? []}
          agentTermCols={agentTermCols}
          agentTermRows={agentTermRows}
          agentTerminalNode={agentTerminalNode}
          agentsDialogOpen={agentsDialogOpen}
          capturedPaneLines={capturedPaneLines}
          codingAgentActivity={codingAgentActivity}
          configAgentsPreview={configAgentsPreview}
          infoCount={infoCount}
          interactiveAgent={interactiveAgent}
          maxExpandedWidth={maxExpandedWidth}
          muxotronExpanded={true}
          muxotronFocusActive={muxotronFocusActive}
          onApprove={onApprove}
          onDeny={onDeny}
          onDismiss={onDismiss}
          onExpandedWidthChange={onExpandedWidthChange}
          onGoto={onGoto}
          onInteractiveScrollSequence={onInteractiveScrollSequence}
          onMuxotronClick={onMuxotronClick}
          onNextAgent={onNextAgent}
          onNotificationsClick={onNotificationsClick}
          onPrevAgent={onPrevAgent}
          onReviewLatchToggle={onReviewLatchToggle}
          reviewLatched={reviewLatched}
          selectedSession={selectedSession}
          termHeight={termHeight}
          uiMode={uiMode}
          warningCount={warningCount}
          width={width}
        />
      )}
      <TabBarMenus
        activeIndex={activeIndex}
        closeContextMenu={closeContextMenu}
        closeRenameEditor={closeRenameEditor}
        contextMenuFocused={contextMenuFocused}
        contextMenuIndex={contextMenuIndex}
        contextMenuItems={contextMenuItems}
        contextMenuMode={contextMenuMode}
        displayNames={displayNames}
        handleContextMenuSelect={handleContextMenuSelect}
        handleMoveSessionSelect={handleMoveSessionSelect}
        moveMenuFocused={moveMenuFocused}
        otherSessions={otherSessions}
        renameDropdownWidth={renameDropdownWidth}
        renameIndex={renameIndex}
        renameInitialName={renameInitialName}
        renameInputRef={renameInputRef}
        renameItemWidth={renameItemWidth}
        renameWindowId={renameWindowId}
        showId={showId}
        sidebarReserve={sidebarReserve}
        submitRename={submitRename}
        width={width}
        windows={windows}
      />
    </>
  );
}
