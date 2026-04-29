import type { MutableRefObject } from "react";

import { useEffect, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";

export interface DimPaneRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface UseDimInactivePanesOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  enabled: boolean;
  targetSession?: string;
}

const POLL_INTERVAL_MS = 2000;

export function useDimInactivePanes({ clientRef, connected, enabled, targetSession }: UseDimInactivePanesOptions) {
  const [inactivePaneRects, setInactivePaneRects] = useState<DimPaneRect[]>([]);
  const [activePaneRect, setActivePaneRect] = useState<DimPaneRect | null>(null);
  const lastJsonRef = useRef("[]");
  const lastActiveJsonRef = useRef("null");

  useEffect(() => {
    if (!connected) {
      if (lastJsonRef.current !== "[]") {
        lastJsonRef.current = "[]";
        setInactivePaneRects([]);
      }
      if (lastActiveJsonRef.current !== "null") {
        lastActiveJsonRef.current = "null";
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

        // `inactivePaneRects` is consumed by the dim-inactive-panes overlay
        // and is gated by the `enabled` flag. `activePaneRect` is always
        // tracked because the cursor position-filter inside
        // `prepareGhosttyTerminalForTmux` needs it regardless of whether
        // dimming is enabled.
        const rects: DimPaneRect[] = enabled
          ? panes.filter((p) => !p.active).map((p) => ({ height: p.height, left: p.left, top: p.top, width: p.width }))
          : [];

        const activePane = panes.find((p) => p.active);
        const activeRect: DimPaneRect | null = activePane
          ? { height: activePane.height, left: activePane.left, top: activePane.top, width: activePane.width }
          : null;

        const json = JSON.stringify(rects);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setInactivePaneRects(rects);
        }

        const activeJson = JSON.stringify(activeRect);
        if (activeJson !== lastActiveJsonRef.current) {
          lastActiveJsonRef.current = activeJson;
          setActivePaneRect(activeRect);
        }
      } catch {
        // Graceful degradation — don't update state on error
      }
    }

    // Listen for pane focus and layout changes to update immediately
    const client = clientRef.current;
    const onPaneChanged = () => {
      poll();
    };
    client?.on("window-pane-changed", onPaneChanged);
    client?.on("layout-change", onPaneChanged);

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      client?.off("window-pane-changed", onPaneChanged);
      client?.off("layout-change", onPaneChanged);
    };
  }, [clientRef, connected, enabled, targetSession]);

  return { activePaneRect, inactivePaneRects };
}
