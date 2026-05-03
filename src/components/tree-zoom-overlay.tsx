import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PaneTabGroup } from "../app/pane-tabs/types.ts";
import type { TmuxControlClient } from "../tmux/control-client.ts";

import { theme } from "../themes/theme.ts";
import { ServerTree } from "./server-tree.tsx";

interface TreeCounts {
  paneTabsEnabled: number;
  panes: number;
  sessions: number;
  windows: number;
}

interface TreeZoomOverlayProps {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  currentSessionName: string;
  height: number;
  onNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  onSwitchPaneTab?: (slotKey: string, tabIndex: number) => void;
  paneTabGroups: Map<string, PaneTabGroup>;
  /** Rows reserved at the top for the tab bar (3 for adaptive/marquee-top, 0 for raw/marquee-bottom). */
  topOffset?: number;
  width: number;
}

export function TreeZoomOverlay({
  clientRef,
  currentSessionName,
  height,
  onNavigate,
  onSwitchPaneTab,
  paneTabGroups,
  topOffset = 0,
  width,
}: TreeZoomOverlayProps) {
  const contentHeight = height - topOffset;
  const [counts, setCounts] = useState<TreeCounts>({ paneTabsEnabled: 0, panes: 0, sessions: 0, windows: 0 });
  const [clientCount, setClientCount] = useState(0);
  const mountedRef = useRef(true);

  // Fetch connected client count
  useEffect(() => {
    mountedRef.current = true;
    const fetch = async () => {
      const client = clientRef.current;
      if (!client) return;
      try {
        const clients = await client.listClients();
        if (mountedRef.current) setClientCount(clients.filter((c) => !c.controlMode).length);
      } catch {
        // client may be closed
      }
    };
    fetch();
    const id = setInterval(fetch, 2000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [clientRef]);

  const handleCountsChange = useCallback((next: TreeCounts) => {
    setCounts((prev) => {
      if (
        prev.sessions === next.sessions &&
        prev.windows === next.windows &&
        prev.panes === next.panes &&
        prev.paneTabsEnabled === next.paneTabsEnabled
      )
        return prev;
      return next;
    });
  }, []);

  // Build client count line
  const clientLine = `${clientCount} client${clientCount !== 1 ? "s" : ""} connected`;
  const contentWidth = Math.max(10, width - 2);

  // Build layout counts line
  const parts: string[] = [];
  parts.push(`${counts.sessions} session${counts.sessions !== 1 ? "s" : ""}`);
  parts.push(`${counts.windows} window${counts.windows !== 1 ? "s" : ""}`);
  parts.push(`${counts.panes} pane${counts.panes !== 1 ? "s" : ""}`);
  if (counts.paneTabsEnabled > 0) {
    parts.push(`${counts.paneTabsEnabled} pane tab${counts.paneTabsEnabled !== 1 ? "s" : ""}`);
  }
  const headerLabel = ` ${parts.join(", ")} `;
  const dashSpace = Math.max(0, contentWidth - headerLabel.length);
  const leftDashes = Math.floor(dashSpace / 2);
  const rightDashes = dashSpace - leftDashes;
  const headerLine = "─".repeat(leftDashes) + headerLabel + "─".repeat(rightDashes);

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
        id="honeyshots:tree-zoom"
        left={0}
        position="absolute"
        top={topOffset}
        width={width}
        zIndex={20}
      >
        {/* Client count */}
        <box flexDirection="row" height={1} justifyContent="center" width={width}>
          <text content={clientLine} fg={theme.textSecondary} />
        </box>
        {/* Layout counts */}
        <box flexDirection="row" height={1} width={width}>
          <text content={" " + headerLine + " "} fg={theme.textSecondary} />
        </box>
        {/* Tree */}
        <ServerTree
          clientRef={clientRef}
          currentSessionName={currentSessionName}
          height={contentHeight - 2}
          onCountsChange={handleCountsChange}
          onNavigate={onNavigate}
          onSwitchPaneTab={onSwitchPaneTab}
          paneTabGroups={paneTabGroups}
          width={width}
        />
      </box>
    </>
  );
}
