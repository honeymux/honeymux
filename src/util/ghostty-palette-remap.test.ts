import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { clearBasePalette, ptyToJson } from "ghostty-opentui";

import type { RGB } from "../themes/theme.ts";

import { installHostPalette } from "./ghostty-palette-remap.ts";

// End-to-end coverage of the Zig-level palette override: drive
// installHostPalette() the way src/index.tsx does, then read back the
// resolved color via ptyToJson() and verify ghostty-vt actually projected
// the host palette over its own defaults. This is what makes the
// architectural wins of the changeDefault() approach regression-proof —
// OSC 104 survival and the absence of truecolor false-positives both fall
// out of behavior visible at this seam.

function fgOf(input: string): null | string {
  const out = ptyToJson(input, { cols: 10, rows: 1 });
  for (const line of out.lines) {
    for (const span of line.spans) {
      if (span.text.trim().length > 0) return span.fg;
    }
  }
  return null;
}

// ghostty-vt's hardcoded Tomorrow Night defaults for indices 4 and 6.
// These values come straight from libghostty; they're referenced here only
// to assert that an empty install leaves them in place.
const GHOSTTY_DEFAULT_BLUE = "#81a2be";
const GHOSTTY_DEFAULT_CYAN = "#8abeb7";

beforeEach(() => {
  clearBasePalette();
});

afterAll(() => {
  // Don't leak overrides into other test files.
  clearBasePalette();
});

describe("installHostPalette", () => {
  test("empty/all-null probe leaves ghostty's defaults in place", () => {
    installHostPalette([]);
    expect(fgOf("\x1b[36mX\x1b[0m")).toBe(GHOSTTY_DEFAULT_CYAN);

    installHostPalette(new Array(16).fill(null));
    expect(fgOf("\x1b[36mX\x1b[0m")).toBe(GHOSTTY_DEFAULT_CYAN);
  });

  test("non-null entries project the host's color through ghostty-vt", () => {
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[4] = [0x18, 0x44, 0xa0];
    probed[6] = [0x14, 0xa0, 0xa0];

    installHostPalette(probed);

    expect(fgOf("\x1b[34mX\x1b[0m")).toBe("#1844a0");
    expect(fgOf("\x1b[36mX\x1b[0m")).toBe("#14a0a0");
  });

  test("null entries fall back to ghostty's default for that slot", () => {
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[6] = [0x14, 0xa0, 0xa0];

    installHostPalette(probed);

    expect(fgOf("\x1b[36mX\x1b[0m")).toBe("#14a0a0");
    expect(fgOf("\x1b[34mX\x1b[0m")).toBe(GHOSTTY_DEFAULT_BLUE);
  });

  test("each install starts from a clean slate", () => {
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[6] = [0x14, 0xa0, 0xa0];
    installHostPalette(probed);
    expect(fgOf("\x1b[36mX\x1b[0m")).toBe("#14a0a0");

    // A subsequent install with no entries must clear the prior override.
    installHostPalette(new Array(16).fill(null));
    expect(fgOf("\x1b[36mX\x1b[0m")).toBe(GHOSTTY_DEFAULT_CYAN);
  });

  test("override survives an OSC 104 palette reset emitted by the inner program", () => {
    // Inner programs sometimes emit OSC 104 to reset the runtime palette.
    // With DynamicPalette.set() that would un-do our override; with
    // changeDefault() the new defaults persist. This test is the reason we
    // pick changeDefault() in the Zig patch.
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[6] = [0x14, 0xa0, 0xa0];
    installHostPalette(probed);

    expect(fgOf("\x1b]104\x1b\\\x1b[36mX\x1b[0m")).toBe("#14a0a0");
  });

  test("explicit truecolor RGB is not remapped even when it equals ghostty's default", () => {
    // The TS-side hex remap had a 1-in-16M false-positive: explicit
    // \x1b[38;2;r;g;bm whose RGB happened to equal one of ghostty's 16
    // defaults would be rewritten. The Zig override only rewrites palette
    // indices, so explicit RGBs always pass through.
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[6] = [0x14, 0xa0, 0xa0];
    installHostPalette(probed);

    expect(fgOf("\x1b[38;2;138;190;183mX\x1b[0m")).toBe(GHOSTTY_DEFAULT_CYAN);
  });

  test("indices 16+ are untouched (xterm cube + grayscale)", () => {
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[0] = [0xff, 0xff, 0xff];
    installHostPalette(probed);

    // Index 16 is the origin of the 6×6×6 xterm color cube and is
    // identical across every common host terminal.
    expect(fgOf("\x1b[38;5;16mX\x1b[0m")).toBe("#000000");
  });

  test("inner OSC 4 still wins at runtime (DynamicPalette.set on top of our default)", () => {
    // We override the underlying default; programs can still override at
    // runtime via OSC 4. Verify that escape hatch still works.
    const probed: (RGB | null)[] = new Array(16).fill(null);
    probed[6] = [0x14, 0xa0, 0xa0];
    installHostPalette(probed);

    expect(fgOf("\x1b]4;6;rgb:00/80/80\x1b\\\x1b[36mX\x1b[0m")).toBe("#008080");
  });

  test("tolerates a probed array shorter than 16 entries", () => {
    installHostPalette([[0x10, 0x20, 0x30]]);
    expect(fgOf("\x1b[30mX\x1b[0m")).toBe("#102030");
  });

  test("ignores entries past index 15", () => {
    const probed: (RGB | null)[] = new Array(20).fill(null);
    probed[18] = [0xff, 0x00, 0xff];
    installHostPalette(probed);

    // Index 18 should still resolve to the standard xterm cube value, not
    // our out-of-range entry.
    expect(fgOf("\x1b[38;5;18mX\x1b[0m")).not.toBe("#ff00ff");
  });
});
