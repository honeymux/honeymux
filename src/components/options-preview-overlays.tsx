import type { UIMode, WatermarkShape } from "../util/config.ts";

import { theme } from "../themes/theme.ts";
import { WatermarkOverlay } from "./watermark-overlay.tsx";

interface OptionsPreviewOverlaysProps {
  height: number;
  quickSizePreview: boolean;
  quickTerminalSize: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  termCols: number;
  termRows: number;
  uiMode: UIMode;
  unansweredCount: number;
  watermarkEnabled: boolean;
  watermarkPreviewFocused: boolean;
  watermarkShape: WatermarkShape;
  width: number;
}

interface QuickTerminalPreviewLayout {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function OptionsPreviewOverlays({
  height,
  quickSizePreview,
  quickTerminalSize,
  sidebarOpen,
  sidebarWidth,
  termCols,
  termRows,
  uiMode,
  unansweredCount,
  watermarkEnabled,
  watermarkPreviewFocused,
  watermarkShape,
  width,
}: OptionsPreviewOverlaysProps) {
  const sidebarOffset = sidebarOpen ? sidebarWidth + 1 : 0;
  const quickTerminalPreview = getQuickTerminalPreviewLayout(width, height, quickTerminalSize);

  return (
    <>
      {watermarkPreviewFocused && watermarkEnabled && (
        <WatermarkOverlay
          shape={watermarkShape}
          sidebarOffset={sidebarOffset}
          termCols={termCols}
          termRows={termRows}
          uiMode={uiMode}
          waitCount={Math.max(unansweredCount, 8)}
          zIndex={25}
        />
      )}
      {quickSizePreview && (
        <box
          border={true}
          borderColor={theme.accent}
          borderStyle="rounded"
          height={quickTerminalPreview.height}
          left={quickTerminalPreview.left}
          position="absolute"
          top={quickTerminalPreview.top}
          width={quickTerminalPreview.width}
          zIndex={25}
        />
      )}
    </>
  );
}

export function getQuickTerminalPreviewLayout(
  width: number,
  height: number,
  quickTerminalSize: number,
): QuickTerminalPreviewLayout {
  const pct = quickTerminalSize / 100;
  const overlayWidth = Math.max(20, Math.floor(width * pct));
  const overlayHeight = Math.max(8, Math.floor(height * pct));
  return {
    height: overlayHeight,
    left: Math.floor((width - overlayWidth) / 2),
    top: Math.floor((height - overlayHeight) / 2),
    width: overlayWidth,
  };
}
