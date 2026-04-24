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

        const minTop = panes.length > 0 ? Math.min(...panes.map((p) => p.top)) : 0;
        const minLeft = panes.length > 0 ? Math.min(...panes.map((p) => p.left)) : 0;
        const results = await Promise.all(
          panes.map(async (pane) => {
            const isRoot = harnessForcesRoot(pane, { minLeft, minTop }) ?? (await isActivePaneRoot(pane.pid, pane.tty));
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

/**
 * Harness-only override for docs screenshots: returns true/false to force the
 * verdict for a pane, or null to defer to the real platform check. Controlled
 * by HMX_HARNESS_ROOT_FORCE ("all", "top", or "left"). A no-op in production
 * because HMX_HARNESS is only set by the docs-screenshots harness.
 */
function harnessForcesRoot(
  pane: { left: number; top: number },
  extents: { minLeft: number; minTop: number },
): boolean | null {
  if (process.env["HMX_HARNESS"] !== "1") return null;
  const mode = process.env["HMX_HARNESS_ROOT_FORCE"];
  if (mode === "all") return true;
  // "top"/"left" mark the pane(s) at the smallest top/left coordinate. Tmux
  // reports pane geometry relative to the window, and the upper-left pane may
  // not sit at exactly (0,0) due to status/tab-bar offsets — hence the
  // compare-to-minimum instead of compare-to-zero.
  if (mode === "top") return pane.top === extents.minTop;
  if (mode === "left") return pane.left === extents.minLeft;
  return null;
}
