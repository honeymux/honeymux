import type { AgentSession } from "../agents/types.ts";

interface DisplayGroup {
  lead?: AgentSession;
  /** For teams: teammates only (lead separate). For standalone: the single session. */
  members: AgentSession[];
  teamName?: string;
  type: "standalone" | "team";
}

export function groupSessionsForDisplay(sessions: AgentSession[]): DisplayGroup[] {
  // Partition into local and remote, then group each subset independently.
  // Local sessions appear first; remote sessions follow, grouped by host.
  const local = sessions.filter((s) => !s.isRemote);
  const remote = sessions.filter((s) => s.isRemote);

  const localGroups = groupSessionSubset(local);

  // Group remote sessions by host, then apply team/standalone grouping within each host
  const byHost = new Map<string, AgentSession[]>();
  for (const s of remote) {
    const host = s.remoteHost ?? "unknown";
    let arr = byHost.get(host);
    if (!arr) {
      arr = [];
      byHost.set(host, arr);
    }
    arr.push(s);
  }
  const remoteGroups: DisplayGroup[] = [];
  for (const [, hostSessions] of byHost) {
    remoteGroups.push(...groupSessionSubset(hostSessions));
  }

  return [...localGroups, ...remoteGroups];
}

function groupSessionSubset(sessions: AgentSession[]): DisplayGroup[] {
  const teamMap = new Map<string, { lead?: AgentSession; members: AgentSession[] }>();
  const standalone: DisplayGroup[] = [];

  for (const s of sessions) {
    if (s.teamName) {
      let group = teamMap.get(s.teamName);
      if (!group) {
        group = { members: [] };
        teamMap.set(s.teamName, group);
      }
      if (s.teamRole === "lead") {
        group.lead = s;
      } else {
        group.members.push(s);
      }
    } else {
      standalone.push({ members: [s], type: "standalone" });
    }
  }

  const teams: DisplayGroup[] = [];
  for (const [teamName, { lead, members }] of teamMap) {
    teams.push({ lead, members, teamName, type: "team" });
  }

  const allGroups = [...teams, ...standalone];

  allGroups.sort((a, b) => {
    const allSessions = (g: DisplayGroup): AgentSession[] => (g.lead ? [g.lead, ...g.members] : g.members);
    const minPri = (g: DisplayGroup) => Math.min(...allSessions(g).map(sessionPriority));
    const earliest = (g: DisplayGroup) => Math.min(...allSessions(g).map((s) => s.startedAt));

    const pa = minPri(a),
      pb = minPri(b);
    if (pa !== pb) return pa - pb;
    return earliest(a) - earliest(b);
  });

  return allGroups;
}

function sessionPriority(s: AgentSession): number {
  return s.status === "unanswered" ? 0 : 1;
}
