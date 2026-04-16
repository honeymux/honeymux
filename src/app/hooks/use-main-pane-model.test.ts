import { describe, expect, test } from "bun:test";

import { DEFAULT_KEYBINDINGS, formatBinding } from "../../util/keybindings.ts";
import { formatBufferZoomBinding, formatMainMenuBinding, shouldSwitchTreeSession } from "./use-main-pane-model.ts";

describe("main pane model helpers", () => {
  test("detects when tree navigation needs a session switch", () => {
    expect(shouldSwitchTreeSession("alpha", "beta")).toBe(true);
    expect(shouldSwitchTreeSession("alpha", "alpha")).toBe(false);
  });

  test("formats the buffer zoom binding when configured", () => {
    expect(formatBufferZoomBinding(DEFAULT_KEYBINDINGS)).toBeUndefined();
    expect(formatBufferZoomBinding({ ...DEFAULT_KEYBINDINGS, bufferZoom: "ctrl+b" })).toBe(formatBinding("ctrl+b"));
  });

  test("formats the main menu binding when configured", () => {
    expect(formatMainMenuBinding(DEFAULT_KEYBINDINGS)).toBe(formatBinding(DEFAULT_KEYBINDINGS.mainMenu));
    expect(formatMainMenuBinding({ ...DEFAULT_KEYBINDINGS, mainMenu: "alt+m" })).toBe(formatBinding("alt+m"));
  });
});
