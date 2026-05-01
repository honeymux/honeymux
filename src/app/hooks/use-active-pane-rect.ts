import type { MutableRefObject } from "react";

import { useEffect, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { ActivePaneRect } from "../../util/ghostty-terminal.ts";

export type { ActivePaneRect } from "../../util/ghostty-terminal.ts";

interface UseActivePaneRectOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  targetSession?: string;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Track the active tmux pane's screen-cell rect.
 *
 * The cursor-position filter installed by `prepareGhosttyTerminalForTmux`
 * needs the active pane rect to reject stale buffer cursor updates that
 * land outside the focused pane. This hook polls on a timer and re-polls
 * immediately on any tmux event that can change which pane is active or
 * where it lives on screen, so the rect tracks reality with no
 * perceptible lag.
 *
 * `session-window-changed` is essential alongside `window-pane-changed`:
 * tmux emits the former (not the latter) when the active window
 * switches, and without it the rect would stay stale across window
 * switches, stranding the cursor filter on the previous pane.
 */
export function useActivePaneRect({ clientRef, connected, targetSession }: UseActivePaneRectOptions) {
  const [activePaneRect, setActivePaneRect] = useState<ActivePaneRect | null>(null);
  const lastJsonRef = useRef("null");

  useEffect(() => {
    if (!connected) {
      if (lastJsonRef.current !== "null") {
        lastJsonRef.current = "null";
        setActivePaneRect(null);
      }
      return;
    }

    let cancelled = false;

    async function poll() {
      const client = clientRef.current;
      if (!client || cancelled) return;

      try {
        const panes = await client.getAllPaneInfo(targetSession);
        if (cancelled) return;

        const activePane = panes.find((p) => p.active);
        const rect: ActivePaneRect | null = activePane
          ? { height: activePane.height, left: activePane.left, top: activePane.top, width: activePane.width }
          : null;

        const json = JSON.stringify(rect);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setActivePaneRect(rect);
        }
      } catch {
        // Graceful degradation — don't update state on error
      }
    }

    const client = clientRef.current;
    const onChanged = () => {
      poll();
    };
    client?.on("layout-change", onChanged);
    client?.on("session-changed", onChanged);
    client?.on("session-window-changed", onChanged);
    client?.on("window-pane-changed", onChanged);

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      client?.off("layout-change", onChanged);
      client?.off("session-changed", onChanged);
      client?.off("session-window-changed", onChanged);
      client?.off("window-pane-changed", onChanged);
    };
  }, [clientRef, connected, targetSession]);

  return activePaneRect;
}
