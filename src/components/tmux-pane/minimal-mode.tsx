import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

import type { CodingAgentPaneActivity } from "../../agents/pane-activity.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { UIMode } from "../../util/config.ts";

import { Muxotron } from "../tab-bar.tsx";

interface TmuxPaneMinimalModeProps {
  activePaneId?: null | string;
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimGlow?: boolean;
  agentSessions?: AgentSession[];
  agentsDialogNode: ReactNode;
  agentsDialogOpen?: boolean;
  codingAgentActivity?: CodingAgentPaneActivity;
  configAgentsPreview?: null | string;
  height: number;
  infoCount?: number;
  onMuxotronClick?: () => void;
  onNotificationsClick?: () => void;
  overlayLayer?: ReactNode;
  rootOverlayNode?: ReactNode;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  terminalNode: ReactNode;
  uiMode: "marquee-bottom" | "marquee-top";
  warningCount?: number;
  width: number;
}

/**
 * Marquee mode: full-width muxotronEnabled (3 rows) + content (no border).
 * marquee-top: muxotronEnabled at top, content below.
 * marquee-bottom: content at top, muxotronEnabled at bottom.
 */
export function TmuxPaneMinimalMode({
  activePaneId,
  agentAlertAnimConfusables,
  agentAlertAnimGlow,
  agentSessions,
  agentsDialogNode,
  agentsDialogOpen,
  codingAgentActivity,
  configAgentsPreview,
  height,
  infoCount,
  onMuxotronClick,
  onNotificationsClick,
  overlayLayer,
  rootOverlayNode,
  sidebarOpen,
  sidebarWidth,
  terminalNode,
  uiMode,
  warningCount,
  width,
}: TmuxPaneMinimalModeProps) {
  const muxotronEnabledProps = {
    activePaneId,
    agentAlertAnimConfusables,
    agentAlertAnimGlow,
    agentSessions: agentSessions ?? [],
    codingAgentActivity,
    configAgentsPreview,
    expanded: agentsDialogOpen,
    infoCount,
    onNotificationsClick,
    uiMode: uiMode as UIMode,
    warningCount,
    width,
  };

  const muxotronEnabledArea = (
    <box
      height={3}
      key="muxotronEnabled"
      onMouseDown={(event: MouseEvent) => {
        if (event.button !== 0) return;
        const mid = Math.floor(width / 2);
        if (event.x < mid) {
          if ((warningCount && warningCount > 0) || (infoCount && infoCount > 0)) onNotificationsClick?.();
        } else {
          onMuxotronClick?.();
        }
      }}
      selectable={false}
      width="100%"
    >
      <Muxotron {...muxotronEnabledProps} />
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
      {isBottom ? contentArea : muxotronEnabledArea}
      {isBottom ? muxotronEnabledArea : contentArea}
      {rootOverlayNode}
      {agentsDialogNode}
      {overlayLayer}
    </box>
  );
}
