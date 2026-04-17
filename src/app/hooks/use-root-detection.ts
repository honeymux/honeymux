import type { MutableRefObject } from "react";

import { useEffect, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";

import { isActivePaneRoot } from "../../util/root-detect.ts";

export interface RootPaneRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface UseRootDetectionOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  enabled?: boolean;
  targetSession?: string;
}

const POLL_INTERVAL_MS = 2000;

export function useRootDetection({ clientRef, connected, enabled = true, targetSession }: UseRootDetectionOptions) {
  const [rootPanes, setRootPanes] = useState<RootPaneRect[]>([]);
  const lastJsonRef = useRef("[]");

  useEffect(() => {
    if (!connected || !enabled) {
      if (lastJsonRef.current !== "[]") {
        lastJsonRef.current = "[]";
        setRootPanes([]);
      }
      return;
    }

    let cancelled = false;
    let nextPollTimer: ReturnType<typeof setTimeout> | null = null;

    async function pollOnce() {
      const client = clientRef.current;
      if (!client || cancelled) return;

      try {
        const panes = await client.getAllPaneInfo(targetSession);
        if (cancelled) return;

        const results = await Promise.all(
          panes.map(async (pane) => {
            const isRoot = await isActivePaneRoot(pane.pid, pane.tty);
            return isRoot ? { height: pane.height, left: pane.left, top: pane.top, width: pane.width } : null;
          }),
        );
        if (cancelled) return;

        const rects = results.filter((r): r is RootPaneRect => r !== null);
        const json = JSON.stringify(rects);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setRootPanes(rects);
        }
      } catch {
        // Graceful degradation — don't update state on error
      }
    }

    const scheduleNextPoll = (delayMs: number) => {
      nextPollTimer = setTimeout(() => {
        void pollOnce().finally(() => {
          if (!cancelled) scheduleNextPoll(POLL_INTERVAL_MS);
        });
      }, delayMs);
    };

    scheduleNextPoll(0);
    return () => {
      cancelled = true;
      if (nextPollTimer !== null) clearTimeout(nextPollTimer);
    };
  }, [clientRef, connected, enabled, targetSession]);

  return { rootPanes };
}
