import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AgentSession } from "../../agents/types.ts";
import type { RemoteServerManager } from "../../remote/remote-server-manager.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { Osc52Passthrough, OtherOscPassthrough } from "../../util/config.ts";
import type { PtyBridge } from "../../util/pty.ts";

import { prepareGhosttyTerminalForTmux } from "../../util/ghostty-terminal.ts";
import { createPassthroughForwarder, spawnPty } from "../../util/pty.ts";
import { tmuxCmd } from "../../util/tmux-server.ts";

export interface UseAgentPtyBridgeApi {
  /** True once the PTY has produced its first frame. */
  isReady: boolean;
  /** Wire onto the TerminalView's `onReady` prop. */
  onTerminalReady: (terminal: GhosttyTerminalRenderable) => void;
}

interface UseAgentPtyBridgeOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  /** Optional callback invoked before each PTY write so callers can react
   *  to keystrokes (e.g. mark a permission prompt as answered). */
  onAgentInput?: (data: string) => void;
  /** Called when the underlying tmux session ends unexpectedly. */
  onExit?: () => void;
  policyOsc52Passthrough: Osc52Passthrough;
  policyOtherOscPassthrough: OtherOscPassthrough;
  /** Optional remote server manager for routing input to remote panes. */
  remoteManagerRef?: MutableRefObject<RemoteServerManager | null>;
  /** The agent whose pane should be attached. Pass null to disable. */
  session: AgentSession | null;
  /** Target column count for the bridged tmux session. */
  termCols: number;
  /** Target row count for the bridged tmux session. */
  termRows: number;
  /** The shared write-fn ref used by the keyboard router. */
  writeFnRef: MutableRefObject<(data: string) => void>;
}

/**
 * Spawns a tmux grouped session attached to an agent's window/pane and
 * routes keyboard input from `writeFnRef` directly to the resulting PTY.
 *
 * Lifecycle (on session change or unmount):
 *   1. closedRef is set so late `pty.exited` resolutions don't trigger onExit
 *   2. writeFnRef is restored (via useLayoutEffect cleanup)
 *   3. PTY is killed
 *   4. pane-border-status is restored to "top"
 *   5. grouped session is killed
 */
export function useAgentPtyBridge({
  clientRef,
  onAgentInput,
  onExit,
  policyOsc52Passthrough,
  policyOtherOscPassthrough,
  remoteManagerRef,
  session,
  termCols,
  termRows,
  writeFnRef,
}: UseAgentPtyBridgeOptions): UseAgentPtyBridgeApi {
  const ptyRef = useRef<PtyBridge | null>(null);
  const terminalRef = useRef<GhosttyTerminalRenderable | null>(null);
  const closedRef = useRef(false);
  const overlaySessionRef = useRef<null | string>(null);
  /** True if this hook toggled tmux pane zoom and should toggle it back. */
  const didZoomRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onAgentInputRef = useRef(onAgentInput);
  onAgentInputRef.current = onAgentInput;
  const originalWriteRef = useRef(writeFnRef.current);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [isReady, setIsReady] = useState(false);

  // Keystroke gateway: forwards into the bridged PTY when one exists.
  // For remote panes, routes input through the remote manager instead of the local PTY.
  const writeToAgentPty = useCallback(
    (data: string) => {
      const currentSession = sessionRef.current;
      const paneId = currentSession?.paneId;
      const remoteManager = remoteManagerRef?.current;

      // If the agent is on a remote pane, route input through the remote manager
      if (paneId && remoteManager?.routeInput(paneId, data)) {
        onAgentInputRef.current?.(data);
        return;
      }

      // Otherwise, write directly to the local overlay PTY
      const pty = ptyRef.current;
      if (!pty) return;
      onAgentInputRef.current?.(data);
      pty.write(data);
    },
    [remoteManagerRef],
  );

  // Swap writeFnRef while the bridge is active. useLayoutEffect runs
  // synchronously after commit, so the very first keystroke after mount
  // hits the new handler.
  useLayoutEffect(() => {
    if (!session) return;
    originalWriteRef.current = writeFnRef.current;
    writeFnRef.current = writeToAgentPty;
    return () => {
      writeFnRef.current = originalWriteRef.current;
    };
  }, [session, writeFnRef, writeToAgentPty, remoteManagerRef]);

  const targetSessionName = session?.sessionName;
  const targetPaneId = session?.paneId;
  const targetWindowId = session?.windowId;

  // Spawn the grouped session + PTY when the target agent changes.
  useEffect(() => {
    if (!targetSessionName || !targetPaneId) {
      setIsReady(false);
      return;
    }

    closedRef.current = false;
    setIsReady(false);

    const overlayName = `__hmx-zoom-${Date.now()}`;
    overlaySessionRef.current = overlayName;
    const client = clientRef.current;

    let cancelled = false;

    (async () => {
      if (client && targetPaneId) {
        try {
          // Hide the pane border while the overlay is active.
          await client.setPaneBorderStatus(targetPaneId, "off");
        } catch {
          // Best effort.
        }
      }
      if (cancelled) return;

      try {
        if (client) {
          await client.createDetachedSession(overlayName, targetSessionName);
          await client.setSessionOption(overlayName, "status", "off");
          if (targetWindowId) {
            await client.selectWindowInSession(overlayName, targetWindowId);
          }
          if (targetPaneId) {
            await client.selectPaneInSession(overlayName, targetPaneId);
          }
        }
      } catch {
        // tmux commands failed — PTY attach will still try
      }
      if (cancelled) return;

      // Zoom the target pane so it fills its window. Without this, the
      // overlay client (sized at our full viewport) would show tmux's
      // dot-grid for the area of the window outside the agent's pane
      // when the agent lives in a multi-pane layout that's smaller than
      // the viewport — e.g. zooming an agent that shares its window with
      // sibling splits while the same session is already attached from
      // honeymux at a larger size.
      if (client && targetPaneId) {
        try {
          const alreadyZoomed = await client.isPaneWindowZoomed(targetPaneId);
          if (!alreadyZoomed) {
            await client.togglePaneZoom(targetPaneId);
            didZoomRef.current = true;
          }
        } catch {
          // Best effort.
        }
      }
      if (cancelled) return;

      const forwardPassthrough = createPassthroughForwarder({
        policyOsc52Passthrough,
        policyOtherOscPassthrough,
      });
      const pty = spawnPty(
        tmuxCmd("attach-session", "-t", overlayName),
        Math.max(10, termCols),
        Math.max(3, termRows),
        (data) => {
          forwardPassthrough(data);
          if (ptyRef.current === pty && terminalRef.current) {
            try {
              terminalRef.current.feed(data);
            } catch {
              // ignore feed errors during teardown
            }
            if (!closedRef.current) setIsReady(true);
          }
        },
      );
      ptyRef.current = pty;

      pty.exited.then(() => {
        if (!closedRef.current) {
          closedRef.current = true;
          onExitRef.current?.();
        }
      });
    })();

    return () => {
      cancelled = true;
      closedRef.current = true;
      try {
        ptyRef.current?.kill();
      } catch {
        // ignore
      }
      ptyRef.current = null;
      terminalRef.current = null;
      setIsReady(false);

      const liveClient = clientRef.current;
      // Un-zoom the target pane if we zoomed it on attach.
      if (didZoomRef.current && targetPaneId && liveClient) {
        didZoomRef.current = false;
        liveClient.togglePaneZoom(targetPaneId).catch(() => {});
      }
      if (targetPaneId && liveClient) {
        liveClient.setPaneBorderStatus(targetPaneId, "top").catch(() => {});
      }
      const name = overlaySessionRef.current;
      if (name) {
        overlaySessionRef.current = null;
        if (liveClient) {
          liveClient.killSession(name).catch(() => {});
        }
      }
    };
  }, [
    clientRef,
    policyOsc52Passthrough,
    policyOtherOscPassthrough,
    targetPaneId,
    targetSessionName,
    targetWindowId,
    termCols,
    termRows,
  ]);

  // Propagate size changes to the bridged PTY (without tearing it down).
  useEffect(() => {
    const pty = ptyRef.current;
    if (pty && termCols > 0 && termRows > 0) {
      try {
        pty.resize(termCols, termRows);
      } catch {
        // ignore
      }
    }
  }, [termCols, termRows]);

  const onTerminalReady = useCallback((terminal: GhosttyTerminalRenderable) => {
    terminalRef.current = terminal;
    prepareGhosttyTerminalForTmux(terminal);
  }, []);

  return { isReady, onTerminalReady };
}
