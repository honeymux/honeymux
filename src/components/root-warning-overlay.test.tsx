import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { describe, expect, test } from "bun:test";

import "./terminal-view.tsx";
import { RootWarningOverlay, getRootWarningTintColor } from "./root-warning-overlay.tsx";

describe("RootWarningOverlay", () => {
  test("scales the compact setting range to a visible render alpha", () => {
    expect(getRootWarningTintColor(15)).toBe("#ff000073");
    expect(getRootWarningTintColor(50)).toBe("#ff000080");
    expect(getRootWarningTintColor(0)).toBe("#ff00000d");
  });

  test("tints terminal background cells at maximum setting", async () => {
    const setup = await createTestRenderer({ height: 4, width: 8 });
    const root = createRoot(setup.renderer);
    root.render(
      <>
        <ghostty-terminal ansi="hi" bg="#1e1e1e" cols={8} height={4} rows={4} width={8} />
        <RootWarningOverlay opacity={15} rootPanes={[{ height: 4, left: 0, top: 0, width: 8 }]} uiMode="raw" />
      </>,
    );

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await setup.renderOnce();
      const firstLine = setup.captureSpans().lines[0];
      const textBg = firstLine?.spans[0]?.bg.toInts();
      const blankBg = firstLine?.spans[1]?.bg.toInts();

      expect(textBg).toEqual(blankBg);
      expect(blankBg?.[0]).toBeGreaterThanOrEqual(120);
      expect(blankBg?.[1]).toBeLessThanOrEqual(30);
      expect(blankBg?.[2]).toBeLessThanOrEqual(30);
    } finally {
      root.unmount();
      setup.renderer.destroy();
    }
  });
});
