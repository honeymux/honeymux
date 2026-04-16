import { join } from "node:path";

import type { HistoryEntry } from "../history-search";

import { getMtime } from "../history-search";

const HOME = process.env.HOME ?? "/root";

export async function collectGeminiHistory(): Promise<{
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
  trackedFiles: string[];
}> {
  const fileStates: Record<string, { mtime: number }> = {};
  const entries: HistoryEntry[] = [];

  const geminiFiles = await globGeminiFiles();
  for (const f of geminiFiles) {
    const mtime = await getMtime(f);
    if (mtime !== null) {
      fileStates[f] = { mtime };
      try {
        const content = await Bun.file(f).text();
        entries.push(...parseGeminiSessionContent(content, f));
      } catch {}
    }
  }

  return { entries, fileStates, trackedFiles: geminiFiles };
}

export async function globGeminiFiles(): Promise<string[]> {
  const geminiTmpDir = join(HOME, ".gemini/tmp");
  try {
    const glob = new Bun.Glob("*/chats/session*.json");
    const files: string[] = [];
    for await (const f of glob.scan(geminiTmpDir)) {
      files.push(join(geminiTmpDir, f));
    }
    return files;
  } catch {
    return [];
  }
}

/** Extract the project name from a gemini session file path.
 *  Paths look like: ~/.gemini/tmp/<project>/chats/session*.json */
function extractGeminiProject(filePath: string): string | undefined {
  const match = /\/\.gemini\/tmp\/([^/]+)\/chats\//.exec(filePath);
  return match?.[1];
}

function parseGeminiSessionContent(content: string, filePath: string): HistoryEntry[] {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    const sessionId = obj["sessionId"] ? String(obj["sessionId"]) : undefined;
    const project = extractGeminiProject(filePath);
    const messages: unknown[] = Array.isArray(obj["messages"]) ? obj["messages"] : [];
    const entries: HistoryEntry[] = [];
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      if (m["type"] !== "user") continue;
      const content = Array.isArray(m["content"]) ? m["content"] : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        const partText = p["text"];
        if (typeof partText === "string" && partText.trim()) {
          entries.push({
            agentType: "gemini",
            filePath,
            project,
            sessionId,
            text: partText.trim(),
            timestamp:
              typeof m["timestamp"] === "number"
                ? m["timestamp"]
                : typeof m["timestamp"] === "string"
                  ? new Date(m["timestamp"]).getTime()
                  : typeof m["createdAt"] === "number"
                    ? m["createdAt"]
                    : typeof m["createdAt"] === "string"
                      ? new Date(m["createdAt"]).getTime()
                      : Date.now(),
          });
        }
      }
    }
    return entries;
  } catch {
    return [];
  }
}
