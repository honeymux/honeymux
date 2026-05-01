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
  const lastJsonRef = useRef("[]");

  useEffect(() => {
    if (!connected || !enabled) {
      if (lastJsonRef.current !== "[]") {
        lastJsonRef.current = "[]";
        setInactivePaneRects([]);
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

        const rects: DimPaneRect[] = panes
          .filter((p) => !p.active)
          .map((p) => ({ height: p.height, left: p.left, top: p.top, width: p.width }));

        const json = JSON.stringify(rects);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setInactivePaneRects(rects);
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
  }, [clientRef, connected, enabled, targetSession]);

  return inactivePaneRects;
}
