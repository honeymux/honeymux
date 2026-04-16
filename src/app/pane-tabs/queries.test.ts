import { describe, expect, test } from "bun:test";

import { parsePaneWindowIdMap, parseWindowNameMap } from "./queries.ts";

describe("pane tab queries", () => {
  test("parsePaneWindowIdMap reads pane to window ids", () => {
    const result = parsePaneWindowIdMap(" %1 @1\n %2 @2\n");

    expect(result.get("%1")).toBe("@1");
    expect(result.get("%2")).toBe("@2");
  });

  test("parseWindowNameMap preserves spaces in window names", () => {
    const result = parseWindowNameMap(" @1 shell\n @2 npm run dev\n");

    expect(result.get("@1")).toBe("shell");
    expect(result.get("@2")).toBe("npm run dev");
  });
});
