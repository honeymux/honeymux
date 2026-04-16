import { type RGBA, parseColor } from "@opentui/core";
import { useRef } from "react";

import { HONEYMUX_ANIMATIONS, type HoneymuxState } from "../../agents/types.ts";
import { useImperativeAnimation } from "../../app/hooks/use-imperative-animation.ts";
import { theme } from "../../themes/theme.ts";
import {
  MUXOTRON_SINE_WAVE_DRAIN_STEP_MS,
  MUXOTRON_SINE_WAVE_IDLE_MS,
  MUXOTRON_SINE_WAVE_WIDTH,
} from "./muxotron-sine-wave.ts";

interface MascotSnapshot {
  honeymuxState: HoneymuxState;
  sineWaveLastOutputTickAt: null | number;
  ticker: MascotTickerState;
}

/**
 * Mutable per-overlay mascot animation state.  Lives in a component-owned
 * ref so both getRefreshDelay and paint can read/write across frames.
 *
 *   frameIdx         — which frame of the current animation is visible
 *   lastTickAt       — when frameIdx last advanced
 *   nextIdleBlinkAt  — timestamp for next idle-state random blink
 *   nextNeedBlinkAt  — timestamp for next needInput-state random blink
 */
interface MascotTickerState {
  frameIdx: number;
  lastTickAt: number;
  nextIdleBlinkAt: number;
  nextNeedBlinkAt: number;
}

interface MuxotronMascotOverlayProps {
  honeymuxState: HoneymuxState;
  left: number;
  /** Timestamp of last agent output tick — mascot brightens while the sine wave is active/draining. */
  sineWaveLastOutputTickAt?: null | number;
  top: number;
}

let cachedColorKey: null | string = null;
let cachedColor: RGBA | null = null;

export function MuxotronMascotOverlay({
  honeymuxState,
  left,
  sineWaveLastOutputTickAt,
  top,
}: MuxotronMascotOverlayProps) {
  // Per-instance mutable ticker state.  Initialized once and mutated by the
  // paint/delay callbacks on each frame.
  const tickerRef = useRef<MascotTickerState>({
    frameIdx: 0,
    lastTickAt: 0,
    nextIdleBlinkAt: 0,
    nextNeedBlinkAt: 0,
  });

  // Seed random blink schedules on first render.  Can't do this in the ref
  // initializer because Date.now() would capture module-load time instead
  // of component-mount time.
  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    const now = Date.now();
    tickerRef.current.lastTickAt = now;
    tickerRef.current.nextIdleBlinkAt = now + 5_000 + Math.random() * 10_000;
    tickerRef.current.nextNeedBlinkAt = now + 5_000 + Math.random() * 25_000;
  }

  const width = HONEYMUX_ANIMATIONS[honeymuxState].width;

  const { ref, renderAfter } = useImperativeAnimation<MascotSnapshot>({
    getRefreshDelay: (state) => computeNextMascotDelay(state.honeymuxState, state.ticker, Date.now()),
    // Mascot blinks are infrequent (every 5-30s in idle states); a slow poll
    // interval is fine for picking up state transitions.
    idlePollMs: 1000,
    paint(buffer, state, _now) {
      const anim = HONEYMUX_ANIMATIONS[state.honeymuxState];
      advanceMascotFrame(state.honeymuxState, state.ticker, Date.now());

      const frame = anim.frames[state.ticker.frameIdx] ?? anim.frames[0]!;
      // Unanswered states pull from the theme so the mascot matches the
      // yellow used to highlight unanswered agents in the sidebar.
      const unansweredColor =
        state.honeymuxState === "needInput" || state.honeymuxState === "needInputFocused"
          ? theme.statusWarning
          : anim.color;
      const color = isSineWaveAnimating(state.sineWaveLastOutputTickAt, performance.now())
        ? theme.textBright
        : unansweredColor;
      buffer.drawText(frame, this.x, this.y, resolveMascotColor(color));
    },
    state: { honeymuxState, sineWaveLastOutputTickAt: sineWaveLastOutputTickAt ?? null, ticker: tickerRef.current },
  });

  return (
    <box
      height={1}
      left={left}
      position="absolute"
      ref={ref}
      renderAfter={renderAfter}
      selectable={false}
      top={top}
      width={width}
    />
  );
}

/**
 * Advance the mascot's frameIdx if enough time has elapsed since lastTickAt,
 * matching the original per-state behavior in muxotron.tsx:
 *
 *   idle       — random blink: eyes-open (0) → briefly eyes-closed (1) → 0
 *   needInput  — random blink: same pattern, longer interval
 *   sleeping   — cycle frames continuously at `intervalMs`
 */
function advanceMascotFrame(state: HoneymuxState, ticker: MascotTickerState, now: number): void {
  const anim = HONEYMUX_ANIMATIONS[state];

  // Clamp frame index if animation length changed due to state transition.
  if (ticker.frameIdx >= anim.frames.length) ticker.frameIdx = 0;

  if (state === "idle") {
    if (ticker.frameIdx === 0 && now >= ticker.nextIdleBlinkAt) {
      ticker.frameIdx = 1;
      ticker.lastTickAt = now;
    } else if (ticker.frameIdx === 1 && now - ticker.lastTickAt >= anim.intervalMs) {
      ticker.frameIdx = 0;
      ticker.nextIdleBlinkAt = now + 10_000 + Math.random() * 20_000;
    }
    return;
  }

  if (state === "needInput" || state === "needInputFocused") {
    if (ticker.frameIdx === 0 && now >= ticker.nextNeedBlinkAt) {
      ticker.frameIdx = 1;
      ticker.lastTickAt = now;
    } else if (ticker.frameIdx === 1 && now - ticker.lastTickAt >= anim.intervalMs) {
      ticker.frameIdx = 0;
      ticker.nextNeedBlinkAt = now + 5_000 + Math.random() * 25_000;
    }
    return;
  }

  // Sleeping: continuous cycle.
  if (now - ticker.lastTickAt >= anim.intervalMs) {
    ticker.frameIdx = (ticker.frameIdx + 1) % anim.frames.length;
    ticker.lastTickAt = now;
  }
}

/**
 * Compute the delay until the mascot needs its next frame advance.
 * Returns null when there's nothing upcoming within a reasonable window
 * (the idle poll takes over at that point).
 */
function computeNextMascotDelay(state: HoneymuxState, ticker: MascotTickerState, now: number): null | number {
  const anim = HONEYMUX_ANIMATIONS[state];

  if (state === "idle") {
    if (ticker.frameIdx === 0) {
      // Waiting for the next random blink.  This is typically several
      // seconds away — let the idle poll handle it.
      const untilBlink = ticker.nextIdleBlinkAt - now;
      return untilBlink > 0 ? Math.max(50, Math.min(untilBlink, 2_000)) : 50;
    }
    // In the middle of a blink — advance after intervalMs.
    return Math.max(16, anim.intervalMs - (now - ticker.lastTickAt));
  }

  if (state === "needInput" || state === "needInputFocused") {
    if (ticker.frameIdx === 0) {
      const untilBlink = ticker.nextNeedBlinkAt - now;
      return untilBlink > 0 ? Math.max(50, Math.min(untilBlink, 2_000)) : 50;
    }
    return Math.max(16, anim.intervalMs - (now - ticker.lastTickAt));
  }

  // Sleeping: continuous cycle.
  return Math.max(16, anim.intervalMs - (now - ticker.lastTickAt));
}

/** True while the sine wave is in its active or draining phase (recent agent output). */
function isSineWaveAnimating(lastOutputTickAt: null | number, now: number): boolean {
  if (lastOutputTickAt == null) return false;
  const silenceMs = now - lastOutputTickAt;
  const drainEndMs = MUXOTRON_SINE_WAVE_IDLE_MS + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS;
  return silenceMs < drainEndMs;
}

function resolveMascotColor(hex: string): RGBA {
  if (cachedColorKey === hex && cachedColor) return cachedColor;
  cachedColorKey = hex;
  cachedColor = parseColor(hex);
  return cachedColor;
}
