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
import { reportFatalError } from "../runtime/fatal-error-handler.ts";

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

      // Handle PTY exit. The control client's exit handler is normally the
      // authoritative owner of shutdown/session-switch — it nulls ptyRef
      // synchronously on %exit, so this handler returns early via the
      // `ptyRef.current !== pty` check. When the PTY's exited promise
      // resolves first (e.g. `pkill -f tmux` tears the attach-session PTY
      // down before the control stream's close has been processed), exit
      // code 0 means tmux detached us cleanly — yield so the control
      // client's handler can switch sessions or shut down. A non-zero
      // code means the server was lost abruptly; surface the fatal dialog.
      pty.exited.then(async (exitCode) => {
        if (ptyRef.current !== pty) return;
        // Don't exit when too narrow — PTY may have died from tiny dimensions
        if (tooNarrowRef.current) return;
        if (exitCode === 0) return;
        try {
          clientRef.current?.destroy();
        } catch {
          // ignore
        }
        const handled = reportFatalError({
          error: new Error(`tmux client PTY for session "${targetSession}" exited with code ${exitCode}`),
          kind: "tmux pty exit",
          sessionName: targetSession,
        });
        if (handled) return;
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

  // Keep the control client's per-client size tracking the outer terminal.
  // With `window-size smallest`, the window picks min(control-client, PTY).
  // We size the control client to the outer terminal (always >= the PTY's
  // pane-content dims), so the control client never acts as a ceiling and
  // the window size is always driven by the PTY. Using pane-content dims
  // here would race the transient UI-chrome deduction at startup and let
  // a tiny control-client size leak through to the remote mirror via
  // syncClientSize.
  useEffect(() => {
    if (!connected || tooSmall || tooNarrow) return;
    const cols = process.stdout.columns ?? termCols;
    const rows = process.stdout.rows ?? termRows;
    if (cols <= 0 || rows <= 0) return;
    clientRef.current?.setClientSize({ cols, rows }).catch(() => {});
  }, [clientRef, connected, termCols, termRows, tooNarrow, tooSmall]);

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
