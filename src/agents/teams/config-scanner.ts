import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { TeamConfig, TeamTask } from "./types.ts";

const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const TEAMS_DIR = join(CLAUDE_DIR, "teams");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

export async function scanTeamConfigs(): Promise<TeamConfig[]> {
  const configs: TeamConfig[] = [];
  let teamDirs: string[];
  try {
    teamDirs = readdirSync(TEAMS_DIR);
  } catch {
    return configs;
  }

  for (const name of teamDirs) {
    const configPath = join(TEAMS_DIR, name, "config.json");
    try {
      const file = Bun.file(configPath);
      const data = await file.json();
      configs.push({
        leadSessionId: data.leadSessionId,
        members: data.members ?? [],
        name,
      });
    } catch {
      // skip malformed or unreadable configs
    }
  }
  return configs;
}

export async function scanTeamTasks(teamName: string): Promise<TeamTask[]> {
  const tasks: TeamTask[] = [];
  const taskDir = join(TASKS_DIR, teamName);
  let entries: string[];
  try {
    entries = readdirSync(taskDir);
  } catch {
    return tasks;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const file = Bun.file(join(taskDir, entry));
      const data = await file.json();
      tasks.push({
        description: data.description,
        id: data.id,
        metadata: data.metadata,
        status: data.status ?? "pending",
        subject: data.subject,
      });
    } catch {
      // skip
    }
  }
  return tasks;
}
