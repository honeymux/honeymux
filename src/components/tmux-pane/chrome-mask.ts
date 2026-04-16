import type { UIMode } from "../../util/config.ts";

export interface ReservedRightChromeMask {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface ComputeReservedRightChromeMaskOptions {
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  terminalCols: number;
  terminalRows: number;
  uiMode: UIMode;
  width: number;
}

export function computeReservedRightChromeMask({
  sidebarOpen,
  sidebarWidth,
  terminalCols,
  terminalRows,
  uiMode,
  width,
}: ComputeReservedRightChromeMaskOptions): ReservedRightChromeMask | null {
  if (terminalCols <= 0 || terminalRows <= 0) return null;

  const sidebarOffset = sidebarOpen && sidebarWidth ? sidebarWidth + 1 : 0;
  const left = sidebarOffset + terminalCols;
  const reservedWidth = width - left;
  if (reservedWidth <= 0) return null;

  return {
    height: terminalRows,
    left,
    top: uiMode === "raw" || uiMode === "marquee-bottom" ? 0 : 3,
    width: reservedWidth,
  };
}
