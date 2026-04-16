import type { CliRenderer } from "@opentui/core";
import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import { useCallback, useEffect } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { Osc52Passthrough, OtherOscPassthrough } from "../../util/config.ts";
import type { PtyBridge } from "../../util/pty.ts";
import type { RuntimeDims } from "../runtime/runtime-context.ts";

import { trackChildPid } from "../../util/child-pids.ts";
import { createPassthroughForwarder, spawnPty } from "../../util/pty.ts";
import { disableInputModesBeforeShutdown, shutdownRenderer } from "../../util/shutdown-renderer.ts";
import { tmuxCmd } from "../../util/tmux-server.ts";

export interface PtyLifecycleApi {
  spawnPtyBridge: (targetSession: string) => PtyBridge;
}

interface UsePtyLifecycleOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  deferredSessionRef: MutableRefObject<null | string>;
  dimsRef: MutableRefObject<Pick<RuntimeDims, "cols" | "rows">>;
  inputReady: MutableRefObject<boolean>;
  policyOsc52Passthrough: Osc52Passthrough;
  policyOtherOscPassthrough: OtherOscPassthrough;
  ptyRef: MutableRefObject<PtyBridge | null>;
  renderer: CliRenderer;
  suppressPassthroughRef: MutableRefObject<boolean>;
  termCols: number;
  termRows: number;
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
  tooNarrow: boolean;
  tooNarrowRef: MutableRefObject<boolean>;
  tooSmall: boolean;
}

export function usePtyLifecycle({
  clientRef,
  connected,
  deferredSessionRef,
  dimsRef,
  inputReady,
  policyOsc52Passthrough,
  policyOtherOscPassthrough,
  ptyRef,
  renderer,
  suppressPassthroughRef,
  termCols,
  termRows,
  terminalRef,
  tooNarrow,
  tooNarrowRef,
  tooSmall,
}: UsePtyLifecycleOptions): PtyLifecycleApi {
  const spawnPtyBridge = useCallback(
    (targetSession: string) => {
      const { cols, rows } = dimsRef.current;

      // Cancel any in-progress escape sequence left over from a previous PTY.
      // Without this, the ghostty VT parser may still be mid-OSC when new data
      // arrives, causing sequence fragments to render as visible text.
      // ST (ESC \) terminates string-collecting states (OSC, DCS, APC, PM);
      // CAN (0x18) aborts any other in-progress escape sequence.
      if (terminalRef.current) {
        try {
          terminalRef.current.feed(Buffer.from([0x1b, 0x5c, 0x18]));
        } catch {}
      }

      const forwardPassthrough = createPassthroughForwarder({
        policyOsc52Passthrough,
        policyOtherOscPassthrough,
      });
      const pty = spawnPty(tmuxCmd("attach-session", "-t", targetSession), cols, rows, (data) => {
        if (!suppressPassthroughRef.current) forwardPassthrough(data);
        if (ptyRef.current === pty && terminalRef.current) {
          try {
            terminalRef.current.feed(data);
          } catch {
            // ignore
          }
        }
      });
      ptyRef.current = pty;
      trackChildPid(pty.pid);

      // Handle PTY exit
      pty.exited.then(async () => {
        if (ptyRef.current !== pty) return;
        // Don't exit when too narrow — PTY may have died from tiny dimensions
        if (tooNarrowRef.current) return;
        try {
          clientRef.current?.destroy();
        } catch {
          // ignore
        }
        await disableInputModesBeforeShutdown(renderer);
        await shutdownRenderer(renderer);
        process.exit(0);
      });

      // Allow input forwarding after a brief settling delay
      inputReady.current = false;
      setTimeout(() => {
        inputReady.current = true;
      }, 200);

      return pty;
    },
    [
      clientRef,
      dimsRef,
      inputReady,
      policyOtherOscPassthrough,
      policyOsc52Passthrough,
      ptyRef,
      renderer,
      suppressPassthroughRef,
      terminalRef,
      tooNarrowRef,
    ],
  );

  // Handle terminal resize
  useEffect(() => {
    if (ptyRef.current && connected && !tooSmall && !tooNarrow && termCols > 0 && termRows > 0) {
      ptyRef.current.resize(termCols, termRows);
    }
  }, [connected, ptyRef, termCols, termRows, tooNarrow, tooSmall]);

  // Spawn deferred PTY when window widens past the tooNarrow threshold
  useEffect(() => {
    if (!tooNarrow && deferredSessionRef.current) {
      const session = deferredSessionRef.current;
      deferredSessionRef.current = null;
      spawnPtyBridge(session);
    }
  }, [deferredSessionRef, spawnPtyBridge, tooNarrow]);

  return { spawnPtyBridge };
}
