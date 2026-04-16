import { describe, expect, it } from "bun:test";

import type { AgentAnimationConfig } from "../agents/types.ts";

import { theme } from "../themes/theme.ts";
import { getStatusChar } from "./agent-tree-helpers.ts";

describe("agent-tree helpers", () => {
  const animations: AgentAnimationConfig = {
    alive: { char: "A", color: theme.text },
    unanswered: { char: "U", color: theme.statusWarning },
  };

  it("uses the unanswered animation for waiting sessions", () => {
    expect(getStatusChar({ status: "unanswered" } as any, animations)).toEqual({
      char: "U",
      color: theme.statusWarning,
    });
  });

  it("uses the configured alive animation for running sessions", () => {
    expect(getStatusChar({ status: "alive" } as any, animations)).toEqual({
      char: "A",
      color: theme.text,
    });
  });

  it("uses the remote alive glyph for remote-backed running sessions", () => {
    expect(getStatusChar({ isRemote: true, status: "alive" } as any, animations)).toEqual({
      char: "\u2197",
      color: theme.text,
    });
  });
});
