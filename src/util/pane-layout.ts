import type { UIMode } from "./config.ts";

export interface TerminalMetrics {
  cols: number;
  rows: number;
  tooSmall: boolean;
}

interface ComputeTerminalMetricsOptions {
  height: number;
  uiMode: UIMode;
  width: number;
}

export function computeTerminalMetrics({ height, uiMode, width }: ComputeTerminalMetricsOptions): TerminalMetrics {
  let cols: number;
  let rows: number;
  switch (uiMode) {
    case "marquee-bottom":
    case "marquee-top":
      cols = width;
      rows = height - 3;
      break;
    case "raw":
      cols = width;
      rows = height;
      break;
    case "adaptive":
    default:
      cols = width;
      rows = height - 3;
      break;
  }

  return {
    cols: Math.max(10, cols),
    rows: Math.max(3, rows),
    tooSmall: cols < 10 || rows < 3,
  };
}
