export interface TeamConfig {
  leadSessionId: string;
  members: TeamMember[];
  name: string; // derived from directory name
}

export interface TeamMembership {
  teamName: string;
  teamRole: TeamRole;
  teammateName?: string;
}

export interface TeamState {
  config: TeamConfig;
  name: string;
  tasks: Map<string, TeamTask>;
}

export interface TeamTask {
  description?: string;
  id: string;
  metadata?: { _internal?: boolean };
  status: "completed" | "in_progress" | "pending";
  subject: string;
}

interface TeamMember {
  agentId: string;
  agentType?: string;
  backendType?: string;
  color?: string;
  cwd?: string;
  joinedAt?: string;
  model?: string;
  name: string;
  prompt?: string;
  teamRole?: TeamRole;
  tmuxPaneId?: string;
}

type TeamRole = "lead" | "teammate";
