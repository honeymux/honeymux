/**
 * Terminal-adaptive theme system.
 *
 * Derives all UI colors from a base16 palette.  Ships 19 built-in schemes
 * loaded from YAML, plus a "custom" option that reads user-provided colors
 * from config.json.
 */
import {
  BASE16_SCHEME_NAMES,
  BASE16_SCHEMES,
  type Base16Palette,
  type Base16SchemeName,
} from "./schemes/base16/index.ts";

export type { Base16Palette, Base16SchemeName };
export { BASE16_SCHEME_NAMES };

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let b1: number, g1: number, r1: number;
  if (h < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (h < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/** Returns true if the color is light enough that dark text reads better on it. */
export function isBright(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  // Perceived brightness (ITU-R BT.601)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}

/** Convert RGB (0..255) to HSV with h in [0, 360), s and v in [0, 1]. */
export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

// ---------------------------------------------------------------------------
// Theme interface & defaults
// ---------------------------------------------------------------------------

/** The built-in scheme used before initTheme() is called and as fallback. */
export const DEFAULT_SCHEME: Base16SchemeName = "spacemacs";

interface Theme {
  accent: string;
  accentRgb: RGB;
  backdropOverlay: string;
  badgeAccent: string;
  badgeAccentRgb: RGB;
  bg: string;
  bgChrome: string;
  bgDenyFocused: string;
  bgFocused: string;
  bgOverlay: string;
  bgSurface: string;
  border: string;
  borderActive: string;
  hintFadeSequence: string[];
  statusError: string;
  statusErrorDim: string;
  statusInfo: string;
  statusProcessing: string;
  statusSuccess: string;
  statusWarning: string;
  text: string;
  textBright: string;
  textDim: string;
  textOnBright: string;
  textPlus: string;
  textSecondary: string;
}

/**
 * The active palette's 16 ANSI colors, populated at theme init.
 * Used by the session color picker to conform to the user's base16 palette.
 */
export const paletteColors: RGB[] = new Array(16).fill([128, 128, 128]) as RGB[];

/**
 * Predefined palette of 14 visually distinct colors auto-assigned to new
 * tmux sessions.  Colors cycle round-robin, skipping any already in use.
 */
export const SESSION_PALETTE: string[] = [
  "#ee7f32", // orange (default — matches badge fallback)
  "#f38ba8", // rose
  "#a6e3a1", // green
  "#89b4fa", // blue
  "#f9e2af", // yellow
  "#cba6f7", // lavender
  "#94e2d5", // teal
  "#f5c2e7", // pink
  "#74c7ec", // sky
  "#eba0ac", // maroon
  "#b4befe", // periwinkle
  "#89dceb", // sapphire
  "#a6adc8", // overlay
  "#f5e0dc", // rosewater
  "#cdd6f4", // text
];

/**
 * Pick the next session color from SESSION_PALETTE that isn't already used
 * by an existing session.  When every color is taken, pick the one used the
 * fewest times (ties broken by palette order so cycling is evenly distributed).
 *
 * Only explicit (non-undefined) color values are considered.  Callers should
 * not include the session being colored in the input array.
 */
export function getNextSessionColor(usedColors: (string | undefined)[]): string {
  const defined = usedColors.filter((c): c is string => c != null);
  const used = new Set(defined.map((c) => c.toLowerCase()));
  for (const color of SESSION_PALETTE) {
    if (!used.has(color.toLowerCase())) return color;
  }
  // All colors exhausted — pick the one used the fewest times
  const counts = new Map<string, number>();
  for (const c of defined) {
    const key = c.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = SESSION_PALETTE[0]!;
  let bestCount = Infinity;
  for (const color of SESSION_PALETTE) {
    const n = counts.get(color.toLowerCase()) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

/**
 * The terminal's actual background color as queried via OSC 11.
 * Always populated at startup regardless of theme mode.
 * Falls back to the default scheme's bg/fg if the terminal doesn't respond.
 */
export let terminalBgRgb: RGB = hexToRgb(BASE16_SCHEMES[DEFAULT_SCHEME].base00);
export let terminalFgRgb: RGB = hexToRgb(BASE16_SCHEMES[DEFAULT_SCHEME].base05);

/**
 * The outer terminal's native cursor style as a DECSCUSR parameter (1-6),
 * queried at startup via DECRQSS. Null if the terminal didn't respond.
 */
export let terminalCursorParam: null | number = null;

// ---------------------------------------------------------------------------
// Theme name registry
// ---------------------------------------------------------------------------

export type ThemeMode = "built-in" | "custom";
export type ThemeName = "custom" | Base16SchemeName;

export const THEME_MODES: ThemeMode[] = ["built-in", "custom"];
export const THEME_NAMES: ThemeName[] = [...BASE16_SCHEME_NAMES, "custom"];

interface TerminalPalette {
  bg: RGB;
  colors: (RGB | null)[]; // indices 0..15
  fg: RGB;
}

// ---------------------------------------------------------------------------
// Palette conversion
// ---------------------------------------------------------------------------

export function resolveThemeName(themeMode: ThemeMode, themeBuiltin: Base16SchemeName): ThemeName {
  return themeMode === "custom" ? "custom" : themeBuiltin;
}

/**
 * Build a TerminalPalette from base16 hex values.
 * Mapping: fg=base05, bg=base00
 * ANSI 0=base00, 1=base08, 2=base0B, 3=base0A, 4=base0D, 5=base0E, 6=base0C, 7=base05
 * ANSI 8=base03, 9=base09, 10=base01, 11=base02, 12=base04, 13=base06, 14=base0F, 15=base07
 */
function base16Palette(b: Base16Palette): TerminalPalette {
  return {
    bg: hexToRgb(b.base00),
    colors: [
      hexToRgb(b.base00),
      hexToRgb(b.base08),
      hexToRgb(b.base0B),
      hexToRgb(b.base0A),
      hexToRgb(b.base0D),
      hexToRgb(b.base0E),
      hexToRgb(b.base0C),
      hexToRgb(b.base05),
      hexToRgb(b.base03),
      hexToRgb(b.base09),
      hexToRgb(b.base01),
      hexToRgb(b.base02),
      hexToRgb(b.base04),
      hexToRgb(b.base06),
      hexToRgb(b.base0F),
      hexToRgb(b.base07),
    ],
    fg: hexToRgb(b.base05),
  };
}

/** Pre-built palettes for all built-in schemes. */
const BUILTIN_PALETTES: Record<Base16SchemeName, TerminalPalette> = Object.fromEntries(
  (Object.entries(BASE16_SCHEMES) as [Base16SchemeName, Base16Palette][]).map(([name, p]) => [name, base16Palette(p)]),
) as Record<Base16SchemeName, TerminalPalette>;

// ---------------------------------------------------------------------------
// Theme derivation
// ---------------------------------------------------------------------------

function deriveTheme(palette: TerminalPalette): Theme {
  // Base16 grayscale ramp (UI chrome)
  const bg = palette.bg; // base00 — default background
  const fg = palette.fg; // base05 — default foreground
  const base01 = palette.colors[10] ?? bg; // elevated surface / panel bg
  const base02 = palette.colors[11] ?? bg; // selection / active surface
  const base03 = palette.colors[8] ?? fg; // comments / muted text
  const base04 = palette.colors[12] ?? fg; // dark foreground / status bar fg
  const base07 = palette.colors[15] ?? [255, 255, 255]; // brightest foreground

  // Base16 chromatic slots
  const red = palette.colors[1] ?? [255, 102, 102]; // base08
  const green = palette.colors[2] ?? [102, 191, 115]; // base0B
  const yellow = palette.colors[3] ?? [255, 179, 0]; // base0A
  const blue = palette.colors[4] ?? [137, 180, 250]; // base0D
  const cyan = palette.colors[6] ?? [0, 204, 204]; // base0C
  const orange = palette.colors[9] ?? [217, 120, 87]; // base09

  // Primary accent: base0D (canonical across base16 ecosystem)
  const accentRgb: RGB = blue;
  const accent = rgbToHex(accentRgb);

  // Badge accent: base09 (orange)
  const badgeAccentRgb: RGB = orange;
  const badgeAccent = rgbToHex(badgeAccentRgb);

  // Text hierarchy from canonical base16 slots
  const text = rgbToHex(fg); // base05
  const textBright = rgbToHex(base07); // base07
  const textSecondary = rgbToHex(base04); // base04
  const textDim = rgbToHex(base03); // base03
  const textPlus = rgbToHex(lerpRgb(base03, base04, 0.5)); // midpoint
  const textOnBright = rgbToHex(bg); // base00

  // Surface hierarchy from canonical base16 slots
  const bgChrome = rgbToHex(lerpRgb(bg, base01, 0.5)); // midpoint — toolbar, sidebar
  const bgSurface = rgbToHex(base01); // base01 — dialogs, panels
  const bgFocused = rgbToHex(base02); // base02 — selection, active
  const bgOverlay = rgbToHex(base01); // base01 — popup/float bg
  const bgDenyFocused = rgbToHex(lerpRgb(bg, red, 0.1)); // computed (no base16 convention)

  // Borders: base02 inactive, base0D active (Zed: border.focused)
  const border = rgbToHex(base02);
  const borderActive = accent;

  // Status colors from chromatic slots
  const statusProcessing = rgbToHex(orange); // base09
  const statusSuccess = rgbToHex(green); // base0B
  const statusWarning = rgbToHex(yellow); // base0A
  const statusInfo = rgbToHex(cyan); // base0C
  const statusError = rgbToHex(red); // base08
  const statusErrorDim = rgbToHex(lerpRgb(red, bg, 0.33));

  const bgHex = rgbToHex(bg);
  const backdropOverlay = bgHex + "88";

  const hintFadeSequence = [textSecondary, text, textBright, textBright, text, textSecondary];

  return {
    accent,
    accentRgb,
    backdropOverlay,
    badgeAccent,
    badgeAccentRgb,
    bg: bgHex,
    bgChrome,
    bgDenyFocused,
    bgFocused,
    bgOverlay,
    bgSurface,
    border,
    borderActive,
    hintFadeSequence,
    statusError,
    statusErrorDim,
    statusInfo,
    statusProcessing,
    statusSuccess,
    statusWarning,
    text,
    textBright,
    textDim,
    textOnBright,
    textPlus,
    textSecondary,
  };
}

/** Mutable singleton — import and read fields directly. */
export const theme: Theme = deriveTheme(BUILTIN_PALETTES[DEFAULT_SCHEME]);

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------

/** Data from the terminal probe needed for theme initialization. */
interface ThemeProbeData {
  bg: RGB | null;
  cursorStyle: null | number;
  fg: RGB | null;
  paletteColors: (RGB | null)[];
}

/**
 * Re-derive theme from a named palette (or custom) and mutate the singleton.
 * Used for live preview in the options dialog.
 */
export function applyTheme(name: ThemeName, customPalette?: Base16Palette): void {
  let palette: TerminalPalette;
  if (name === "custom" && customPalette) {
    palette = base16Palette(customPalette);
  } else if (name !== "custom") {
    palette = BUILTIN_PALETTES[name];
  } else {
    return; // custom without palette — nothing to apply
  }
  Object.assign(theme, deriveTheme(palette));
  populatePaletteColors(palette);
}

/** Get the 16 ANSI palette colors for a named built-in scheme. */
export function getSchemePaletteColors(name: Base16SchemeName): RGB[] {
  return BUILTIN_PALETTES[name].colors.map((c) => c ?? [128, 128, 128]);
}

/**
 * Initialize the theme singleton from a named scheme or custom palette.
 * @param customPalette  Required when name is "custom".
 */
export function initTheme(
  name: ThemeName = DEFAULT_SCHEME,
  probe?: ThemeProbeData,
  customPalette?: Base16Palette,
): void {
  if (probe?.bg) terminalBgRgb = probe.bg;
  if (probe?.fg) terminalFgRgb = probe.fg;
  if (probe?.cursorStyle !== null && probe?.cursorStyle !== undefined) {
    terminalCursorParam = probe.cursorStyle;
  }

  let palette: TerminalPalette;
  if (name === "custom" && customPalette) {
    palette = base16Palette(customPalette);
  } else if (name !== "custom") {
    palette = BUILTIN_PALETTES[name];
  } else {
    // "custom" without palette data — fall back to default scheme
    palette = BUILTIN_PALETTES[DEFAULT_SCHEME];
  }
  Object.assign(theme, deriveTheme(palette));
  populatePaletteColors(palette);
}

function populatePaletteColors(palette: TerminalPalette): void {
  for (let i = 0; i < 16; i++) {
    paletteColors[i] = palette.colors[i] ?? [128, 128, 128];
  }
}
