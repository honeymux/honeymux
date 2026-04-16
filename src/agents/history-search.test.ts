import { describe, expect, test } from "bun:test";

import type { HistoryEntry } from "./history-search.ts";

import { queryHistorySessions } from "./history-search.ts";

function makeEntry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    agentType: "codex",
    filePath: "/tmp/history.jsonl",
    text: "prompt",
    timestamp: 1,
    ...overrides,
  };
}

describe("queryHistorySessions", () => {
  test("deduplicates empty-query results to one row per resumable session", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ sessionId: "sess-1", text: "latest prompt", timestamp: 300 }),
      makeEntry({ sessionId: "sess-1", text: "older prompt", timestamp: 200 }),
      makeEntry({ agentType: "claude", sessionId: "sess-2", text: "other session", timestamp: 100 }),
    ];

    const result = queryHistorySessions(entries, "", { limit: 10 });

    expect(result.results.map((entry) => entry.text)).toEqual(["latest prompt", "other session"]);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  test("returns the newest matching prompt for each session when filtering", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ sessionId: "sess-1", text: "latest unrelated prompt", timestamp: 400 }),
      makeEntry({ sessionId: "sess-1", text: "deploy the app", timestamp: 300 }),
      makeEntry({ sessionId: "sess-1", text: "deploy the app again", timestamp: 200 }),
      makeEntry({ agentType: "claude", sessionId: "sess-2", text: "deploy elsewhere", timestamp: 100 }),
    ];

    const result = queryHistorySessions(entries, "deploy", { limit: 10 });

    expect(result.results.map((entry) => [entry.sessionId, entry.text])).toEqual([
      ["sess-1", "deploy the app"],
      ["sess-2", "deploy elsewhere"],
    ]);
    expect(result.total).toBe(2);
  });

  test("supports case-sensitive substring matching when enabled", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ sessionId: "sess-1", text: "Deploy the app", timestamp: 300 }),
      makeEntry({ sessionId: "sess-2", text: "deploy the docs", timestamp: 200 }),
    ];

    const result = queryHistorySessions(entries, "Deploy", { caseSensitive: true, limit: 10 });

    expect(result.results.map((entry) => entry.sessionId)).toEqual(["sess-1"]);
    expect(result.total).toBe(1);
    expect(result.error).toBeUndefined();
  });

  test("supports regex matching when enabled", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ sessionId: "sess-1", text: "latest unrelated prompt", timestamp: 400 }),
      makeEntry({ sessionId: "sess-1", text: "ship v1.2.3 today", timestamp: 300 }),
      makeEntry({ sessionId: "sess-2", text: "ship v2.0.0 tomorrow", timestamp: 200 }),
    ];

    const result = queryHistorySessions(entries, String.raw`ship v\d+\.\d+\.\d+`, { limit: 10, regex: true });

    expect(result.results.map((entry) => [entry.sessionId, entry.text])).toEqual([
      ["sess-1", "ship v1.2.3 today"],
      ["sess-2", "ship v2.0.0 tomorrow"],
    ]);
    expect(result.total).toBe(2);
    expect(result.error).toBeUndefined();
  });

  test("returns a regex error instead of partial results when the pattern is invalid", () => {
    const entries: HistoryEntry[] = [makeEntry({ sessionId: "sess-1", text: "deploy the app", timestamp: 100 })];

    const result = queryHistorySessions(entries, "(", { limit: 10, regex: true });

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("supports stable pagination across session results", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ sessionId: "sess-1", text: "one", timestamp: 400 }),
      makeEntry({ sessionId: "sess-2", text: "two", timestamp: 300 }),
      makeEntry({ sessionId: "sess-3", text: "three", timestamp: 200 }),
      makeEntry({ sessionId: "sess-4", text: "four", timestamp: 100 }),
    ];

    const firstPage = queryHistorySessions(entries, "", { limit: 2, offset: 0 });
    const secondPage = queryHistorySessions(entries, "", { limit: 2, offset: 2 });

    expect(firstPage.results.map((entry) => entry.sessionId)).toEqual(["sess-1", "sess-2"]);
    expect(firstPage.total).toBe(4);
    expect(firstPage.hasMore).toBe(true);

    expect(secondPage.results.map((entry) => entry.sessionId)).toEqual(["sess-3", "sess-4"]);
    expect(secondPage.total).toBe(4);
    expect(secondPage.hasMore).toBe(false);
  });

  test("keeps entries without session ids searchable as standalone rows", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ agentType: "claude", sessionId: undefined, text: "first standalone", timestamp: 200 }),
      makeEntry({ agentType: "claude", sessionId: undefined, text: "second standalone", timestamp: 100 }),
    ];

    const result = queryHistorySessions(entries, "standalone", { limit: 10 });

    expect(result.results.map((entry) => entry.text)).toEqual(["first standalone", "second standalone"]);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
  });
});
