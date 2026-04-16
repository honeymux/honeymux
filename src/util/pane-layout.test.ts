import { describe, expect, it } from "bun:test";

import { computeTerminalMetrics } from "./pane-layout.ts";

describe("pane-layout", () => {
  it("computes terminal metrics for each UI mode", () => {
    const full = computeTerminalMetrics({
      height: 30,
      uiMode: "adaptive",
      width: 100,
    });
    expect(full).toEqual({ cols: 100, rows: 27, tooSmall: false });

    const marqueeTop = computeTerminalMetrics({
      height: 30,
      uiMode: "marquee-top",
      width: 100,
    });
    expect(marqueeTop).toEqual({ cols: 100, rows: 27, tooSmall: false });

    const marqueeBottom = computeTerminalMetrics({
      height: 30,
      uiMode: "marquee-bottom",
      width: 100,
    });
    expect(marqueeBottom).toEqual({ cols: 100, rows: 27, tooSmall: false });

    const raw = computeTerminalMetrics({
      height: 30,
      uiMode: "raw",
      width: 100,
    });
    expect(raw).toEqual({ cols: 100, rows: 30, tooSmall: false });
  });
});
