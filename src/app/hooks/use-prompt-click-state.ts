import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import { useEffect } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PanePromptTapState, PromptClickMode, PromptInputStart } from "../../util/prompt-detect.ts";

import { analyzePromptChunk, initialPanePromptTapState } from "../../util/prompt-detect.ts";

interface UsePromptClickStateOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  promptClickStateRef: MutableRefObject<PromptClickMode>;
  promptInputStartRef: MutableRefObject<PromptInputStart | null>;
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
}

export function usePromptClickState({
  clientRef,
  connected,
  promptClickStateRef,
  promptInputStartRef,
  terminalRef,
}: UsePromptClickStateOptions): void {
  useEffect(() => {
    promptClickStateRef.current = "unknown";
    promptInputStartRef.current = null;
    if (!connected) return;

    const client = clientRef.current;
    if (!client) return;

    let cancelled = false;
    const paneStates = new Map<string, PanePromptTapState>();
    const panePromptStarts = new Map<string, PromptInputStart>();
    const captureTimeoutIds = new Set<ReturnType<typeof setTimeout>>();
    let activePaneId: null | string = null;

    function updatePromptMode(): void {
      if (!activePaneId) {
        promptClickStateRef.current = "unknown";
        promptInputStartRef.current = null;
        return;
      }
      const state = paneStates.get(activePaneId);
      if (!state?.hasPromptMarks) {
        promptClickStateRef.current = "unknown";
        promptInputStartRef.current = null;
        return;
      }
      promptClickStateRef.current = state.atPrompt ? "prompt" : "not-prompt";
      promptInputStartRef.current = state.atPrompt ? (panePromptStarts.get(activePaneId) ?? null) : null;
    }

    function schedulePromptStartCapture(paneId: string): void {
      const capture = (delayMs: number) => {
        const timeoutId = setTimeout(() => {
          captureTimeoutIds.delete(timeoutId);
          if (cancelled || activePaneId !== paneId) return;
          const terminal = terminalRef.current;
          if (!terminal) return;
          try {
            const [x, y] = terminal.getCursor();
            panePromptStarts.set(paneId, { x, y });
            if (activePaneId === paneId && promptClickStateRef.current === "prompt") {
              promptInputStartRef.current = { x, y };
            }
          } catch {
            // ignore cursor sampling errors
          }
        }, delayMs);
        captureTimeoutIds.add(timeoutId);
      };

      // Sample on the next tick and one frame later so we catch the cursor
      // after the prompt has been rendered into the terminal buffer.
      capture(0);
      capture(16);
    }

    function handlePaneOutput(paneId: string, data: string): void {
      if (cancelled) return;
      const priorState = paneStates.get(paneId) ?? initialPanePromptTapState();
      const nextState = analyzePromptChunk(data, priorState);
      paneStates.set(paneId, nextState);
      if (!nextState.atPrompt) {
        panePromptStarts.delete(paneId);
      } else if (!priorState.atPrompt) {
        schedulePromptStartCapture(paneId);
      }
      if (paneId === activePaneId) {
        updatePromptMode();
      }
    }

    async function refreshActivePane(): Promise<void> {
      try {
        const liveClient = clientRef.current;
        if (!liveClient) {
          promptClickStateRef.current = "unknown";
          return;
        }
        const panes = await liveClient.getAllPaneInfo();
        if (cancelled) return;

        const livePaneIds = new Set(panes.map((pane) => pane.id));
        for (const paneId of paneStates.keys()) {
          if (!livePaneIds.has(paneId)) {
            paneStates.delete(paneId);
            panePromptStarts.delete(paneId);
          }
        }

        activePaneId = panes.find((pane) => pane.active)?.id ?? null;
        if (activePaneId) {
          const activeState = paneStates.get(activePaneId);
          if (activeState?.atPrompt && !panePromptStarts.has(activePaneId)) {
            schedulePromptStartCapture(activePaneId);
          }
        }
        updatePromptMode();
      } catch {
        if (!cancelled) {
          promptClickStateRef.current = "unknown";
          promptInputStartRef.current = null;
        }
      }
    }

    client.on("pane-output", handlePaneOutput);
    client.on("layout-change", refreshActivePane);
    client.on("window-pane-changed", refreshActivePane);
    client.on("session-window-changed", refreshActivePane);

    refreshActivePane().catch(() => {});

    return () => {
      cancelled = true;
      client.off("pane-output", handlePaneOutput);
      client.off("layout-change", refreshActivePane);
      client.off("window-pane-changed", refreshActivePane);
      client.off("session-window-changed", refreshActivePane);
      promptClickStateRef.current = "unknown";
      promptInputStartRef.current = null;
      for (const timeoutId of captureTimeoutIds) {
        clearTimeout(timeoutId);
      }
    };
  }, [clientRef, connected, promptClickStateRef, promptInputStartRef, terminalRef]);
}
