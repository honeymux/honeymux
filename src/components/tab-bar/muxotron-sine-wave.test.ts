import { describe, expect, test } from "bun:test";

import {
  MUXOTRON_SINE_WAVE_ACTIVE_STEP_MS,
  MUXOTRON_SINE_WAVE_CHARS,
  MUXOTRON_SINE_WAVE_CYCLE_MS,
  MUXOTRON_SINE_WAVE_DRAIN_STEP_MS,
  MUXOTRON_SINE_WAVE_IDLE,
  MUXOTRON_SINE_WAVE_IDLE_MS,
  MUXOTRON_SINE_WAVE_WIDTH,
  buildMuxotronSineWaveFrame,
  getMuxotronSineWaveRefreshDelay,
  getMuxotronSineWaveState,
} from "./muxotron-sine-wave.ts";

describe("muxotron sine wave", () => {
  test("builds a frame with the expected visible width and glyph set", () => {
    const frame = buildMuxotronSineWaveFrame(1234);

    expect(frame).toHaveLength(MUXOTRON_SINE_WAVE_WIDTH);
    for (const ch of frame) {
      expect(MUXOTRON_SINE_WAVE_CHARS.includes(ch)).toBe(true);
    }
  });

  test("wraps the active frame on the wave cycle to keep timing stable", () => {
    expect(buildMuxotronSineWaveFrame(1234 + MUXOTRON_SINE_WAVE_CYCLE_MS)).toBe(buildMuxotronSineWaveFrame(1234));
  });

  test("shows an idle underscore line when no output has ever been seen", () => {
    expect(getMuxotronSineWaveState(true, null, 10_000)).toEqual({
      animating: false,
      display: MUXOTRON_SINE_WAVE_IDLE,
      drainProgress: 1,
      phase: "idle",
      visible: true,
    });
  });

  test("drains into underscores after three seconds of inactivity before settling idle", () => {
    const drainStartAt = 5_000 + MUXOTRON_SINE_WAVE_IDLE_MS;
    const frozenFrame = buildMuxotronSineWaveFrame(drainStartAt);
    const draining = getMuxotronSineWaveState(true, 5_000, drainStartAt + MUXOTRON_SINE_WAVE_DRAIN_STEP_MS);
    expect(draining.visible).toBe(true);
    expect(draining.animating).toBe(true);
    expect(draining.phase).toBe("draining");
    expect(draining.drainProgress).toBeGreaterThan(0);
    expect(draining.drainProgress).toBeLessThan(1);
    expect(draining.display).toHaveLength(MUXOTRON_SINE_WAVE_WIDTH);
    expect(draining.display).toBe(frozenFrame.slice(1) + "_");

    expect(
      getMuxotronSineWaveState(true, 5_000, drainStartAt + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS),
    ).toEqual({
      animating: false,
      display: MUXOTRON_SINE_WAVE_IDLE,
      drainProgress: 1,
      phase: "idle",
      visible: true,
    });
  });

  test("animates while output is recent and resumes immediately on new output", () => {
    const active = getMuxotronSineWaveState(true, 5_000, 7_000);
    expect(active.visible).toBe(true);
    expect(active.animating).toBe(true);
    expect(active.phase).toBe("active");
    expect(active.drainProgress).toBe(0);
    expect(active.display).not.toBe(MUXOTRON_SINE_WAVE_IDLE);

    const resumed = getMuxotronSineWaveState(true, 12_000, 12_001);
    expect(resumed.visible).toBe(true);
    expect(resumed.animating).toBe(true);
    expect(resumed.phase).toBe("active");
    expect(resumed.drainProgress).toBe(0);
    expect(resumed.display).not.toBe(MUXOTRON_SINE_WAVE_IDLE);
  });

  test("stays hidden when no coding agent is connected", () => {
    expect(getMuxotronSineWaveState(false, 12_000, 12_001)).toEqual({
      animating: false,
      display: "",
      drainProgress: 0,
      phase: "hidden",
      visible: false,
    });
  });

  test("only schedules redraws while the wave is still changing", () => {
    expect(getMuxotronSineWaveRefreshDelay(false, 12_000, 12_001)).toBeNull();
    expect(getMuxotronSineWaveRefreshDelay(true, null, 12_001)).toBeNull();
    expect(getMuxotronSineWaveRefreshDelay(true, 5_000, 7_000)).toBe(MUXOTRON_SINE_WAVE_ACTIVE_STEP_MS);
    expect(getMuxotronSineWaveRefreshDelay(true, 5_000, 5_000 + MUXOTRON_SINE_WAVE_IDLE_MS)).toBe(
      MUXOTRON_SINE_WAVE_DRAIN_STEP_MS,
    );
    expect(
      getMuxotronSineWaveRefreshDelay(
        true,
        5_000,
        5_000 + MUXOTRON_SINE_WAVE_IDLE_MS + MUXOTRON_SINE_WAVE_WIDTH * MUXOTRON_SINE_WAVE_DRAIN_STEP_MS,
      ),
    ).toBeNull();
  });
});
