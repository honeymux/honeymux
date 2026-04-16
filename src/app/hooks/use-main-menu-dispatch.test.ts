import { describe, expect, test } from "bun:test";

import { DEFAULT_KEYBINDINGS } from "../../util/keybindings.ts";
import { createUpdatedKeybindings, getMainMenuRowCount } from "./use-main-menu-dispatch.ts";

describe("main menu dispatch helpers", () => {
  test("computes row counts from the active tab", () => {
    expect(getMainMenuRowCount("functions", false)).toBeGreaterThan(0);
    expect(getMainMenuRowCount("agents", false)).toBeGreaterThan(0);
    expect(getMainMenuRowCount("navigation", true)).toBeGreaterThan(0);
    expect(getMainMenuRowCount("about", false)).toBe(0);
  });

  test("creates updated keybindings and sequence maps together", () => {
    const { keybindingConfig, sequenceMap } = createUpdatedKeybindings(DEFAULT_KEYBINDINGS, "screenshot", "ctrl+s");
    expect(keybindingConfig.screenshot).toBe("ctrl+s");
    expect(sequenceMap.get("ctrl+s")).toBe("screenshot");
  });
});
