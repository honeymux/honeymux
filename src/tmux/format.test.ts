import { describe, expect, test } from "bun:test";

import { escapeTmuxFormatLiteral } from "./escape.ts";

describe("escapeTmuxFormatLiteral", () => {
  test("escapes tmux format expansion markers", () => {
    expect(escapeTmuxFormatLiteral("#(danger) #{pane_id}")).toBe("##(danger) ##{pane_id}");
  });

  test("sanitizes control characters", () => {
    expect(escapeTmuxFormatLiteral("bad\nvalue")).toBe("bad value");
  });
});
