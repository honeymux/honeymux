import { describe, expect, test } from "bun:test";

import { buildHistoryIndexingInfoItems, buildNotificationsQueue } from "./use-notifications-review.ts";

describe("notifications review helpers", () => {
  test("builds the queue in ssh, agent, info order", () => {
    const queue = buildNotificationsQueue(
      new Map([
        ["alpha", { at: 2, message: "down" }],
        ["beta", { at: 1, message: "down" }],
      ]),
      ["gemini", "claude"],
      [{ id: "info-1", message: "note" }],
    );

    expect(queue).toEqual([
      { kind: "ssh", server: "beta" },
      { kind: "ssh", server: "alpha" },
      { agent: "gemini", kind: "agent" },
      { agent: "claude", kind: "agent" },
      { id: "info-1", kind: "info", message: "note" },
    ]);
  });

  test("builds history indexing info items and filters acknowledged ids", () => {
    const items = buildHistoryIndexingInfoItems(
      {
        claude: 2,
        codex: 1,
      },
      new Set(["history-indexing-codex"]),
    );

    expect(items).toEqual([
      {
        id: "history-indexing-claude",
        kind: "info",
        message: "Completed indexing 2 conversations for Claude Code",
      },
    ]);
  });
});
