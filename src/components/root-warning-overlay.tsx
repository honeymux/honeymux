import type { RootPaneRect } from "../app/hooks/use-root-detection.ts";
import type { UIMode } from "../util/config.ts";

const ROOT_WARNING_RENDER_OPACITY_MAX = 50;
const ROOT_WARNING_RENDER_OPACITY_MIN = 5;
const ROOT_WARNING_RENDER_OPACITY_SCALE = 3;

export interface RootWarningOverlayProps {
  /** Visible content columns (termCols) — used to clamp overlays so the tool bar isn't tinted. */
  contentCols?: number;
  /** Privileged-pane tint strength from config. Scaled to renderer alpha. Default 10. */
  opacity?: number;
  rootPanes: RootPaneRect[];
  /** Sidebar offset (shifts originLeft). */
  sidebarOffset?: number;
  uiMode: UIMode;
}

export function RootWarningOverlay({
  contentCols,
  opacity = 10,
  rootPanes,
  sidebarOffset,
  uiMode,
}: RootWarningOverlayProps) {
  // Pane geometry from tmux is relative to the content area origin.
  // We offset by the chrome: left border + tab bar / minimal header.
  const originTop = uiMode === "raw" ? 0 : 3;
  const originLeft = sidebarOffset ?? 0;
  const tintColor = getRootWarningTintColor(opacity);

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

export function getRootWarningTintColor(opacity = 10): string {
  // The option predates OpenTUI's corrected alpha blending and uses a compact
  // 1-15 warning-strength range. Scale it into a render alpha that still
  // survives common 256-color quantization for pane backgrounds.
  const renderOpacity = Math.max(
    ROOT_WARNING_RENDER_OPACITY_MIN,
    Math.min(ROOT_WARNING_RENDER_OPACITY_MAX, opacity * ROOT_WARNING_RENDER_OPACITY_SCALE),
  );
  const alpha = Math.round((renderOpacity / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#ff0000${alpha}`;
}
