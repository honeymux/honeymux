import type { MutableRefObject } from "react";

import type { AgentProviderRegistry } from "../agents/provider.ts";
import type { AgentSession } from "../agents/types.ts";

import { theme } from "../themes/theme.ts";
import { centerToWidth, stringWidth } from "../util/text.ts";
import { AgentTree } from "./agent-tree.tsx";

interface AgentsZoomOverlayProps {
  agentSessions: AgentSession[];
  height: number;
  onSessionSelect?: (session: AgentSession) => void;
  registryRef?: MutableRefObject<AgentProviderRegistry | null>;
  /** Rows reserved at the top for the tab bar (3 for adaptive/marquee-top, 0 for raw/marquee-bottom). */
  topOffset?: number;
  width: number;
}

export function AgentsZoomOverlay({
  agentSessions,
  height,
  onSessionSelect,
  registryRef,
  topOffset = 0,
  width,
}: AgentsZoomOverlayProps) {
  const contentHeight = height - topOffset;
  const activeSessions = agentSessions.filter((s) => s.status !== "ended");
  const contentWidth = Math.max(10, width - 2); // 1-col padding each side

  // Header: row 1 is the connected-count label, row 2 is a labeled separator.
  const countLabel = `${activeSessions.length} agent${activeSessions.length === 1 ? "" : "s"} connected`;
  const countLine = centerToWidth(countLabel, contentWidth);

  const metricsLabel = " {{ placeholder for global agent metrics }} ";
  const metricsLabelWidth = stringWidth(metricsLabel);
  const dashSpace = Math.max(0, contentWidth - metricsLabelWidth);
  const leftDashes = Math.floor(dashSpace / 2);
  const rightDashes = dashSpace - leftDashes;
  const separatorLine = "\u2500".repeat(leftDashes) + metricsLabel + "\u2500".repeat(rightDashes);

  return (
    <>
      {/* Backdrop */}
      <box
        backgroundColor={theme.bgSurface}
        height={contentHeight}
        left={0}
        position="absolute"
        top={topOffset}
        width="100%"
        zIndex={19}
      />
      {/* Content */}
      <box
        flexDirection="column"
        height={contentHeight}
        id="honeyshots:agents-zoom"
        left={0}
        position="absolute"
        top={topOffset}
        width={width}
        zIndex={20}
      >
        {/* Header: connected-count row */}
        <box flexDirection="row" height={1} width={width}>
          <text content={" " + countLine + " "} fg={theme.textSecondary} />
        </box>
        {/* Header: labeled separator row */}
        <box flexDirection="row" height={1} width={width}>
          <text content={" " + separatorLine + " "} fg={theme.textSecondary} />
        </box>
        {/* Agent tree */}
        {activeSessions.length > 0 ? (
          <AgentTree
            height={contentHeight - 2}
            onSelect={(session) => onSessionSelect?.(session)}
            registryRef={registryRef}
            sessions={activeSessions}
            width={width}
          />
        ) : (
          <text content={" No active agents".padEnd(contentWidth)} fg={theme.textDim} />
        )}
      </box>
    </>
  );
}
