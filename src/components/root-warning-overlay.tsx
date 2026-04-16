import type { RootPaneRect } from "../app/hooks/use-root-detection.ts";
import type { UIMode } from "../util/config.ts";

export interface RootWarningOverlayProps {
  /** Visible content columns (termCols) — used to clamp overlays so the tool bar isn't tinted. */
  contentCols?: number;
  /** Tint opacity as a percentage (5–50). Default 15. */
  opacity?: number;
  rootPanes: RootPaneRect[];
  /** Sidebar offset (shifts originLeft). */
  sidebarOffset?: number;
  uiMode: UIMode;
}

export function RootWarningOverlay({
  contentCols,
  opacity = 15,
  rootPanes,
  sidebarOffset,
  uiMode,
}: RootWarningOverlayProps) {
  // Pane geometry from tmux is relative to the content area origin.
  // We offset by the chrome: left border + tab bar / minimal header.
  const originTop = uiMode === "raw" ? 0 : 3;
  const originLeft = sidebarOffset ?? 0;
  const alpha = Math.round((Math.max(5, Math.min(50, opacity)) / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  const tintColor = `#ff0000${alpha}`;

  return (
    <>
      {rootPanes.map((pane, i) => {
        // Clamp width so the overlay doesn't extend into the tool bar.
        // When the config dialog is open the real session may expand to the
        // control-client size (300×300), inflating pane geometry beyond the
        // visible terminal content area.
        const w = contentCols != null ? Math.min(pane.width, contentCols - pane.left) : pane.width;
        if (w <= 0) return null;
        return (
          <box
            backgroundColor={tintColor}
            height={pane.height}
            key={i}
            left={originLeft + pane.left}
            position="absolute"
            top={originTop + pane.top}
            width={w}
            zIndex={5}
          />
        );
      })}
    </>
  );
}
