import { describe, expect, test } from "bun:test";

import { getPaneTabDragFloatLayout } from "./main-root-overlays.tsx";

describe("main root overlay helpers", () => {
  test("sanitizes and clamps pane-tab drag float geometry", () => {
    const layout = getPaneTabDragFloatLayout("tab\n\u001bname", 1, 1, 12, 6);
    expect(layout.tabName).toBe(" tabname ");
    expect(layout.floatLeft).toBe(0);
    expect(layout.floatTop).toBe(0);
    expect(layout.floatWidth).toBeGreaterThan(0);
  });
});
