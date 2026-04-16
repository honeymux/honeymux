import {
  type ProcessSnapshotEntry,
  collectProcessSubtreeCommandLines,
  getProcessSnapshotEntriesSync,
  normalizeTtyPath,
} from "../../util/process-introspection.ts";

export type AgentType = "claude" | "codex" | "gemini" | "opencode";

const DIRECT_AGENT_COMMANDS: Record<string, AgentType> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
};

const WRAPPED_AGENT_PATTERNS: Array<{ pattern: RegExp; type: AgentType }> = [
  { pattern: /\bclaude\b/i, type: "claude" },
  { pattern: /\bcodex\b/i, type: "codex" },
  { pattern: /\bgemini\b/i, type: "gemini" },
  { pattern: /\bopencode\b/i, type: "opencode" },
];

export interface PaneProcessSnapshot {
  command: string;
  pid: number;
  tty: null | string;
}

export function detectRunningAgentTypes(
  paneListOutput: string,
  readProcessEntries: () => ProcessSnapshotEntry[] = getProcessSnapshotEntriesSync,
): Set<AgentType> {
  const running = new Set<AgentType>();
  let processEntries: ProcessSnapshotEntry[] | null = null;

  for (const pane of parsePaneProcessSnapshots(paneListOutput)) {
    const direct = DIRECT_AGENT_COMMANDS[pane.command];
    if (direct) {
      running.add(direct);
      continue;
    }

    if ((!Number.isInteger(pane.pid) || pane.pid <= 1) && pane.tty === null) continue;
    processEntries ??= readProcessEntries();

    for (const commandLine of collectPaneProcessCommandLines(pane, processEntries)) {
      const detected = detectWrappedAgentType(commandLine);
      if (detected) running.add(detected);
    }
  }

  return running;
}

export function detectWrappedAgentType(commandLine: string): AgentType | undefined {
  for (const wrapped of WRAPPED_AGENT_PATTERNS) {
    if (wrapped.pattern.test(commandLine)) return wrapped.type;
  }
  return undefined;
}

export function parsePaneProcessSnapshots(output: string): PaneProcessSnapshot[] {
  const panes: PaneProcessSnapshot[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tabFields = trimmed.split("\t");
    if (tabFields.length >= 3) {
      const command = tabFields[0]?.trim() ?? "";
      const pid = parseInt(tabFields[1] ?? "", 10);
      const tty = normalizeTtyPath(tabFields[2]);
      if (!command) continue;
      panes.push({
        command,
        pid: Number.isInteger(pid) ? pid : NaN,
        tty,
      });
      continue;
    }

    const spaceIdx = trimmed.indexOf(" ");
    const command = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const pid = spaceIdx > 0 ? parseInt(trimmed.slice(spaceIdx + 1), 10) : NaN;
    if (!command) continue;
    panes.push({
      command,
      pid: Number.isInteger(pid) ? pid : NaN,
      tty: null,
    });
  }
  return panes;
}

function collectPaneProcessCommandLines(pane: PaneProcessSnapshot, entries: ProcessSnapshotEntry[]): string[] {
  const commands = new Set<string>();

  if (Number.isInteger(pane.pid) && pane.pid > 1) {
    for (const command of collectProcessSubtreeCommandLines(pane.pid, entries)) {
      if (command) commands.add(command);
    }
  }

  if (pane.tty !== null) {
    for (const entry of entries) {
      if (entry.tty !== pane.tty || !entry.command) continue;
      commands.add(entry.command);
    }
  }

  return [...commands];
}
