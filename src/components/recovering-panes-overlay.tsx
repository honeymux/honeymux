import type { RecoveringPaneRect } from "../app/hooks/use-recovering-pane-rects.ts";
import type { UIMode } from "../util/config.ts";

import { theme } from "../themes/theme.ts";
import { stringWidth } from "../util/text.ts";

interface RecoveringPanesOverlayProps {
  /** Visible content columns (termCols) — clamps overlay width so toolbar isn't tinted. */
  contentCols?: number;
  recoveringPanes: RecoveringPaneRect[];
  /** Sidebar offset (shifts originLeft). */
  sidebarOffset?: number;
  uiMode: UIMode;
}

const LABEL = " Recovering… ";
const DIM_ALPHA = 0.55;

export function RecoveringPanesOverlay({
  contentCols,
  recoveringPanes,
  sidebarOffset,
  uiMode,
}: RecoveringPanesOverlayProps) {
  const originTop = uiMode === "raw" ? 0 : 3;
  const originLeft = sidebarOffset ?? 0;

  const alphaHex = Math.round(DIM_ALPHA * 255)
    .toString(16)
    .padStart(2, "0");
  const bgColor = `#000000${alphaHex}`;
  const labelWidth = stringWidth(LABEL);

  return (
    <>
      {recoveringPanes.flatMap((pane) => {
        const clampedWidth = contentCols != null ? Math.min(pane.width, contentCols - pane.left) : pane.width;
        if (clampedWidth <= 0) return [];

        const labelLeft = originLeft + pane.left + Math.max(0, Math.floor((clampedWidth - labelWidth) / 2));
        const labelTop = originTop + pane.top + Math.max(0, Math.floor((pane.height - 1) / 2));
        const labelFits = clampedWidth >= labelWidth && pane.height >= 1;

        const nodes = [
          <box
            backgroundColor={bgColor}
            height={pane.height}
            key={`${pane.paneId}-dim`}
            left={originLeft + pane.left}
            position="absolute"
            top={originTop + pane.top}
            width={clampedWidth}
            zIndex={5}
          />,
        ];
        if (labelFits) {
          nodes.push(
            <text
              bg={theme.bgSurface}
              content={LABEL}
              fg={theme.textBright}
              key={`${pane.paneId}-label`}
              left={labelLeft}
              position="absolute"
              selectable={false}
              top={labelTop}
              zIndex={6}
            />,
          );
        }
        return nodes;
      })}
    </>
  );
}
