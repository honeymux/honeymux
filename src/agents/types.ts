export interface AgentAnimationConfig {
  alive: { char: string; color: string };
  unanswered: { char: string; color: string };
}

export type AgentStatus = "alive" | "ended" | "unanswered";

export type AgentType = "claude" | "codex" | "gemini" | "opencode";

/**
 * Brand color per agent type. Used to visually identify the agent provider
 * in lists and trees.
 */
export const AGENT_COLORS: Record<AgentType, string> = {
  claude: "#f0923e",
  codex: "#5b9cf5",
  gemini: "#b07df0",
  opencode: "#b0b0b0",
};

export const CLAUDE_ANIMATIONS: AgentAnimationConfig = {
  alive: { char: "\u00b7", color: "#66bf73" },
  unanswered: { char: "\u25cf", color: "#ffb300" },
};

export const OPENCODE_ANIMATIONS: AgentAnimationConfig = {
  alive: { char: "\u00b7", color: "#66bf73" },
  unanswered: { char: "\u25cf", color: "#ffb300" },
};

export const GEMINI_ANIMATIONS: AgentAnimationConfig = {
  alive: { char: "\u00b7", color: "#A6E3A1" },
  unanswered: { char: "\u25cf", color: "#F9E2AF" },
};

export const CODEX_ANIMATIONS: AgentAnimationConfig = {
  alive: { char: "\u00b7", color: "#66bf73" },
  unanswered: { char: "\u25cf", color: "#ffb300" },
};

export interface HoneymuxAnimationConfig {
  idle: { color: string; frames: string[]; intervalMs: number; width: number };
  needInput: { color: string; frames: string[]; intervalMs: number; width: number };
  needInputFocused: { color: string; frames: string[]; intervalMs: number; width: number };
  sleeping: { color: string; frames: string[]; intervalMs: number; width: number };
}

export type HoneymuxState = "idle" | "needInput" | "needInputFocused" | "sleeping";

export const HONEYMUX_ANIMATIONS: HoneymuxAnimationConfig = {
  // Idle — random blink every 10-30s (< 5 min idle)
  idle: {
    color: "#888888",
    frames: ["ʕ·ᴥ·ʔ", "ʕ-ᴥ-ʔ"],
    intervalMs: 150, // blink duration (eyes closed)
    width: 6,
  },
  // Need input — blink every 5s (eyes blank for 1s)
  needInput: {
    color: "#ffb300",
    frames: ["ʕ·ᴥ·ʔ", "ʕ ᴥ ʔ"],
    intervalMs: 1000, // blink duration
    width: 6,
  },
  // Need input, but the waiting agent is in the focused pane — orange, calm
  // (no border glow, no counter hiding, no expansion). The user can see the
  // pane directly, so the mascot just changes color to signal the state.
  needInputFocused: {
    color: "#d97857",
    frames: ["ʕ·ᴥ·ʔ", "ʕ ᴥ ʔ"],
    intervalMs: 1000, // blink duration
    width: 6,
  },
  // Sleeping — zzz (>= 5 min idle)
  sleeping: {
    color: "#666666",
    frames: ["ʕ-ᴥ-ʔ", "ʕ-ᴥ-ʔz", "ʕ-ᴥ-ʔzz", "ʕ-ᴥ-ʔzzz", "ʕ-ᴥ-ʔzz", "ʕ-ᴥ-ʔz"],
    intervalMs: 700,
    width: 9,
  },
};

export interface AgentEvent {
  agentType: AgentType;
  cwd: string;
  hookEvent?: string;
  /** Set only by trusted remote transports, never by hook payloads. */
  isRemote?: boolean;
  notification?: string;
  paneId?: string;
  pid?: number;
  prompt?: string;
  /** Hostname of the machine where the agent is running. */
  remoteHost?: string;
  /** Friendly name of the remote server connection from Honeymux config. */
  remoteServerName?: string;
  /** OpenCode server URL for REST API permission responses. */
  serverUrl?: string;
  sessionId: string;
  sessionName?: string;
  status: AgentStatus;
  teamName?: string;
  teamRole?: "lead" | "teammate";
  teammateName?: string;
  timestamp: number;
  toolInput?: Record<string, unknown>;
  toolName?: string;
  toolUseId?: string;
  transcriptPath?: string;
  tty?: string;
  windowId?: string;
}

export interface AgentSession {
  agentType: AgentType;
  conversationLabel?: string;
  cwd: string;
  /** True if the user dismissed this permission request (suppresses muxotronEnabled expansion but stays unanswered). */
  dismissed?: boolean;
  /** True if this session is running on a remote machine. */
  isRemote?: boolean;
  lastEvent: AgentEvent;
  paneId?: string;
  /** Hostname of the remote machine, or undefined for local sessions. */
  remoteHost?: string;
  /** Friendly name of the remote server connection from Honeymux config. */
  remoteServerName?: string;
  sessionId: string;
  sessionName?: string;
  startedAt: number;
  status: AgentStatus;
  teamName?: string;
  teamRole?: "lead" | "teammate";
  teammateName?: string;
  transcriptPath?: string;
  windowId?: string;
}

/** A single hook event captured for the hook sniffer view. */
export interface HookSnifferEntry {
  agentType: AgentType;
  hookEvent: string;
  pid?: number;
  sessionId: string;
  status: AgentStatus;
  timestamp: number;
  toolInput?: Record<string, unknown>;
  toolName?: string;
}

export interface ToolPermissionInfo {
  /** Full multi-line detail for zoomed mux-o-tron view */
  detail: string;
  /** Single-line compact summary for unzoomed mux-o-tron / agents dialog status */
  summary: string;
}
