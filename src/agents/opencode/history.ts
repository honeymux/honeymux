import { Database } from "bun:sqlite";
import { join } from "node:path";

import type { HistoryEntry } from "../history-search";

import { getMtime } from "../history-search";

const HOME = process.env.HOME ?? "/root";
const OPENCODE_HISTORY_FILE = join(HOME, ".local/state/opencode/prompt-history.jsonl");
const OPENCODE_DB_FILE = join(HOME, ".local/share/opencode/opencode.db");

export async function collectOpenCodeHistory(): Promise<{
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
}> {
  const fileStates: Record<string, { mtime: number }> = {};
  const entries: HistoryEntry[] = [];

  // Prefer SQLite DB (has session IDs, timestamps, and project info)
  const dbMtime = await getMtime(OPENCODE_DB_FILE);
  if (dbMtime !== null) {
    fileStates[OPENCODE_DB_FILE] = { mtime: dbMtime };
    entries.push(...collectFromDb());
  }

  // Fall back to JSONL if DB yielded nothing
  if (entries.length === 0) {
    const mtime = await getMtime(OPENCODE_HISTORY_FILE);
    if (mtime !== null) {
      fileStates[OPENCODE_HISTORY_FILE] = { mtime };
      try {
        const content = await Bun.file(OPENCODE_HISTORY_FILE).text();
        entries.push(...parseOpenCodeHistoryContent(content, OPENCODE_HISTORY_FILE, mtime));
      } catch {}
    }
  }

  return { entries, fileStates };
}

function collectFromDb(): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  try {
    const db = new Database(OPENCODE_DB_FILE, { readonly: true });
    const rows = db
      .query(
        `
      SELECT p.session_id, s.directory, p.time_created, json_extract(p.data, '$.text') AS text
      FROM part p
      JOIN message m ON p.message_id = m.id
      JOIN session s ON p.session_id = s.id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
      ORDER BY p.time_created DESC
    `,
      )
      .all() as { directory: string; session_id: string; text: string; time_created: number }[];
    for (const row of rows) {
      const text = (row.text ?? "").trim();
      if (!text) continue;
      entries.push({
        agentType: "opencode",
        filePath: OPENCODE_DB_FILE,
        project: row.directory || undefined,
        sessionId: row.session_id,
        text,
        timestamp: row.time_created,
      });
    }
    db.close();
  } catch {}
  return entries;
}

function parseOpenCodeHistoryContent(content: string, filePath: string, fileMtime: number): HistoryEntry[] {
  const lines = content.split("\n").filter((l) => l.trim());
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]!);
      let text = "";
      if (typeof obj.input === "string") {
        text = obj.input.trim();
      } else if (Array.isArray(obj.parts)) {
        text = obj.parts
          .filter(
            (p: unknown) => typeof p === "object" && p !== null && (p as Record<string, unknown>)["type"] === "text",
          )
          .map((p: unknown) => String((p as Record<string, unknown>)["text"] ?? ""))
          .join(" ")
          .trim();
      }
      if (!text) continue;
      entries.push({
        agentType: "opencode",
        filePath,
        text,
        // No timestamps in OpenCode history; use file mtime with small offsets to preserve order
        timestamp: fileMtime - (lines.length - i) * 1000,
      });
    } catch {}
  }
  return entries;
}
