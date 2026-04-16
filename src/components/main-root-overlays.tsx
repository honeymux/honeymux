import type { DimPaneRect } from "../app/hooks/use-dim-inactive-panes.ts";
import type { RootPaneRect } from "../app/hooks/use-root-detection.ts";
import type { PaneTabDragFloatState } from "../app/pane-tabs/interactions.ts";
import type { UIMode, WatermarkShape } from "../util/config.ts";

import { theme } from "../themes/theme.ts";
import { stringWidth, stripNonPrintingControlChars } from "../util/text.ts";
import { DimInactivePanesOverlay } from "./dim-inactive-panes-overlay.tsx";
import { RootWarningOverlay } from "./root-warning-overlay.tsx";
import { WatermarkOverlay } from "./watermark-overlay.tsx";

interface MainRootOverlaysProps {
  dimEnabled: boolean;
  dimInactivePanesOpacity: number;
  height: number;
  inactivePaneRects: DimPaneRect[];
  optionsWatermarkFocused: boolean;
  paneTabDragFloat: PaneTabDragFloatState | null;
  privilegedPaneDetectionEnabled: boolean;
  privilegedPaneDetectionOpacity: number;
  rootPanes: RootPaneRect[];
  showWatermark: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  termCols: number;
  termRows: number;
  uiMode: UIMode;
  unansweredCount: number;
  watermarkShape: WatermarkShape;
  width: number;
}

interface PaneTabDragFloatLayout {
  floatLeft: number;
  floatTop: number;
  floatWidth: number;
  innerWidth: number;
  tabName: string;
}

export function MainRootOverlays({
  dimEnabled,
  dimInactivePanesOpacity,
  height,
  inactivePaneRects,
  optionsWatermarkFocused,
  paneTabDragFloat,
  privilegedPaneDetectionEnabled,
  privilegedPaneDetectionOpacity,
  rootPanes,
  showWatermark,
  sidebarOpen,
  sidebarWidth,
  termCols,
  termRows,
  uiMode,
  unansweredCount,
  watermarkShape,
  width,
}: MainRootOverlaysProps) {
  const sidebarOffset = sidebarOpen ? sidebarWidth + 1 : 0;
  const dragFloatLayout = paneTabDragFloat
    ? getPaneTabDragFloatLayout(
        paneTabDragFloat.label,
        paneTabDragFloat.screenX,
        paneTabDragFloat.screenY,
        width,
        height,
      )
    : null;

  return (
    <>
      {inactivePaneRects.length > 0 && dimEnabled && (
        <DimInactivePanesOverlay
          contentCols={termCols}
          inactivePanes={inactivePaneRects}
          opacity={dimInactivePanesOpacity}
          sidebarOffset={sidebarOffset}
          uiMode={uiMode}
        />
      )}
      {rootPanes.length > 0 && privilegedPaneDetectionEnabled && (
        <RootWarningOverlay
          contentCols={termCols}
          opacity={privilegedPaneDetectionOpacity}
          rootPanes={rootPanes}
          sidebarOffset={sidebarOffset}
          uiMode={uiMode}
        />
      )}
      {showWatermark && (
        <WatermarkOverlay
          shape={watermarkShape}
          sidebarOffset={sidebarOffset}
          termCols={termCols}
          termRows={termRows}
          uiMode={uiMode}
          waitCount={optionsWatermarkFocused ? Math.max(unansweredCount, 8) : unansweredCount}
        />
      )}
      {dragFloatLayout && (
        <>
          <text
            bg={theme.bg}
            content={"╭" + "─".repeat(dragFloatLayout.innerWidth) + "╮"}
            fg={theme.accent}
            left={dragFloatLayout.floatLeft}
            position="absolute"
            selectable={false}
            top={dragFloatLayout.floatTop}
            zIndex={20}
          />
          <text
            bg={theme.bg}
            content={"│" + dragFloatLayout.tabName + "│"}
            fg={theme.accent}
            left={dragFloatLayout.floatLeft}
            position="absolute"
            selectable={false}
            top={dragFloatLayout.floatTop + 1}
            zIndex={20}
          />
          <text
            bg={theme.bg}
            content={"╰" + "─".repeat(dragFloatLayout.innerWidth) + "╯"}
            fg={theme.accent}
            left={dragFloatLayout.floatLeft}
            position="absolute"
            selectable={false}
            top={dragFloatLayout.floatTop + 2}
            zIndex={20}
          />
        </>
      )}
    </>
  );
}

export function getPaneTabDragFloatLayout(
  label: string,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): PaneTabDragFloatLayout {
  const safeLabel = stripNonPrintingControlChars(label);
  const tabName = ` ${safeLabel} `;
  const innerWidth = stringWidth(tabName);
  const floatWidth = innerWidth + 2;
  const floatLeft = Math.max(0, Math.min(screenX - 1 - Math.floor(floatWidth / 2), width - floatWidth));
  const floatTop = Math.max(0, Math.min(screenY - 2, height - 3));
  return { floatLeft, floatTop, floatWidth, innerWidth, tabName };
}
