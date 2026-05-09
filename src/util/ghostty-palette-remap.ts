/**
 * Pushes the outer terminal's user-configured 0-15 ANSI palette into
 * ghostty-vt at terminal-init time, via a Zig-side override
 * (`DynamicPalette.changeDefault`) exposed through ghostty-opentui's
 * `setBasePaletteEntry` / `clearBasePalette` FFI.
 *
 * Why this layer exists: ghostty-vt resolves palette-indexed SGR codes
 * (`\x1b[3Nm`, `\x1b[9Nm`, `\x1b[38;5;Nm` with N < 16) against its own
 * hardcoded Tomorrow Night palette before any span crosses the FFI
 * boundary. Without an override, fish/tide/ls/vim render with ghostty's
 * cyan/blue/etc. instead of the user's terminal theme — visible drift
 * between hmx-rendered content and any non-hmx output.
 *
 * The probe runs once at startup (OSC 4 in `terminal-probe.ts`) and the
 * result is pushed straight into ghostty-vt. Indices 16-255 are left at
 * ghostty's defaults — the standardized xterm-256color cube + grayscale
 * formula matches every common host terminal byte-for-byte.
 */

import { clearBasePalette, setBasePaletteEntry } from "ghostty-opentui";

import type { RGB } from "../themes/theme.ts";

/**
 * Push the probed outer-terminal 0-15 palette into ghostty-vt. Entries the
 * probe couldn't resolve (timeouts, unsupported terminals) are left at
 * ghostty's defaults so we never display a wrong color confidently.
 *
 * Idempotent and safe to call before any terminal is created. Has no
 * effect on platforms without the native module (Windows fallback).
 */
export function installHostPalette(probed: readonly (RGB | null)[]): void {
  clearBasePalette();
  const len = Math.min(probed.length, 16);
  for (let i = 0; i < len; i++) {
    const rgb = probed[i];
    if (!rgb) continue;
    setBasePaletteEntry(i, rgb[0], rgb[1], rgb[2]);
  }
}
