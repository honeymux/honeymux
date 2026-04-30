import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { describe, expect, test } from "bun:test";

import "./terminal-view.tsx";
import { DimInactivePanesOverlay, getDimInactivePaneOverlayColor } from "./dim-inactive-panes-overlay.tsx";

describe("DimInactivePanesOverlay", () => {
  test("maps literal opacity percentages to black alpha", () => {
    expect(getDimInactivePaneOverlayColor(40)).toBe("#00000066");
    expect(getDimInactivePaneOverlayColor(10)).toBe("#0000001a");
    expect(getDimInactivePaneOverlayColor(80)).toBe("#000000cc");
  });

  test("clamps out-of-range opacity values", () => {
    expect(getDimInactivePaneOverlayColor(-10)).toBe("#00000000");
    expect(getDimInactivePaneOverlayColor(120)).toBe("#000000ff");
  });

  test("dims terminal foreground and background cells at the default setting", async () => {
    const setup = await createTestRenderer({ height: 4, width: 8 });
    const root = createRoot(setup.renderer);
    root.render(
      <>
        <ghostty-terminal ansi="hi" bg="#1e1e1e" cols={8} height={4} rows={4} width={8} />
        <DimInactivePanesOverlay inactivePanes={[{ height: 4, left: 0, top: 0, width: 8 }]} opacity={40} uiMode="raw" />
      </>,
    );

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await setup.renderOnce();
      const firstLine = setup.captureSpans().lines[0];
      const textFg = firstLine?.spans[0]?.fg.toInts();
      const textBg = firstLine?.spans[0]?.bg.toInts();
      const blankBg = firstLine?.spans[1]?.bg.toInts();

      expect(textFg).toEqual([127, 127, 127, 255]);
      expect(textBg).toEqual([18, 18, 18, 255]);
      expect(blankBg).toEqual(textBg);
    } finally {
      root.unmount();
      setup.renderer.destroy();
    }
  });
});
