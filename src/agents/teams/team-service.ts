import type { AgentEvent } from "../types.ts";
import type { TeamConfig, TeamMembership, TeamState, TeamTask } from "./types.ts";

import { EventEmitter } from "../../util/event-emitter.ts";
import { scanTeamConfigs, scanTeamTasks } from "./config-scanner.ts";

const POLL_INTERVAL_MS = 5_000;

export class TeamService extends EventEmitter {
  private configs = new Map<string, TeamConfig>();
  private membershipCache = new Map<string, TeamMembership>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private teamTasks = new Map<string, Map<string, TeamTask>>();

  destroy(): void {
    this.stop();
    this.configs.clear();
    this.membershipCache.clear();
    this.teamTasks.clear();
  }

  /**
   * Enrich an agent event with team metadata (mutates in-place).
   *
   * Detection priority:
   * 1. Event already has teamName/teammateName (from TeammateIdle/TaskCompleted) → cache & apply
   * 2. sessionId already cached → apply cached team info
   * 3. paneId matches a team config member's tmuxPaneId → cache & apply
   * 4. sessionId matches a config's leadSessionId → cache & apply
   */
  enrichEvent(event: AgentEvent): void {
    // 1. Event carries team fields directly (TeammateIdle/TaskCompleted)
    if (event.teamName) {
      const membership: TeamMembership = {
        teamName: event.teamName,
        teamRole: event.teammateName ? "teammate" : "lead",
        teammateName: event.teammateName,
      };
      this.membershipCache.set(event.sessionId, membership);
      event.teamRole = membership.teamRole;
      // Emit event so session store can retroactively enrich other sessions in this team
      this.emit("team-info-learned", event.teamName);
      return;
    }

    // 2. Already cached from a previous event
    const cached = this.membershipCache.get(event.sessionId);
    if (cached) {
      event.teamName = cached.teamName;
      event.teammateName = cached.teammateName;
      event.teamRole = cached.teamRole;
      return;
    }

    // 3. Match paneId against team config members' tmuxPaneId
    if (event.paneId) {
      for (const config of this.configs.values()) {
        for (const member of config.members) {
          if (member.tmuxPaneId && member.tmuxPaneId === event.paneId) {
            const isLead = member.teamRole === "lead" || member.agentType === "team-lead";
            const membership: TeamMembership = {
              teamName: config.name,
              teamRole: isLead ? "lead" : "teammate",
              teammateName: isLead ? undefined : member.name,
            };
            this.membershipCache.set(event.sessionId, membership);
            event.teamName = membership.teamName;
            event.teammateName = membership.teammateName;
            event.teamRole = membership.teamRole;
            return;
          }
        }
      }
    }

    // 4. Match sessionId against leadSessionId in configs
    for (const config of this.configs.values()) {
      if (config.leadSessionId === event.sessionId) {
        const membership: TeamMembership = {
          teamName: config.name,
          teamRole: "lead",
        };
        this.membershipCache.set(event.sessionId, membership);
        event.teamName = membership.teamName;
        event.teamRole = membership.teamRole;
        return;
      }
    }
  }

  getTeamForSession(sessionId: string): TeamMembership | undefined {
    return this.membershipCache.get(sessionId);
  }

  getTeams(): TeamState[] {
    const teams: TeamState[] = [];
    for (const [name, config] of this.configs) {
      teams.push({
        config,
        name,
        tasks: this.teamTasks.get(name) ?? new Map(),
      });
    }
    return teams;
  }

  start(): void {
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const configs = await scanTeamConfigs();
      // Detect newly discovered configs (not previously known)
      const newConfigs: TeamConfig[] = [];
      for (const config of configs) {
        if (!this.configs.has(config.name)) {
          newConfigs.push(config);
        }
      }
      this.configs.clear();
      for (const config of configs) {
        this.configs.set(config.name, config);
      }

      // Scan tasks for each known team
      for (const name of this.configs.keys()) {
        const tasks = await scanTeamTasks(name);
        const taskMap = new Map<string, TeamTask>();
        for (const task of tasks) {
          taskMap.set(task.id, task);
        }
        this.teamTasks.set(name, taskMap);
      }

      // If new configs were discovered, emit so that existing sessions can be
      // retroactively enriched with team metadata they missed on first event.
      if (newConfigs.length > 0) {
        this.emit("configs-discovered", newConfigs);
      }
    } catch {
      // poll failure — keep stale data
    }
  }
}
