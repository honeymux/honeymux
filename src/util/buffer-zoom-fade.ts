/**
 * Fade transitions for buffer zoom.
 *
 * - Fade-out: animates a translucent black BoxRenderable over the alt screen
 *   so the OpenTUI UI and ghostty pane content visibly dim before we exit
 *   to the primary screen.
 * - Fade-in: parses the captured pane scrollback into ANSI segments, then
 *   re-emits the visible portion across N frames with each segment's fg/bg
 *   colors lerped from the terminal background toward their target. Older
 *   scrollback that won't be visible after the fade is written once at full
 *   color into the terminal scrollback buffer first.
 *
 * Both effects gate on truecolor capability (`Tc` or `RGB` via XTGETTCAP);
 * callers should fall back to an instant switch when truecolor is unavailable.
 */
import type { CliRenderer } from "@opentui/core";

import { BoxRenderable, RGBA } from "@opentui/core";

import { type RGB, lerpRgb, paletteColors, terminalBgRgb, terminalFgRgb } from "../themes/theme.ts";
import { hasCap } from "./terminal-caps.ts";
import { writeTerminalOutput } from "./terminal-output.ts";
import { charWidth } from "./text.ts";

const SYNC_BEGIN = "\x1b[?2026h";
const SYNC_END = "\x1b[?2026l";

export interface AltScreenFadeHandle {
  cleanup: () => void;
  fadeIn: (options?: FadeOverlayInOptions) => Promise<void>;
}

export interface AnsiSegment {
  attrs: Attrs;
  bg: RGB | null;
  fg: RGB | null;
  text: string;
}

export interface FadeInOptions {
  content: string;
  /** Total duration in ms (default 300). */
  durationMs?: number;
  /** Number of animation frames (default 10). */
  frames?: number;
  /** Terminal display columns — used to pre-wrap content so fade redraws don't cause auto-wrap scroll. */
  termCols: number;
  /** Visible terminal rows — content beyond this fades in; older lines write straight. */
  termRows: number;
}

export interface FadeOutOptions {
  /** Total duration in ms (default 200). */
  durationMs?: number;
  /** Number of animation frames (default 8). */
  frames?: number;
  renderer: CliRenderer;
}

export interface FadeOverlayInOptions {
  /** Total duration in ms (default 200). */
  durationMs?: number;
  /** Number of animation frames (default 8). */
  frames?: number;
}

interface Attrs {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  reverse: boolean;
  strikethrough: boolean;
  underline: boolean;
}

interface FadeOverlayAnimationOptions {
  box: FadeOverlayRenderable;
  durationMs: number;
  frames: number;
  fromAlpha: number;
  renderer: FadeOverlayRenderer;
  toAlpha: number;
}

interface FadeOverlayRenderable {
  backgroundColor: RGBA;
  destroy(): void;
  height: number;
  width: number;
}

interface FadeOverlayRenderer {
  height: number;
  idle(): Promise<void>;
  requestRender(): void;
  width: number;
}

export async function animateFadeOverlayOpacity({
  box,
  durationMs,
  frames,
  fromAlpha,
  renderer,
  toAlpha,
}: FadeOverlayAnimationOptions): Promise<void> {
  const totalFrames = Math.max(frames, 1);
  const frameMs = durationMs / totalFrames;
  for (let f = 1; f <= totalFrames; f++) {
    const t = f / totalFrames;
    const alpha = Math.round(fromAlpha + (toAlpha - fromAlpha) * t);
    box.backgroundColor = RGBA.fromInts(0, 0, 0, alpha);
    renderer.requestRender();
    await renderer.idle();
    if (f < totalFrames) await Bun.sleep(frameMs);
  }
}

export async function fadeInPrimaryScreen({
  content,
  durationMs = 300,
  frames = 10,
  termCols,
  termRows,
}: FadeInOptions): Promise<void> {
  // Pre-wrap to the outer terminal's width so no logical line exceeds termCols.
  // tmux `capture-pane -J` joins soft-wrapped lines, so captured lines can be
  // far wider than the outer terminal. Without this pass, each fade frame's
  // rewrite of the visible area would auto-wrap past termRows and scroll
  // partially-faded rows into the scrollback, leaving behind "various states
  // of faded colors" as permanent content.
  const wrapped = wrapContentToTermCols(content, termCols);
  // Strip a single trailing newline so we don't push an extra blank line.
  const trimmed = wrapped.endsWith("\n") ? wrapped.slice(0, -1) : wrapped;
  const lines = trimmed.split("\n");

  const headLines = lines.length > termRows ? lines.slice(0, lines.length - termRows) : [];
  const visibleLines = lines.length > termRows ? lines.slice(-termRows) : lines;
  const visibleText = visibleLines.join("\n");
  const segments = parseAnsiSegments(visibleText);

  const targetBg = terminalBgRgb;
  const defaultFgTarget = terminalFgRgb;

  // First frame: bundle the head-write + visible-area clear + frame 1 inside
  // a single synchronized output block so the user never sees an unfaded
  // intermediate state. ESC[H ESC[J clears from cursor to end-of-screen
  // without touching scrollback. The cursor is hidden up front so it doesn't
  // skitter through the screen as each frame's content is written; the
  // caller restores it after the fade completes.
  //
  // A bare ESC[0m reset is emitted before ESC[J because ED uses the currently
  // active SGR attributes to fill erased cells. Raw head content routinely
  // leaves the terminal in a non-default state (e.g. a trailing colored bg,
  // reverse, bold) because tmux's capture-pane -e output does not close out
  // SGR at end-of-line. Without this reset the clear would bake that styling
  // into every blank cell in the visible area, and emitFrame only repaints
  // cells that contain actual text — so trailing / empty cells would keep the
  // stray reverse or background indefinitely.
  let buf = SYNC_BEGIN + "\x1b[?25l";
  if (headLines.length > 0) buf += headLines.join("\n") + "\n";
  buf += "\x1b[0m\x1b[H\x1b[J";
  buf += emitFrame(segments, 1 / frames, targetBg, defaultFgTarget);
  buf += SYNC_END;
  writeTerminalOutput(buf);

  const frameMs = durationMs / frames;
  for (let f = 2; f <= frames; f++) {
    await Bun.sleep(frameMs);
    const t = f / frames;
    const next = SYNC_BEGIN + "\x1b[H" + emitFrame(segments, t, targetBg, defaultFgTarget) + SYNC_END;
    writeTerminalOutput(next);
  }
}

/**
 * Returns an overlay handle the caller must eventually either `fadeIn()` or
 * `cleanup()`. Keeping the box attached across suspend/resume lets the first
 * resumed alt-screen frame stay black, which avoids a full-brightness flash
 * before the reverse fade animation starts.
 */
export async function fadeOutAltScreen({
  durationMs = 200,
  frames = 8,
  renderer,
}: FadeOutOptions): Promise<AltScreenFadeHandle> {
  const box = new BoxRenderable(renderer, {
    backgroundColor: RGBA.fromInts(0, 0, 0, 0),
    height: renderer.height,
    left: 0,
    position: "absolute",
    top: 0,
    width: renderer.width,
    zIndex: 10_000,
  });
  renderer.root.add(box);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      box.destroy();
    } catch {
      // best-effort
    }
  };

  try {
    await animateFadeOverlayOpacity({
      box,
      durationMs,
      frames,
      fromAlpha: 0,
      renderer,
      toAlpha: 255,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  return {
    cleanup,
    fadeIn: async ({ durationMs = 200, frames = 8 }: FadeOverlayInOptions = {}) => {
      if (cleaned) return;
      syncFadeOverlayBounds(box, renderer);
      try {
        await animateFadeOverlayOpacity({
          box,
          durationMs,
          frames,
          fromAlpha: 255,
          renderer,
          toAlpha: 0,
        });
      } finally {
        cleanup();
      }
    },
  };
}

export function supportsFadeTransitions(): boolean {
  return hasCap("Tc") || hasCap("RGB");
}

/**
 * Insert soft wraps into a stream of ANSI-decorated text so no logical line
 * exceeds `termCols` display columns. Walks the input character by character,
 * passing CSI/OSC escape sequences through with zero width, counting wide
 * characters as two cells, and inserting a "\n" whenever the next printable
 * glyph would push the column past `termCols`. Existing newlines reset the
 * column. Callers must still honor the result's newline structure.
 */
export function wrapContentToTermCols(content: string, termCols: number): string {
  if (termCols <= 0) return content;
  let out = "";
  let col = 0;
  let i = 0;
  while (i < content.length) {
    const code = content.charCodeAt(i);
    if (code === 0x1b && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1);
      if (next === 0x5b /* [ */) {
        let j = i + 2;
        while (j < content.length) {
          const c = content.charCodeAt(j);
          if (c >= 0x40 && c <= 0x7e) break;
          j++;
        }
        if (j >= content.length) {
          out += content.slice(i);
          break;
        }
        out += content.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (next === 0x5d /* ] */) {
        let j = i + 2;
        while (j < content.length) {
          if (content.charCodeAt(j) === 0x07) {
            j++;
            break;
          }
          if (content.charCodeAt(j) === 0x1b && j + 1 < content.length && content.charCodeAt(j + 1) === 0x5c) {
            j += 2;
            break;
          }
          j++;
        }
        out += content.slice(i, j);
        i = j;
        continue;
      }
      out += content.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (code === 0x0a /* \n */) {
      // Reset SGR + erase-to-end-of-line before every original newline so
      // that stray attributes (most visibly reverse video) from tmux's
      // capture-pane output cannot bleed across line boundaries, and so any
      // cells past the written text — common when the outer terminal is
      // wider than the original pane — are explicitly cleaned up with the
      // default background. When col == termCols the cursor is in a
      // pending-wrap state where ESC[K can wipe the last written column, so
      // skip the erase in that case; the row is already fully painted.
      out += col >= termCols ? "\x1b[0m\n" : "\x1b[0m\x1b[K\n";
      col = 0;
      i++;
      continue;
    }
    if (code === 0x0d /* \r */) {
      out += "\r";
      col = 0;
      i++;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += content[i];
      i++;
      continue;
    }
    const cp = content.codePointAt(i) ?? code;
    const ch = String.fromCodePoint(cp);
    const w = charWidth(ch);
    if (w > 0 && col + w > termCols) {
      out += "\n";
      col = 0;
    }
    out += ch;
    col += w;
    i += ch.length;
  }
  return out;
}

const BLANK_ATTRS: Attrs = {
  bold: false,
  dim: false,
  italic: false,
  reverse: false,
  strikethrough: false,
  underline: false,
};

interface SgrState {
  attrs: Attrs;
  bg: RGB | null;
  fg: RGB | null;
}

export function parseAnsiSegments(input: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  const state = { attrs: cloneAttrs(BLANK_ATTRS), bg: null as RGB | null, fg: null as RGB | null };
  let text = "";

  const flush = () => {
    if (text.length === 0) return;
    out.push({ attrs: cloneAttrs(state.attrs), bg: state.bg, fg: state.fg, text });
    text = "";
  };

  let i = 0;
  while (i < input.length) {
    const ch = input.charCodeAt(i);
    if (ch === 0x1b && i + 1 < input.length && input.charCodeAt(i + 1) === 0x5b /* [ */) {
      let j = i + 2;
      while (j < input.length) {
        const c = input.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) break;
        j++;
      }
      if (j >= input.length) break;
      const final = input.charCodeAt(j);
      if (final === 0x6d /* m */) {
        flush();
        applySgr(input.slice(i + 2, j), state);
      } else {
        // Non-SGR CSI — pass through verbatim within the current segment.
        text += input.slice(i, j + 1);
      }
      i = j + 1;
    } else if (ch === 0x1b) {
      // Other escape — copy two bytes through. Captured pane output from
      // tmux capture-pane -e is largely SGR-only after this point.
      text += input.slice(i, i + 2);
      i += 2;
    } else {
      text += input[i];
      i++;
    }
  }
  flush();
  return out;
}

function applySgr(paramStr: string, state: SgrState): void {
  const parts = paramStr.length === 0 ? [0] : paramStr.split(";").map((s) => (s.length === 0 ? 0 : parseInt(s, 10)));
  let i = 0;
  while (i < parts.length) {
    const n = parts[i]!;
    if (n === 0) {
      state.fg = null;
      state.bg = null;
      state.attrs.bold = false;
      state.attrs.dim = false;
      state.attrs.italic = false;
      state.attrs.underline = false;
      state.attrs.reverse = false;
      state.attrs.strikethrough = false;
    } else if (n === 1) state.attrs.bold = true;
    else if (n === 2) state.attrs.dim = true;
    else if (n === 3) state.attrs.italic = true;
    else if (n === 4) state.attrs.underline = true;
    else if (n === 7) state.attrs.reverse = true;
    else if (n === 9) state.attrs.strikethrough = true;
    else if (n === 22) {
      state.attrs.bold = false;
      state.attrs.dim = false;
    } else if (n === 23) state.attrs.italic = false;
    else if (n === 24) state.attrs.underline = false;
    else if (n === 27) state.attrs.reverse = false;
    else if (n === 29) state.attrs.strikethrough = false;
    else if (n === 39) state.fg = null;
    else if (n === 49) state.bg = null;
    else if (n >= 30 && n <= 37) state.fg = palette16(n - 30);
    else if (n >= 90 && n <= 97) state.fg = palette16(n - 90 + 8);
    else if (n >= 40 && n <= 47) state.bg = palette16(n - 40);
    else if (n >= 100 && n <= 107) state.bg = palette16(n - 100 + 8);
    else if (n === 38 || n === 48) {
      const sub = parts[i + 1];
      if (sub === 2) {
        const rgb: RGB = [parts[i + 2] ?? 0, parts[i + 3] ?? 0, parts[i + 4] ?? 0];
        if (n === 38) state.fg = rgb;
        else state.bg = rgb;
        i += 4;
      } else if (sub === 5) {
        const rgb = palette256(parts[i + 2] ?? 0);
        if (n === 38) state.fg = rgb;
        else state.bg = rgb;
        i += 2;
      }
    }
    i++;
  }
}

function cloneAttrs(a: Attrs): Attrs {
  return { ...a };
}

function emitFrame(segments: readonly AnsiSegment[], t: number, targetBg: RGB, defaultFgTarget: RGB): string {
  let out = "";
  // Reset state at the start so we don't inherit anything from prior frames.
  out += "\x1b[0m";
  let prevAttrs: Attrs = cloneAttrs(BLANK_ATTRS);
  let prevFg = "";
  let prevBg = "";

  for (const seg of segments) {
    // Attribute deltas
    if (seg.attrs.bold !== prevAttrs.bold) out += seg.attrs.bold ? "\x1b[1m" : "\x1b[22m";
    if (seg.attrs.dim !== prevAttrs.dim) out += seg.attrs.dim ? "\x1b[2m" : "\x1b[22m";
    if (seg.attrs.italic !== prevAttrs.italic) out += seg.attrs.italic ? "\x1b[3m" : "\x1b[23m";
    if (seg.attrs.underline !== prevAttrs.underline) out += seg.attrs.underline ? "\x1b[4m" : "\x1b[24m";
    if (seg.attrs.reverse !== prevAttrs.reverse) out += seg.attrs.reverse ? "\x1b[7m" : "\x1b[27m";
    if (seg.attrs.strikethrough !== prevAttrs.strikethrough) out += seg.attrs.strikethrough ? "\x1b[9m" : "\x1b[29m";
    prevAttrs = cloneAttrs(seg.attrs);

    // Foreground: blend toward terminal bg. Default fg uses defaultFgTarget so
    // unstyled text fades in too.
    const fgSrc = seg.fg ?? defaultFgTarget;
    const fgRgb = lerpRgb(targetBg, fgSrc, t);
    const fgKey = `${fgRgb[0]};${fgRgb[1]};${fgRgb[2]}`;
    if (fgKey !== prevFg) {
      out += `\x1b[38;2;${fgKey}m`;
      prevFg = fgKey;
    }

    // Background: only emit if the segment has an explicit bg. Default bg is
    // already targetBg so blending it would be a no-op.
    if (seg.bg !== null) {
      const bgRgb = lerpRgb(targetBg, seg.bg, t);
      const bgKey = `${bgRgb[0]};${bgRgb[1]};${bgRgb[2]}`;
      if (bgKey !== prevBg) {
        out += `\x1b[48;2;${bgKey}m`;
        prevBg = bgKey;
      }
    } else if (prevBg !== "") {
      out += "\x1b[49m";
      prevBg = "";
    }

    out += seg.text;
  }
  out += "\x1b[0m";
  return out;
}

function syncFadeOverlayBounds(box: FadeOverlayRenderable, renderer: FadeOverlayRenderer): void {
  box.height = renderer.height;
  box.width = renderer.width;
}

// Standard xterm 16-color palette as a fallback when the live palette from
// the OSC 4 probe wasn't populated. Slot 0..7 are the dim ANSI colors, 8..15
// are the bright variants.
const XTERM_16: readonly RGB[] = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function palette16(idx: number): RGB {
  const live = paletteColors[idx];
  // The theme module pre-fills paletteColors with [128,128,128] before the
  // probe runs; treat that placeholder as "not yet populated" and fall back.
  if (live && !(live[0] === 128 && live[1] === 128 && live[2] === 128)) return live;
  return XTERM_16[idx] ?? [128, 128, 128];
}

function palette256(idx: number): RGB {
  if (idx < 16) return palette16(idx);
  if (idx < 232) {
    const i = idx - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const conv = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return [conv(r), conv(g), conv(b)];
  }
  if (idx < 256) {
    const v = 8 + (idx - 232) * 10;
    return [v, v, v];
  }
  return [128, 128, 128];
}
