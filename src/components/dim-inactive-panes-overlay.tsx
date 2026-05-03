import type { DimPaneRect } from "../app/hooks/use-dim-inactive-panes.ts";
import type { UIMode } from "../util/config.ts";

interface DimInactivePanesOverlayProps {
  /** Visible content columns (termCols) — used to clamp overlays so the tool bar isn't tinted. */
  contentCols?: number;
  inactivePanes: DimPaneRect[];
  /** Dim intensity 0–100 (maps to alpha channel). */
  opacity: number;
  /** Sidebar offset (shifts originLeft). */
  sidebarOffset?: number;
  uiMode: UIMode;
}

export function DimInactivePanesOverlay({
  contentCols,
  inactivePanes,
  opacity,
  sidebarOffset,
  uiMode,
}: DimInactivePanesOverlayProps) {
  const originTop = uiMode === "raw" ? 0 : 3;
  const originLeft = sidebarOffset ?? 0;
  const bgColor = getDimInactivePaneOverlayColor(opacity);

  return (
    <>
      {inactivePanes.map((pane, i) => {
        const w = contentCols != null ? Math.min(pane.width, contentCols - pane.left) : pane.width;
        if (w <= 0) return null;
        return (
          <box
            backgroundColor={bgColor}
            height={pane.height}
            key={i}
            left={originLeft + pane.left}
            position="absolute"
            top={originTop + pane.top}
            width={w}
            zIndex={4}
          />
        );
      })}
    </>
  );
}

export function getDimInactivePaneOverlayColor(opacity = 40): string {
  // This setting is a literal opacity percentage. Use black so empty black
  // backgrounds remain black while text and non-black backgrounds dim together.
  const clampedOpacity = Math.max(0, Math.min(100, opacity));
  const alphaHex = Math.round((clampedOpacity / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#000000${alphaHex}`;
}
