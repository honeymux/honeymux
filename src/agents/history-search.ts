import { mkdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { HistorySearchOptions } from "./history-search-query.ts";

import { log } from "../util/log.ts";
import { collectClaudeHistory } from "./claude/history";
import { collectCodexHistory } from "./codex/history";
import { collectGeminiHistory, globGeminiFiles } from "./gemini/history";
import { compileHistorySearchMatcher } from "./history-search-query.ts";
import { collectOpenCodeHistory } from "./opencode/history";

export interface HistoryEntry {
  agentType: HistoryAgentType;
  filePath: string;
  project?: string;
  sessionId?: string;
  text: string;
  timestamp: number;
}

export interface HistoryQueryResult {
  error?: string;
  hasMore: boolean;
  results: HistoryEntry[];
  total: number;
}

type HistoryAgentType = "claude" | "codex" | "gemini" | "opencode";

interface HistoryQueryOptions extends HistorySearchOptions {
  limit?: number;
  offset?: number;
}

const HOME = process.env.HOME ?? "/root";
const STATE_DIR = join(HOME, ".local/state/honeymux");
const CACHE_FILE = join(STATE_DIR, "history-cache.json");
const CACHE_VERSION = 2;
const MAX_ENTRIES = 10000;

interface CacheFile {
  createdAt: number;
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
  geminiTrackedFiles: string[];
  version: number;
}

// --- File system helpers ---

class HistoryIndex {
  /** Per-agent conversation counts from the most recent index. */
  agentCounts: Partial<Record<HistoryAgentType, number>> = {};
  onReady?: () => void;
  status: "loading" | "ready" = "loading";
  private _entries: HistoryEntry[] = [];
  private _isReloading = false;
  private _loadStarted = false;

  async loadAsync(options?: { verbose?: boolean }): Promise<void> {
    if (this._loadStarted) return;
    this._loadStarted = true;
    const verbose = options?.verbose ?? false;
    if (verbose) log("history", "history indexing: start");
    try {
      const geminiFiles = await globGeminiFiles();
      const cache = await readCache();
      if (cache && (await isCacheFresh(cache, geminiFiles))) {
        this._entries = cache.entries;
        // Derive per-agent counts from cached entries
        const counts: Partial<Record<HistoryAgentType, number>> = {};
        for (const e of this._entries) counts[e.agentType] = (counts[e.agentType] ?? 0) + 1;
        this.agentCounts = counts;
        if (verbose) log("history", `history indexing: done (${this._entries.length} entries from cache)`);
      } else {
        const { agentCounts, entries, fileStates, geminiTrackedFiles } = await buildEntries();
        this._entries = entries;
        this.agentCounts = agentCounts;
        await writeCache({
          createdAt: Date.now(),
          entries,
          fileStates,
          geminiTrackedFiles,
          version: CACHE_VERSION,
        });
        if (verbose) log("history", `history indexing: done (${this._entries.length} entries indexed)`);
      }
    } catch {
      this._entries = [];
      if (verbose) log("history", "history indexing: failed");
    }
    this.status = "ready";
    this.onReady?.();
  }

  querySessions(query: string, options: HistoryQueryOptions = {}): HistoryQueryResult {
    return queryHistorySessions(this._entries, query, options);
  }

  async reload(options?: { verbose?: boolean }): Promise<void> {
    if (this._isReloading) return;
    this._isReloading = true;
    this._loadStarted = false;
    this._entries = [];
    this.status = "loading";
    const previousOnReady = this.onReady;
    this.onReady = () => {
      this._isReloading = false;
      previousOnReady?.();
    };
    await this.loadAsync(options);
  }
}

// --- Cache ---

export async function getMtime(filePath: string): Promise<null | number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

export function queryHistorySessions(
  entries: HistoryEntry[],
  query: string,
  options: HistoryQueryOptions = {},
): HistoryQueryResult {
  const limit = Math.max(0, options.limit ?? 50);
  const offset = Math.max(0, options.offset ?? 0);
  const matcher = compileHistorySearchMatcher(query, options);
  if (matcher.error) {
    return {
      error: matcher.error,
      hasMore: false,
      results: [],
      total: 0,
    };
  }
  const seen = new Set<string>();
  const results: HistoryEntry[] = [];
  let total = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (matcher.active && !matcher.matches(entry.text) && !matcher.matches(entry.project)) continue;

    const key = getConversationKey(entry, i);
    if (seen.has(key)) continue;
    seen.add(key);

    if (total >= offset && results.length < limit) {
      results.push(entry);
    }
    total++;
  }

  return {
    hasMore: offset + results.length < total,
    results,
    total,
  };
}

async function buildEntries(): Promise<{
  agentCounts: Partial<Record<HistoryAgentType, number>>;
  entries: HistoryEntry[];
  fileStates: Record<string, { mtime: number }>;
  geminiTrackedFiles: string[];
}> {
  const [claude, opencode, gemini, codex] = await Promise.all([
    collectWithLog("claude", collectClaudeHistory),
    collectWithLog("opencode", collectOpenCodeHistory),
    collectWithLog("gemini", collectGeminiHistory),
    collectWithLog("codex", collectCodexHistory),
  ]);

  const fileStates = { ...claude.fileStates, ...opencode.fileStates, ...gemini.fileStates, ...codex.fileStates };
  const allEntries = [...claude.entries, ...opencode.entries, ...gemini.entries, ...codex.entries];
  allEntries.sort((a, b) => b.timestamp - a.timestamp);

  const agentCounts: Partial<Record<HistoryAgentType, number>> = {};
  if (claude.entries.length > 0) agentCounts.claude = claude.entries.length;
  if (opencode.entries.length > 0) agentCounts.opencode = opencode.entries.length;
  if (gemini.entries.length > 0) agentCounts.gemini = gemini.entries.length;
  if (codex.entries.length > 0) agentCounts.codex = codex.entries.length;

  return {
    agentCounts,
    entries: allEntries.slice(0, MAX_ENTRIES),
    fileStates,
    geminiTrackedFiles: gemini.trackedFiles,
  };
}

// --- Build index from disk ---

async function collectWithLog<T>(name: string, fn: () => Promise<T>): Promise<T> {
  log("history", `indexing ${name}: start`);
  const result = await fn();
  log("history", `indexing ${name}: done`);
  return result;
}

function getConversationKey(entry: HistoryEntry, index: number): string {
  if (entry.sessionId) return `${entry.agentType}:${entry.sessionId}`;
  return `entry:${index}`;
}

async function isCacheFresh(cache: CacheFile, geminiFiles: string[]): Promise<boolean> {
  for (const [filePath, { mtime }] of Object.entries(cache.fileStates)) {
    const current = await getMtime(filePath);
    if (current === null || current !== mtime) return false;
  }
  const cachedGemini = new Set(cache.geminiTrackedFiles);
  const currentGemini = new Set(geminiFiles);
  if (cachedGemini.size !== currentGemini.size) return false;
  for (const f of currentGemini) {
    if (!cachedGemini.has(f)) return false;
  }
  return true;
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const text = await Bun.file(CACHE_FILE).text();
    const parsed = JSON.parse(text) as CacheFile;
    if (parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

// --- Singleton ---

async function writeCache(cache: CacheFile): Promise<void> {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

export const historyIndex = new HistoryIndex();

// --- Consent ---

const CONSENT_FILE_PATH = join(STATE_DIR, "history-consent.json");
const RESUME_SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;

/**
 * Persist that the user dismissed a history-indexing info.
 */
export async function acknowledgeIndexingInfo(id: string): Promise<void> {
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(CONSENT_FILE_PATH, "utf-8"));
    } catch {}
    const acked = new Set<string>(
      Array.isArray(existing["acknowledgedIndexingInfos"]) ? (existing["acknowledgedIndexingInfos"] as string[]) : [],
    );
    acked.add(id);
    existing["acknowledgedIndexingInfos"] = [...acked];
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE_PATH, JSON.stringify(existing));
  } catch {}
}

/**
 * Return the set of history-indexing info IDs the user has already dismissed.
 */
export function getAcknowledgedIndexingInfos(): Set<string> {
  try {
    const content = readFileSync(CONSENT_FILE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.acknowledgedIndexingInfos)) {
      return new Set(parsed.acknowledgedIndexingInfos as string[]);
    }
  } catch {}
  return new Set();
}

export function getResumeArgs(entry: HistoryEntry): null | string[] {
  if (!entry.sessionId) return null;
  if (!RESUME_SESSION_ID_RE.test(entry.sessionId)) return null;
  switch (entry.agentType) {
    case "claude":
      return ["claude", "--resume", entry.sessionId];
    case "codex":
      return ["codex", "resume", entry.sessionId];
    case "gemini":
      return ["gemini", "--resume", entry.sessionId];
    case "opencode":
      return ["opencode", "--session", entry.sessionId];
  }
}

/**
 * Read the stored consent decision.
 * Returns true if granted, false if denied, null if never asked.
 */
export function hasHistoryConsent(): boolean | null {
  try {
    const content = readFileSync(CONSENT_FILE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return parsed.granted === true ? true : false;
  } catch {
    return null; // file not found = never asked
  }
}

export async function saveHistoryConsent(granted: boolean): Promise<void> {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    // Preserve existing fields (e.g. acknowledgedIndexingInfos)
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(CONSENT_FILE_PATH, "utf-8"));
    } catch {}
    await Bun.write(CONSENT_FILE_PATH, JSON.stringify({ ...existing, granted, savedAt: Date.now() }));
  } catch {}
}
