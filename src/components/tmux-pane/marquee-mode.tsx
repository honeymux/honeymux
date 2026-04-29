import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

import type { CodingAgentPaneActivity } from "../../agents/pane-activity.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { UIMode } from "../../util/config.ts";

import { Muxotron } from "../tab-bar.tsx";
import { getMuxotronClickZone } from "../tab-bar/use-tab-bar-interactions.ts";

interface TmuxPaneMarqueeModeProps {
  activePaneId?: null | string;
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
  agentTerminalNode?: ReactNode;
  agentsDialogOpen?: boolean;
  capturedPaneLines?: null | string[];
  codingAgentActivity?: CodingAgentPaneActivity;
  configAgentsPreview?: null | string;
  height: number;
  infoCount?: number;
  interactiveAgent?: AgentSession | null;
  muxotronExpanded?: boolean;
  muxotronFocusActive?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  onGoto?: () => void;
  onInteractiveScrollSequence?: (sequence: string) => void;
  onMuxotronClick?: () => void;
  onNextAgent?: () => void;
  onNotificationsClick?: () => void;
  onPrevAgent?: () => void;
  onReviewLatchToggle?: () => void;
  overlayLayer?: ReactNode;
  reviewLatched?: boolean;
  selectedSession?: AgentSession | null;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  termHeight?: number;
  terminalNode: ReactNode;
  uiMode: "marquee-bottom" | "marquee-top";
  warningCount?: number;
  width: number;
}

/**
 * Marquee mode: full-width muxotron (3 rows) + content (no border).
 * marquee-top: muxotron at top, content below.
 * marquee-bottom: content at top, muxotron at bottom.
 */
export function TmuxPaneMarqueeMode({
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
  capturedPaneLines,
  codingAgentActivity,
  configAgentsPreview,
  height,
  infoCount,
  interactiveAgent,
  muxotronExpanded,
  muxotronFocusActive,
  onApprove,
  onDeny,
  onDismiss,
  onGoto,
  onInteractiveScrollSequence,
  onMuxotronClick,
  onNextAgent,
  onNotificationsClick,
  onPrevAgent,
  onReviewLatchToggle,
  overlayLayer,
  reviewLatched,
  selectedSession,
  sidebarOpen,
  sidebarWidth,
  termHeight,
  terminalNode,
  uiMode,
  warningCount,
  width,
}: TmuxPaneMarqueeModeProps) {
  const muxotronProps = {
    activePaneId,
    agentAlertAnimConfusables,
    agentAlertAnimCycleCount,
    agentAlertAnimDelay,
    agentAlertAnimEqualizer,
    agentAlertAnimGlow,
    agentAlertAnimScribble,
    agentLatchBindingLabel,
    agentSessions: agentSessions ?? [],
    agentTermCols,
    agentTermRows,
    agentTerminalNode,
    agentsDialogOpen,
    capturedPaneLines,
    codingAgentActivity,
    configAgentsPreview,
    infoCount,
    interactiveAgent,
    muxotronExpanded,
    muxotronFocusActive,
    onApprove,
    onDeny,
    onDismiss,
    onGoto,
    onInteractiveScrollSequence,
    onMuxotronClick,
    onNextAgent,
    onNotificationsClick,
    onPrevAgent,
    onReviewLatchToggle,
    reviewLatched,
    selectedSession,
    termHeight,
    uiMode: uiMode as UIMode,
    warningCount,
    width,
  };

  // Collapsed muxotron lives inline in the 3-row strip; expanded muxotron is
  // rendered as a sibling overlay outside the strip so its absolute layout
  // and zIndex can stack above the terminal (which otherwise paints on top
  // of later flex children). Mirrors the tab-bar pattern for adaptive mode.
  const muxotronArea = (
    <box
      height={3}
      key="muxotron"
      onMouseDown={(event: MouseEvent) => {
        if (event.button !== 0) return;
        const zone = getMuxotronClickZone(width, width, event.x);
        if (zone === "notifications") {
          if ((warningCount && warningCount > 0) || (infoCount && infoCount > 0)) onNotificationsClick?.();
        } else if (zone === "agents") {
          onMuxotronClick?.();
        }
      }}
      selectable={false}
      width="100%"
    >
      {!muxotronExpanded && <Muxotron {...muxotronProps} muxotronExpanded={false} />}
    </box>
  );
  const padLeft = sidebarOpen && sidebarWidth ? sidebarWidth + 1 : 0;
  const contentArea = (
    <box flexDirection="column" flexGrow={1} key="content" paddingLeft={padLeft} width="100%">
      {terminalNode}
    </box>
  );

  const isBottom = uiMode === "marquee-bottom";

  return (
    <box flexDirection="column" height={height} width={width}>
      {isBottom ? contentArea : muxotronArea}
      {isBottom ? muxotronArea : contentArea}
      {/* Keyed by uiMode so switching marquee-top↔marquee-bottom remounts the
          absolute overlay. Without this, the overlay's subtree reuses its prior
          render cache and leaves stale cells at its old anchor (top vs
          bottom-anchored) during the switch. */}
      {muxotronExpanded && <Muxotron key={`expanded-${uiMode}`} {...muxotronProps} muxotronExpanded={true} />}
      {overlayLayer}
    </box>
  );
}
