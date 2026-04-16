import { describe, expect, test } from "bun:test";

import { getQuickTerminalPreviewLayout } from "./options-preview-overlays.tsx";

describe("options preview overlay helpers", () => {
  test("centers and clamps the quick terminal preview box", () => {
    expect(getQuickTerminalPreviewLayout(80, 24, 90)).toEqual({
      height: 21,
      left: 4,
      top: 1,
      width: 72,
    });
    expect(getQuickTerminalPreviewLayout(20, 8, 10)).toEqual({
      height: 8,
      left: 0,
      top: 0,
      width: 20,
    });
  });
});
