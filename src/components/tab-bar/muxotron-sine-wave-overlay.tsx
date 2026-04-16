import { RGBA, parseColor } from "@opentui/core";

import { useImperativeAnimation } from "../../app/hooks/use-imperative-animation.ts";
import { hexToRgb, lerpRgb, theme } from "../../themes/theme.ts";
import { truncateToWidth } from "../../util/text.ts";
import {
  MUXOTRON_SINE_WAVE_WIDTH,
  type MuxotronSineWaveState,
  getMuxotronSineWaveRefreshDelay,
  getMuxotronSineWaveState,
} from "./muxotron-sine-wave.ts";

interface MuxotronSineWaveOverlayProps {
  hasConnectedAgent: boolean;
  lastOutputTickAt: null | number;
  left: number;
  maxWidth: number;
  top: number;
}

let cachedThemeKey = "";
let cachedActiveColor: RGBA | null = null;
let cachedActiveRgb: [number, number, number] | null = null;
let cachedIdleColor: RGBA | null = null;
let cachedIdleRgb: [number, number, number] | null = null;

export function MuxotronSineWaveOverlay({
  hasConnectedAgent,
  lastOutputTickAt,
  left,
  maxWidth,
  top,
}: MuxotronSineWaveOverlayProps) {
  const { ref, renderAfter } = useImperativeAnimation({
    getRefreshDelay: (state, now) =>
      getMuxotronSineWaveRefreshDelay(state.hasConnectedAgent, state.lastOutputTickAt, now),
    paint(buffer, state, now) {
      const currentState = getMuxotronSineWaveState(state.hasConnectedAgent, state.lastOutputTickAt, now);
      if (!currentState.visible || state.maxWidth <= 0) return;

      const display =
        state.maxWidth >= MUXOTRON_SINE_WAVE_WIDTH
          ? currentState.display
          : truncateToWidth(currentState.display, state.maxWidth);
      if (display.length === 0) return;

      buffer.drawText(display, this.x, this.y, getMuxotronSineWaveColor(currentState));
    },
    state: { hasConnectedAgent, lastOutputTickAt, maxWidth },
  });

  if (!hasConnectedAgent || maxWidth <= 0) return null;

  return (
    <box
      height={1}
      left={left}
      position="absolute"
      ref={ref}
      renderAfter={renderAfter}
      selectable={false}
      top={top}
      width={maxWidth}
    />
  );
}

function getMuxotronSineWaveColor(state: MuxotronSineWaveState): RGBA {
  syncCachedWaveColors();

  if (state.phase === "active") return cachedActiveColor!;
  if (state.phase !== "draining") return cachedIdleColor!;

  const [r, g, b] = lerpRgb(cachedActiveRgb!, cachedIdleRgb!, state.drainProgress);
  return RGBA.fromInts(r, g, b, 255);
}

function syncCachedWaveColors(): void {
  const nextThemeKey = `${theme.statusSuccess}\n${theme.textDim}`;
  if (nextThemeKey === cachedThemeKey) return;

  cachedThemeKey = nextThemeKey;
  cachedActiveColor = parseColor(theme.statusSuccess);
  cachedActiveRgb = hexToRgb(theme.statusSuccess);
  cachedIdleColor = parseColor(theme.textDim);
  cachedIdleRgb = hexToRgb(theme.textDim);
}
