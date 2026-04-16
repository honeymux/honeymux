import { describe, expect, test } from "bun:test";

import { isAgentWatermarkPreviewFocused, isQuickTerminalSizePreviewFocused } from "./preview-selectors.ts";

describe("options preview selectors", () => {
  test("detects quick terminal size preview from shared tab rows", () => {
    expect(isQuickTerminalSizePreviewFocused(true, "general", 4)).toBe(true);
    expect(isQuickTerminalSizePreviewFocused(true, "general", 5)).toBe(false);
    expect(isQuickTerminalSizePreviewFocused(false, "general", 4)).toBe(false);
  });

  test("detects watermark preview from shared tab rows", () => {
    expect(isAgentWatermarkPreviewFocused(true, "agents", 5)).toBe(true);
    expect(isAgentWatermarkPreviewFocused(true, "agents", 4)).toBe(false);
    expect(isAgentWatermarkPreviewFocused(false, "agents", 5)).toBe(false);
  });
});
