import type { AgentSession } from "./types.ts";

export interface CodingAgentPaneActivity {
  hasConnectedAgent: boolean;
  lastOutputAt: null | number;
  lastOutputTickAt: null | number;
}

export interface CodingAgentPaneOutputSample {
  at: number;
  tickAt: number;
}

/**
 * Compute the set of tmux session names that need an auxiliary control
 * client to forward `pane-output` events for their agent panes. A session is
 * included iff it hosts a live coding agent *and* is not the session the
 * primary control client is currently attached to.
 *
 * The primary already receives %output for its own attached session, so
 * listing it here would duplicate events. Sessions that host no agents (or
 * only ended ones) don't need auxiliary coverage.
 *
 * Sessions whose name is missing from the agent event (e.g. hooks that
 * didn't report it) are silently skipped — the aux pool only covers agents
 * we can reliably route back to a tmux session.
 */
export function computeDesiredAuxSessionNames(
  agentSessions: AgentSession[],
  primarySessionName: null | string,
): Set<string> {
  const desired = new Set<string>();
  for (const session of agentSessions) {
    if (session.status === "ended" || !session.paneId || !session.sessionName) continue;
    if (session.sessionName === primarySessionName) continue;
    desired.add(session.sessionName);
  }
  return desired;
}

export function getCodingAgentPaneActivity(
  lastOutputByPane: ReadonlyMap<string, CodingAgentPaneOutputSample>,
  connectedPaneIds: ReadonlySet<string>,
): CodingAgentPaneActivity {
  const latestOutput = getLatestCodingAgentPaneOutput(lastOutputByPane, connectedPaneIds);

  return {
    hasConnectedAgent: connectedPaneIds.size > 0,
    lastOutputAt: latestOutput?.at ?? null,
    lastOutputTickAt: latestOutput?.tickAt ?? null,
  };
}

export function getConnectedCodingAgentPaneIds(agentSessions: AgentSession[]): Set<string> {
  const paneIds = new Set<string>();

  for (const session of agentSessions) {
    if (session.status === "ended" || !session.paneId) continue;
    paneIds.add(session.paneId);
  }

  return paneIds;
}

export function getConnectedCodingAgentPaneIdsKey(connectedPaneIds: ReadonlySet<string>): string {
  return [...connectedPaneIds].sort().join("\n");
}

export function getLatestCodingAgentPaneOutput(
  lastOutputByPane: ReadonlyMap<string, CodingAgentPaneOutputSample>,
  connectedPaneIds: ReadonlySet<string>,
): CodingAgentPaneOutputSample | null {
  let latest: CodingAgentPaneOutputSample | null = null;

  for (const paneId of connectedPaneIds) {
    const sample = lastOutputByPane.get(paneId);
    if (sample == null) continue;
    if (latest == null || sample.tickAt > latest.tickAt) latest = sample;
  }

  return latest;
}

export function getLatestCodingAgentPaneOutputAt(
  lastOutputByPane: ReadonlyMap<string, CodingAgentPaneOutputSample>,
  connectedPaneIds: ReadonlySet<string>,
): null | number {
  return getLatestCodingAgentPaneOutput(lastOutputByPane, connectedPaneIds)?.at ?? null;
}

export function pruneCodingAgentPaneActivity(
  lastOutputByPane: ReadonlyMap<string, CodingAgentPaneOutputSample>,
  connectedPaneIds: ReadonlySet<string>,
): Map<string, CodingAgentPaneOutputSample> {
  const next = new Map<string, CodingAgentPaneOutputSample>();

  for (const [paneId, sample] of lastOutputByPane) {
    if (connectedPaneIds.has(paneId)) next.set(paneId, sample);
  }

  return next;
}
