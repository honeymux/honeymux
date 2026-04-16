import { describe, expect, test } from "bun:test";

import { resolveActivePaneIndex } from "./use-pane-tabs.ts";

describe("pane tab active pane selection", () => {
  test("prefers the event-driven active pane id over stale pane_active flags", () => {
    const panes = [
      { active: true, height: 24, id: "%1", width: 80 },
      { active: false, height: 24, id: "%2", width: 80 },
    ];

    expect(resolveActivePaneIndex(panes, "%2")).toBe(1);
  });

  test("falls back to tmux pane_active when there is no tracked active pane id", () => {
    const panes = [
      { active: false, height: 24, id: "%1", width: 80 },
      { active: true, height: 24, id: "%2", width: 80 },
    ];

    expect(resolveActivePaneIndex(panes, null)).toBe(1);
  });
});
