import type { CliRenderer } from "@opentui/core";

import { useCallback, useRef } from "react";

import type { TmuxKeyBindings } from "../../tmux/types.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { theme } from "../../themes/theme.ts";
import {
  computeHoneybeamMaxCol,
  computeHoneybeamOffsets,
  displayKeyToSequence,
  runHoneybeamAnimation,
} from "../../util/honeybeam-animation.ts";
import { isDismissKey } from "../../util/keybindings.ts";

type GhosttyTerminalWithDirtyFlag = {
  _ansiDirty?: boolean;
};

const POST_PREFIX_TIMEOUT_MS = 2000;

interface TmuxSplitSequences {
  horizontalSplitSequence: null | string;
  prefixSequence: null | string;
  verticalSplitSequence: null | string;
}

interface UsePtyWritePipelineOptions {
  beamState: Pick<UiActionsApi, "beamPromiseRef" | "beamTokenRef">;
  honeybeamsEnabled: boolean;
  keyBindings: TmuxKeyBindings | null;
  overlayActive: boolean;
  quickTerminalOpen: boolean;
  refs: AppRuntimeRefs;
  renderer: CliRenderer;
  toolbarOpen: boolean;
}

export function getTmuxSplitSequences(keyBindings: TmuxKeyBindings | null): TmuxSplitSequences {
  return {
    horizontalSplitSequence: keyBindings?.splitHorizontal
      ? displayKeyToSequence(keyBindings.splitHorizontal.split(" + ").pop()!)
      : null,
    prefixSequence: keyBindings ? displayKeyToSequence(keyBindings.prefix) : null,
    verticalSplitSequence: keyBindings?.splitVertical
      ? displayKeyToSequence(keyBindings.splitVertical.split(" + ").pop()!)
      : null,
  };
}

export function resolveHoneybeamDirection(
  data: string,
  verticalSplitSequence: null | string,
  horizontalSplitSequence: null | string,
): "horizontal" | "vertical" | null {
  if (verticalSplitSequence && data === verticalSplitSequence) return "vertical";
  if (horizontalSplitSequence && data === horizontalSplitSequence) return "horizontal";
  return null;
}

export function shouldMarkPermissionPromptAnswered(data: string): boolean {
  return data === "\r" || isDismissKey(data);
}

export function usePtyWritePipeline({
  beamState,
  honeybeamsEnabled,
  keyBindings,
  overlayActive,
  quickTerminalOpen,
  refs,
  renderer,
  toolbarOpen,
}: UsePtyWritePipelineOptions): void {
  const prefixSentAtRef = useRef(0);
  const {
    activePaneIdRef,
    clientRef,
    dimsRef,
    ptyRef,
    remoteManagerRef,
    sidebarOpenRef,
    sidebarWidthRef,
    storeRef,
    terminalRef,
    tmuxPrefixSequenceRef,
    writeFnRef,
  } = refs;
  const { horizontalSplitSequence, prefixSequence, verticalSplitSequence } = getTmuxSplitSequences(keyBindings);

  const writeToPty = useCallback(
    (data: string) => {
      ptyRef.current?.write(data);
    },
    [ptyRef],
  );

  const forceHoneybeamResync = useCallback(() => {
    if (terminalRef.current) {
      (terminalRef.current as unknown as GhosttyTerminalWithDirtyFlag)._ansiDirty = true;
    }
    renderer.currentRenderBuffer.clear();
    renderer.requestRender();
  }, [renderer, terminalRef]);

  tmuxPrefixSequenceRef.current = prefixSequence;

  if (overlayActive || quickTerminalOpen) return;

  writeFnRef.current = (data: string) => {
    const activePaneId = activePaneIdRef.current;
    if (activePaneId && remoteManagerRef.current?.routeInput(activePaneId, data)) {
      return;
    }

    if (honeybeamsEnabled && prefixSentAtRef.current > 0) {
      const elapsed = Date.now() - prefixSentAtRef.current;
      prefixSentAtRef.current = 0;

      if (elapsed < POST_PREFIX_TIMEOUT_MS) {
        const direction = resolveHoneybeamDirection(data, verticalSplitSequence, horizontalSplitSequence);
        if (direction) {
          const client = clientRef.current;
          if (client) {
            if (beamState.beamTokenRef.current) {
              beamState.beamTokenRef.current.cancelled = true;
              forceHoneybeamResync();
            }

            const token: import("../../util/honeybeam-animation.ts").BeamToken = { cancelled: false };
            beamState.beamTokenRef.current = token;
            const key = data;
            const prev = Promise.race([
              beamState.beamPromiseRef.current ?? Promise.resolve(),
              new Promise<void>((resolve) => setTimeout(resolve, POST_PREFIX_TIMEOUT_MS)),
            ]);

            beamState.beamPromiseRef.current = prev
              .then(() => {
                if (token.cancelled) return;

                const dims = dimsRef.current;
                const sidebarOffset = sidebarOpenRef.current ? sidebarWidthRef.current + 1 : 0;
                const { colOffset, rowOffset } = computeHoneybeamOffsets(dims, sidebarOffset);
                const maxCol = computeHoneybeamMaxCol(dims, toolbarOpen, sidebarOffset);
                const borderLinesPromise = client.getPaneBorderLines().catch(() => "single");

                return client
                  .getActivePaneGeometry()
                  .then((geometry) =>
                    borderLinesPromise.then((borderLines) =>
                      runHoneybeamAnimation(
                        {
                          accentColor: theme.accent,
                          borderLines: borderLines as import("../../util/honeybeam-animation.ts").PaneBorderLines,
                          colOffset,
                          direction,
                          maxCol,
                          paneHeight: geometry.height,
                          paneLeft: geometry.left,
                          paneTop: geometry.top,
                          paneWidth: geometry.width,
                          rowOffset,
                        },
                        token,
                      ),
                    ),
                  )
                  .catch(() => {});
              })
              .then(() => {
                if (token.cancelled) return;
                ptyRef.current?.write(key);
              })
              .finally(() => {
                forceHoneybeamResync();
                if (beamState.beamTokenRef.current === token) {
                  beamState.beamTokenRef.current = null;
                }
              });
            return;
          }
        }
      }
    }

    if (honeybeamsEnabled && prefixSequence && data === prefixSequence) {
      prefixSentAtRef.current = Date.now();
    }

    if (shouldMarkPermissionPromptAnswered(data)) {
      const paneId = activePaneIdRef.current;
      const store = storeRef.current;
      if (paneId && store) {
        const match = store
          .getSessions()
          .find((session) => session.paneId === paneId && session.status === "unanswered");
        if (match) {
          store.markAnswered(match.sessionId);
        }
      }
    }

    writeToPty(data);
  };
}
