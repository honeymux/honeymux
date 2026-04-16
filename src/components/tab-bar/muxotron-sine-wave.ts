export const MUXOTRON_SINE_WAVE_CHARS = "_.·˙¯˙·._";
export const MUXOTRON_SINE_WAVE_WIDTH = 7;
export const MUXOTRON_SINE_WAVE_IDLE_MS = 3_000;
export const MUXOTRON_SINE_WAVE_IDLE = "_".repeat(MUXOTRON_SINE_WAVE_WIDTH);
export const MUXOTRON_SINE_WAVE_DRAIN_STEP_MS = 120;
export const MUXOTRON_SINE_WAVE_ACTIVE_STEP_MS = 50;

const PHASE_OFFSET = 0.7;
export const MUXOTRON_SINE_WAVE_PHASE_STEP_PER_MS = 0.12 / 40;
export const MUXOTRON_SINE_WAVE_CYCLE_MS = (Math.PI * 2) / MUXOTRON_SINE_WAVE_PHASE_STEP_PER_MS;

export interface MuxotronSineWaveState {
  animating: boolean;
  display: string;
  drainProgress: number;
  phase: "active" | "draining" | "hidden" | "idle";
  visible: boolean;
}

export function buildMuxotronSineWaveFrame(elapsedMs: number): string {
  const phase = normalizeWaveElapsedMs(elapsedMs) * MUXOTRON_SINE_WAVE_PHASE_STEP_PER_MS;
  let line = "";

  for (let i = 0; i < MUXOTRON_SINE_WAVE_WIDTH; i++) {
    const value = (Math.sin(phase + i * PHASE_OFFSET) + 1) / 2;
    line += MUXOTRON_SINE_WAVE_CHARS[Math.floor(value * (MUXOTRON_SINE_WAVE_CHARS.length - 1))] ?? "_";
  }

  return line;
}

export function getMuxotronSineWaveRefreshDelay(
  hasConnectedAgent: boolean,
  lastOutputTickAt: null | number,
  now: number,
): null | number {
  if (!hasConnectedAgent || lastOutputTickAt == null) return null;

  const silenceMs = now - lastOutputTickAt;
  const drainEndMs = MUXOTRON_SINE_WAVE_IDLE_MS + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS;
  if (silenceMs >= drainEndMs) return null;
  if (silenceMs >= MUXOTRON_SINE_WAVE_IDLE_MS) return MUXOTRON_SINE_WAVE_DRAIN_STEP_MS;

  return MUXOTRON_SINE_WAVE_ACTIVE_STEP_MS;
}

export function getMuxotronSineWaveState(
  hasConnectedAgent: boolean,
  lastOutputTickAt: null | number,
  now: number,
): MuxotronSineWaveState {
  if (!hasConnectedAgent) {
    return {
      animating: false,
      display: "",
      drainProgress: 0,
      phase: "hidden",
      visible: false,
    };
  }

  if (lastOutputTickAt == null) {
    return {
      animating: false,
      display: MUXOTRON_SINE_WAVE_IDLE,
      drainProgress: 1,
      phase: "idle",
      visible: true,
    };
  }

  const silenceMs = now - lastOutputTickAt;
  if (silenceMs >= MUXOTRON_SINE_WAVE_IDLE_MS + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS) {
    return {
      animating: false,
      display: MUXOTRON_SINE_WAVE_IDLE,
      drainProgress: 1,
      phase: "idle",
      visible: true,
    };
  }

  if (silenceMs >= MUXOTRON_SINE_WAVE_IDLE_MS) {
    const drainElapsedMs = silenceMs - MUXOTRON_SINE_WAVE_IDLE_MS;
    const drainDurationMs = MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS;
    return {
      animating: true,
      display: buildMuxotronSineWaveDrainFrame(now, lastOutputTickAt),
      drainProgress: Math.min(1, drainElapsedMs / drainDurationMs),
      phase: "draining",
      visible: true,
    };
  }

  return {
    animating: true,
    display: buildMuxotronSineWaveFrame(now),
    drainProgress: 0,
    phase: "active",
    visible: true,
  };
}

function buildMuxotronSineWaveDrainFrame(now: number, lastOutputTickAt: number): string {
  const drainStartAt = lastOutputTickAt + MUXOTRON_SINE_WAVE_IDLE_MS;
  const drainSteps = Math.min(
    MUXOTRON_SINE_WAVE_WIDTH,
    Math.floor((now - drainStartAt) / MUXOTRON_SINE_WAVE_DRAIN_STEP_MS),
  );
  const frame = buildMuxotronSineWaveFrame(drainStartAt);
  if (drainSteps <= 0) return frame;

  return frame.slice(drainSteps) + "_".repeat(drainSteps);
}

function normalizeWaveElapsedMs(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return elapsedMs % MUXOTRON_SINE_WAVE_CYCLE_MS;
}
