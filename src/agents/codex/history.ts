import { join } from "node:path";

import type { HistoryEntry } from "../history-search";

import { getMtime } from "../history-search";

const HOME = process.env.HOME ?? "/root";

export async function collectCodexHistory(): Promise<{
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
}> {
  const fileStates: Record<string, { mtime: number }> = {};
  const entries: HistoryEntry[] = [];

  const codexFiles = await globCodexFiles();
  for (const f of codexFiles) {
    const mtime = await getMtime(f);
    if (mtime !== null) {
      fileStates[f] = { mtime };
      try {
        const content = await Bun.file(f).text();
        const sessionId = extractCodexSessionId(f);
        entries.push(...parseCodexJSONLContent(content, f, sessionId));
      } catch {}
    }
  }

  return { entries, fileStates };
}

function extractCodexSessionId(filePath: string): string | undefined {
  const match = /rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(filePath);
  return match?.[1];
}

async function globCodexFiles(): Promise<string[]> {
  const codexSessionsDir = join(HOME, ".codex/sessions");
  try {
    const glob = new Bun.Glob("**/*.jsonl");
    const files: string[] = [];
    for await (const f of glob.scan(codexSessionsDir)) {
      files.push(join(codexSessionsDir, f));
    }
    return files;
  } catch {
    return [];
  }
}

function parseCodexJSONLContent(content: string, filePath: string, sessionId?: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let project: string | undefined;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // Extract cwd from session_meta line
      const payload = obj["payload"];
      if (obj["type"] === "session_meta" && payload && typeof payload === "object" && "cwd" in payload) {
        project = String((payload as Record<string, unknown>)["cwd"]);
        continue;
      }

      // Session files wrap messages: {type:"response_item", payload:{role:"user", content:[...]}}
      const msg =
        obj["type"] === "response_item" && payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : obj;
      const role = msg["role"] ?? msg["type"];
      if (role !== "user" && role !== "human") continue;

      let text = "";
      if (typeof msg["content"] === "string") {
        text = msg["content"].trim();
      } else if (Array.isArray(msg["content"])) {
        text = msg["content"]
          .filter((p: unknown) => {
            if (typeof p !== "object" || p === null) return false;
            const t = (p as Record<string, unknown>)["type"];
            return t === "text" || t === "input_text";
          })
          .map((p: unknown) => String((p as Record<string, unknown>)["text"] ?? ""))
          .join(" ")
          .trim();
      }
      if (!text) continue;

      const ts = obj["timestamp"] ?? msg["timestamp"];
      entries.push({
        agentType: "codex",
        filePath,
        project,
        sessionId,
        text,
        timestamp: typeof ts === "string" ? new Date(ts).getTime() : typeof ts === "number" ? ts : Date.now(),
      });
    } catch {}
  }
  return entries;
}
