import type { MutableRefObject } from "react";

import { useEffect, useRef, useState } from "react";

import type { RemoteServerManager } from "../../remote/remote-server-manager.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";

/**
 * A local pane whose tmux state marks it as remote but for which Honeymux
 * has not yet installed a live input/output route. Rendered as a dim overlay
 * with a "Recovering…" label so the user gets visual feedback during the
 * transient window between Honeymux start (or reconnect) and completed
 * {@link RemoteServerManager.recoverPaneMappings}.
 */
export interface RecoveringPaneRect {
  height: number;
  left: number;
  paneId: string;
  top: number;
  width: number;
}

interface UseRecoveringPaneRectsOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  remoteManagerRef: MutableRefObject<RemoteServerManager | null>;
  /**
   * Bumps on server-status-change and mirror-state-change, so the hook
   * re-polls when recovery progresses.
   */
  remoteManagerVersion: number;
  targetSession?: string;
}

const POLL_INTERVAL_MS = 2000;

export function useRecoveringPaneRects({
  clientRef,
  connected,
  remoteManagerRef,
  remoteManagerVersion,
  targetSession,
}: UseRecoveringPaneRectsOptions): RecoveringPaneRect[] {
  const [recoveringRects, setRecoveringRects] = useState<RecoveringPaneRect[]>([]);
  const lastJsonRef = useRef("[]");

  useEffect(() => {
    if (!connected) {
      if (lastJsonRef.current !== "[]") {
        lastJsonRef.current = "[]";
        setRecoveringRects([]);
      }
      return;
    }

    let cancelled = false;

    const poll = async (): Promise<void> => {
      const client = clientRef.current;
      const manager = remoteManagerRef.current;
      if (!client || cancelled) return;

      let remoteOutput: string;
      try {
        remoteOutput = await client.runCommand("list-panes -a -F ' #{pane_id}\t#{@hmx-remote-host}'");
      } catch {
        return;
      }
      if (cancelled) return;

      const remotePaneIds = new Set<string>();
      for (const line of remoteOutput.split("\n")) {
        if (!line.trim()) continue;
        const cleaned = line.replace(/^ /, "").replace(/\r$/, "");
        const [paneId, host] = cleaned.split("\t");
        if (paneId && host) remotePaneIds.add(paneId);
      }

      // A pane is "recovering" when it is marked remote in tmux state but the
      // RemoteServerManager has no live mapping for it yet. This covers the
      // startup gap before reconnect completes, and any transient window
      // while the SSH connection is re-established.
      const recoveringIds = new Set<string>();
      for (const paneId of remotePaneIds) {
        if (!manager || !manager.isRemotePane(paneId)) {
          recoveringIds.add(paneId);
        }
      }

      if (recoveringIds.size === 0) {
        if (lastJsonRef.current !== "[]") {
          lastJsonRef.current = "[]";
          setRecoveringRects([]);
        }
        return;
      }

      let panes;
      try {
        panes = await client.getAllPaneInfo(targetSession);
      } catch {
        return;
      }
      if (cancelled) return;

      const rects: RecoveringPaneRect[] = panes
        .filter((p) => recoveringIds.has(p.id))
        .map((p) => ({
          height: p.height,
          left: p.left,
          paneId: p.id,
          top: p.top,
          width: p.width,
        }));

      const json = JSON.stringify(rects);
      if (json !== lastJsonRef.current) {
        lastJsonRef.current = json;
        setRecoveringRects(rects);
      }
    };

    const client = clientRef.current;
    const onChange = (): void => {
      void poll();
    };
    client?.on("layout-change", onChange);
    client?.on("window-pane-changed", onChange);

    void poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      client?.off("layout-change", onChange);
      client?.off("window-pane-changed", onChange);
    };
  }, [clientRef, connected, remoteManagerRef, remoteManagerVersion, targetSession]);

  return recoveringRects;
}
