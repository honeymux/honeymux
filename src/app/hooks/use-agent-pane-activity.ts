import type { MutableRefObject, RefObject } from "react";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentSession } from "../../agents/types.ts";

import {
  type CodingAgentPaneActivity,
  type CodingAgentPaneOutputSample,
  computeDesiredAuxSessionNames,
  getCodingAgentPaneActivity,
  getConnectedCodingAgentPaneIds,
  getConnectedCodingAgentPaneIdsKey,
  pruneCodingAgentPaneActivity,
} from "../../agents/pane-activity.ts";
import { TmuxControlClient } from "../../tmux/control-client.ts";

const CODING_AGENT_ACTIVITY_COMMIT_THROTTLE_MS = 100;

export interface UseAgentPaneActivityResult {
  activity: CodingAgentPaneActivity;
  /**
   * Ref-based snapshot of the same data that backs `activity`, keyed by
   * tmux pane id.  Intended for imperative consumers (animation paint
   * callbacks) that must read fresh per-pane activity at 20+ Hz without
   * paying a React re-render.  Mutated in-place when samples update.
   */
  lastOutputByPaneRef: RefObject<ReadonlyMap<string, CodingAgentPaneOutputSample>>;
}

interface UseAgentPaneActivityOptions {
  agentSessions: AgentSession[];
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  currentSessionName: string;
}

/**
 * Track coding-agent pane activity from the primary control client *and*
 * from auxiliary control clients attached to non-primary tmux sessions.
 *
 * tmux only emits `%output` to a control client for panes in the session
 * that client is attached to. To keep the sine wave alive while the user
 * looks at session A even though agents are producing output in sessions
 * B and C, we spawn one extra `TmuxControlClient` per non-primary session
 * that hosts at least one live agent and funnel its `pane-output` events
 * back into the same `lastOutputByPane` state the primary uses.
 */
export function useAgentPaneActivity({
  agentSessions,
  clientRef,
  connected,
  currentSessionName,
}: UseAgentPaneActivityOptions): UseAgentPaneActivityResult {
  const connectedPaneIds = useMemo(() => getConnectedCodingAgentPaneIds(agentSessions), [agentSessions]);
  const connectedPaneIdsKey = getConnectedCodingAgentPaneIdsKey(connectedPaneIds);
  const connectedPaneIdsRef = useRef(connectedPaneIds);
  connectedPaneIdsRef.current = connectedPaneIds;

  const [lastOutputByPane, setLastOutputByPane] = useState<Map<string, CodingAgentPaneOutputSample>>(() => new Map());
  // Parallel ref that mirrors lastOutputByPane so imperative consumers can
  // read fresh samples at animation-tick rate without subscribing to React
  // re-renders.  Kept in sync with every state mutation below.
  const lastOutputByPaneRef = useRef<ReadonlyMap<string, CodingAgentPaneOutputSample>>(lastOutputByPane);
  lastOutputByPaneRef.current = lastOutputByPane;

  useEffect(() => {
    setLastOutputByPane((previous) => pruneCodingAgentPaneActivity(previous, connectedPaneIds));
  }, [connectedPaneIds, connectedPaneIdsKey]);

  // Shared handler used by both the primary client's listener and each aux
  // client's listener. Kept in a ref so aux clients spawned asynchronously
  // always call the latest version without re-subscribing.
  const handlePaneOutputRef = useRef<(paneId: string) => void>(() => {});
  handlePaneOutputRef.current = (paneId: string): void => {
    if (!connectedPaneIdsRef.current.has(paneId)) return;

    const now = Date.now();
    const tickNow = performance.now();
    setLastOutputByPane((previous) => {
      const prevOutput = previous.get(paneId);
      if (prevOutput != null && tickNow - prevOutput.tickAt < CODING_AGENT_ACTIVITY_COMMIT_THROTTLE_MS) {
        return previous;
      }

      const next = new Map(previous);
      next.set(paneId, { at: now, tickAt: tickNow });
      return next;
    });
  };

  // Primary client: subscribe to pane-output for the currently attached session.
  useEffect(() => {
    if (!connected) {
      setLastOutputByPane(new Map());
      return;
    }

    const client = clientRef.current;
    if (!client) return;

    const onPaneOutput = (paneId: string): void => handlePaneOutputRef.current(paneId);
    client.on("pane-output", onPaneOutput);
    return () => {
      client.off("pane-output", onPaneOutput);
    };
  }, [clientRef, connected]);

  // Auxiliary client pool: one attach-only control client per tmux session
  // that hosts a live agent and isn't the primary's attached session.
  const auxClientsRef = useRef<Map<string, TmuxControlClient>>(new Map());
  const desiredAuxSessionNames = useMemo(
    () => computeDesiredAuxSessionNames(agentSessions, connected ? currentSessionName : null),
    [agentSessions, connected, currentSessionName],
  );

  useEffect(() => {
    if (!connected) {
      // Tear everything down when the primary connection drops.
      for (const client of auxClientsRef.current.values()) {
        client.destroy();
      }
      auxClientsRef.current.clear();
      return;
    }

    // Tear down aux clients that are no longer desired.
    for (const [sessionName, client] of auxClientsRef.current) {
      if (!desiredAuxSessionNames.has(sessionName)) {
        client.destroy();
        auxClientsRef.current.delete(sessionName);
      }
    }

    // Spawn aux clients for newly-desired sessions.
    for (const sessionName of desiredAuxSessionNames) {
      if (auxClientsRef.current.has(sessionName)) continue;

      const client = new TmuxControlClient();
      auxClientsRef.current.set(sessionName, client);

      const onPaneOutput = (paneId: string): void => handlePaneOutputRef.current(paneId);
      client.on("pane-output", onPaneOutput);

      void client.attachExisting(sessionName).catch(() => {
        // Attach failed (session gone, tmux server issue, etc.) — drop it
        // from the pool. A later state change can retry by recomputing the
        // desired set.
        client.off("pane-output", onPaneOutput);
        client.destroy();
        if (auxClientsRef.current.get(sessionName) === client) {
          auxClientsRef.current.delete(sessionName);
        }
      });
    }
  }, [connected, desiredAuxSessionNames]);

  // Final unmount: drain the pool so no lingering tmux processes survive.
  useEffect(
    () => () => {
      for (const client of auxClientsRef.current.values()) {
        client.destroy();
      }
      auxClientsRef.current.clear();
    },
    [],
  );

  const activity = useMemo(
    () => getCodingAgentPaneActivity(lastOutputByPane, connectedPaneIds),
    [connectedPaneIds, connectedPaneIdsKey, lastOutputByPane],
  );

  return { activity, lastOutputByPaneRef };
}
