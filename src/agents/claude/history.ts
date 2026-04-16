import { join } from "node:path";

import type { HistoryEntry } from "../history-search";

import { getMtime } from "../history-search";

const HOME = process.env.HOME ?? "/root";
const CLAUDE_HISTORY_FILE = join(HOME, ".claude/history.jsonl");

export async function collectClaudeHistory(): Promise<{
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
}> {
  const fileStates: Record<string, { mtime: number }> = {};
  const entries: HistoryEntry[] = [];

  const mtime = await getMtime(CLAUDE_HISTORY_FILE);
  if (mtime !== null) {
    fileStates[CLAUDE_HISTORY_FILE] = { mtime };
    try {
      const content = await Bun.file(CLAUDE_HISTORY_FILE).text();
      entries.push(...parseClaudeHistoryContent(content, CLAUDE_HISTORY_FILE));
    } catch {}
  }

  return { entries, fileStates };
}

function parseClaudeHistoryContent(content: string, filePath: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const text = obj.display ?? obj.prompt ?? "";
      if (!text) continue;
      entries.push({
        agentType: "claude",
        filePath,
        project: obj.project ? String(obj.project) : undefined,
        sessionId: obj.sessionId ? String(obj.sessionId) : undefined,
        text: String(text).trim(),
        timestamp: typeof obj.timestamp === "number" ? obj.timestamp : Date.now(),
      });
    } catch {}
  }
  return entries;
}
