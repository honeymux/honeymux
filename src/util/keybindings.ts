import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { terminalBaseName } from "./terminal-detect.ts";

export type KeyAction =
  | "activateMenu"
  | "agentLatch"
  | "agentPermApprove"
  | "agentPermDeny"
  | "agentPermDismiss"
  | "agentPermGoto"
  | "agentReviewGoto"
  | "agentReviewNext"
  | "agentReviewPrev"
  | "agents"
  | "bufferZoom"
  | "conversations"
  | "favoriteProfile"
  | "mainMenu"
  | "mobile"
  | "newPaneTab"
  | "nextPaneTab"
  | "nextSession"
  | "nextWindow"
  | "notifications"
  | "options"
  | "prevPaneTab"
  | "prevSession"
  | "prevWindow"
  | "profiles"
  | "quickTerminal"
  | "redraw"
  | "review"
  | "screenshot"
  | "sessions"
  | "sidebar"
  | "sidebarFocus"
  | "toolbar"
  | "toolbarFocus"
  | "zoomAgentsView"
  | "zoomServerView";

export type KeybindingConfig = Record<KeyAction, string>;

// emulatorBaseName has moved to terminal-detect.ts as terminalBaseName so
// other modules that need to match against the bare emulator name (e.g.
// the iTerm2-bleed post-processor in index.tsx) can share the parsing
// rather than re-export this helper from a UI-domain module.

/** Sort an overrides dict alphabetically by key. */
function sortOverrides(obj: Record<string, Partial<KeybindingConfig>>): Record<string, Partial<KeybindingConfig>> {
  const sorted: Record<string, Partial<KeybindingConfig>> = {};
  for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    const value = obj[key];
    if (value) sorted[key] = value;
  }
  return sorted;
}

/** JSON.stringify replacer that sorts object keys alphabetically. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
}

export const DEFAULT_KEYBINDINGS: KeybindingConfig = {
  activateMenu: "",
  agentLatch: "",
  agentPermApprove: "",
  agentPermDeny: "",
  agentPermDismiss: "",
  agentPermGoto: "",
  agentReviewGoto: "g",
  agentReviewNext: "down",
  agentReviewPrev: "up",
  agents: "",

  bufferZoom: "",
  conversations: "",
  favoriteProfile: "",
  mainMenu: "ctrl+g",
  mobile: "",
  newPaneTab: "",
  nextPaneTab: "",
  nextSession: "",
  nextWindow: "",
  notifications: "",
  options: "",
  prevPaneTab: "",
  prevSession: "",
  prevWindow: "",
  profiles: "",
  quickTerminal: "",
  redraw: "",
  review: "",
  screenshot: "",
  sessions: "",
  sidebar: "",
  sidebarFocus: "",
  toolbar: "",
  toolbarFocus: "",
  zoomAgentsView: "",
  zoomServerView: "",
};

interface KeybindingsFile {
  default: Partial<KeybindingConfig>;
  overrides?: Record<string, Partial<KeybindingConfig>>;
}

const CONFIG_DIR = `${process.env.HOME}/.config/honeymux`;
const KEYBINDINGS_FILE = `${CONFIG_DIR}/keybindings.json`;

const VALID_ACTIONS = new Set<string>(Object.keys(DEFAULT_KEYBINDINGS));

/**
 * Build a lookup map from canonical key combo → action name.
 *
 * Stored bindings may be raw terminal sequences ("\x07") or canonical
 * identifiers ("ctrl+g").  Both are converted to canonical form via
 * identifyKeySequence so that matching works regardless of the terminal
 * protocol (legacy, kitty CSI u, xterm modifyOtherKeys).
 */
export function buildSequenceMap(config: KeybindingConfig): Map<string, KeyAction> {
  const map = new Map<string, KeyAction>();
  for (const [action, value] of Object.entries(config)) {
    if (!value) continue;
    const canonical = identifyKeySequence(value);
    // Use canonical form if parseable, otherwise store as-is (already canonical)
    map.set(canonical ?? value, action as KeyAction);
  }
  return map;
}

/**
 * Ensure keybindings file exists and contains an overrides entry for the
 * current terminal emulator.  Creates the file on first run; on subsequent
 * runs, adds an empty override sub-dict for any newly-seen emulator so the
 * user can easily discover where to place per-emulator bindings.
 */
export async function ensureKeybindingsFile(): Promise<void> {
  const name = terminalBaseName();

  if (!existsSync(KEYBINDINGS_FILE)) {
    // First run — seed the file with defaults + empty emulator entry.
    const file: KeybindingsFile = {
      default: DEFAULT_KEYBINDINGS,
      overrides: name ? { [name]: {} } : undefined,
    };
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      await Bun.write(KEYBINDINGS_FILE, JSON.stringify(file, sortedReplacer, 2) + "\n");
    } catch {
      // best-effort
    }
    return;
  }

  // File exists — backfill an empty entry for this emulator if missing.
  if (!name) return;
  try {
    const content = readFileSync(KEYBINDINGS_FILE, "utf-8");
    const parsed = JSON.parse(content) as KeybindingsFile;
    if (parsed.overrides?.[name]) return; // already present
    if (!parsed.overrides) parsed.overrides = {};
    parsed.overrides[name] = {};
    parsed.overrides = sortOverrides(parsed.overrides);
    await Bun.write(KEYBINDINGS_FILE, JSON.stringify(parsed, sortedReplacer, 2) + "\n");
  } catch {
    // best-effort
  }
}

/** Match the standard dismiss key for dialogs and overlays. */
export function isDismissKey(data: string): boolean {
  return isEscape(data);
}

/** Match Escape in any encoding (legacy, kitty CSI u, kitty CSI u with mod=1) */
export function isEscape(data: string): boolean {
  return data === "\x1b" || data === "\x1b[27u" || data === "\x1b[27;1u";
}

// ---------------------------------------------------------------------------
// Key identity helpers
// ---------------------------------------------------------------------------

/**
 * Load keybindings from ~/.config/honeymux/keybindings.json.
 *
 * File structure:
 *   { "default": { ... }, "overrides": { "<TERM>": { ... }, "Ghostty": { ... }, ... } }
 *
 * Overrides keys can be $TERM values (e.g. "xterm-256color") or terminal
 * emulator names detected via XTVERSION (e.g. "Ghostty", "iTerm2", "WezTerm",
 * "Kitty", "Alacritty", "Foot", "Contour").
 *
 * Merge order: hardcoded defaults → file "default" → overrides[$TERM] → overrides[emulator]
 */
export function loadKeybindings(): KeybindingConfig {
  const term = process.env.TERM ?? "";
  try {
    const content = readFileSync(KEYBINDINGS_FILE, "utf-8");
    const parsed = JSON.parse(content) as KeybindingsFile;
    const fileDefaults = parsed.default ? filterActions(parsed.default as Record<string, unknown>) : {};
    const termOverrides =
      term && parsed.overrides?.[term] ? filterActions(parsed.overrides[term] as Record<string, unknown>) : {};
    const emulator = terminalBaseName();
    const emulatorOverrides =
      emulator && parsed.overrides?.[emulator]
        ? filterActions(parsed.overrides[emulator] as Record<string, unknown>)
        : {};
    return { ...DEFAULT_KEYBINDINGS, ...fileDefaults, ...termOverrides, ...emulatorOverrides };
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

/**
 * Save keybindings to ~/.config/honeymux/keybindings.json.
 * Preserves any existing overrides and ensures the current emulator has an entry.
 */
export async function saveKeybindings(config: KeybindingConfig): Promise<void> {
  try {
    let overrides: Record<string, Partial<KeybindingConfig>> | undefined;
    try {
      const content = readFileSync(KEYBINDINGS_FILE, "utf-8");
      const parsed = JSON.parse(content) as KeybindingsFile;
      overrides = parsed.overrides;
    } catch {
      // no existing file
    }
    // Ensure the current emulator has an overrides entry.
    const emulator = terminalBaseName();
    if (emulator) {
      if (!overrides) overrides = {};
      if (!overrides[emulator]) overrides[emulator] = {};
    }
    const file: KeybindingsFile = { default: config };
    if (overrides) file.overrides = sortOverrides(overrides);
    mkdirSync(CONFIG_DIR, { recursive: true });
    await Bun.write(KEYBINDINGS_FILE, JSON.stringify(file, sortedReplacer, 2) + "\n");
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Sequence map (canonical combo → action)
// ---------------------------------------------------------------------------

function filterActions(obj: Record<string, unknown>): Partial<KeybindingConfig> {
  const out: Partial<KeybindingConfig> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (VALID_ACTIONS.has(key) && typeof value === "string") {
      out[key as KeyAction] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sequence identification (raw bytes → human-readable combo string)
// ---------------------------------------------------------------------------

/**
 * CSI sequences that end in a letter (no `~` and no `u` terminator).
 * Covers arrows (A-D), home (H), and end (F). F1-F4 via `CSI 1;mod P/Q/R/S`
 * is intentionally omitted because `R` collides with cursor-position-report
 * responses; modified F1-F4 arrives via the Kitty CSI u functional codes
 * (57364-57367) when "report all keys as escape codes" is enabled.
 */
const CSI_LETTER_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  F: "end",
  H: "home",
};

/**
 * SS3 functional keys: ESC O <letter>.
 *
 * Sent by VTE/xterm-style terminals for arrows, home, and end whenever the
 * application cursor key mode (DECCKM) is active, and for legacy F1-F4
 * regardless of cursor mode. VTE in particular sends `ESC O H` / `ESC O F`
 * for plain Home/End even when DECCKM is off, which is why these are
 * unconditional rather than gated on cursor mode.
 */
const SS3_LETTER_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  F: "end",
  H: "home",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
};

/**
 * Legacy `CSI <num> ~` functional keys, sent by xterm/rxvt/VT220-style
 * terminals when the Kitty "report all keys as escape codes" flag is not
 * active. Modern terminals running honeymux (which pushes flag 8) send
 * Kitty CSI u high codes instead, but we still parse the legacy forms so
 * bindings work on terminals that ignore that flag.
 */
// Ordered numerically by xterm's function-key number, not alphabetically,
// because the numeric grouping (nav cluster 1-8, F-keys 11-24) is the
// salient structure. Lint's asciibetic key sort would scramble that.
/* eslint-disable perfectionist/sort-objects */
const CSI_TILDE_NAMES: Record<number, string> = {
  1: "home", // rxvt/VT
  2: "insert",
  3: "delete",
  4: "end", // rxvt/VT
  5: "page_up",
  6: "page_down",
  7: "home", // rxvt
  8: "end", // rxvt
  11: "f1",
  12: "f2",
  13: "f3",
  14: "f4",
  15: "f5",
  17: "f6",
  18: "f7",
  19: "f8",
  20: "f9",
  21: "f10",
  23: "f11",
  24: "f12",
};
/* eslint-enable perfectionist/sort-objects */

/**
 * Identify a raw terminal escape sequence and return its human-readable
 * key combo string (e.g. "\x1ba" → "alt+a", "\x07" → "ctrl+g").
 * Used only for display — never on the matching hot path.
 * Returns null for unrecognizable sequences.
 */
export function identifyKeySequence(seq: string): null | string {
  if (!seq) return null;

  // CSI letter with modifiers: ESC [ 1 ; <mod> <letter>  or  ESC [ <mod> <letter>
  // Covers arrows (A-D), home (H), end (F). Kitty keyboard may append
  // :<event-type> after the modifier (e.g. 5:1 for ctrl+press). Modifier
  // value is (flags + 1), so subtract 1 before checking bits.
  const csiLetter = seq.match(/^\x1b\[(?:1;)?(\d+)(?::\d+)?([ABCDFH])$/);
  if (csiLetter) {
    const mods = parseInt(csiLetter[1]!, 10) - 1;
    const name = CSI_LETTER_NAMES[csiLetter[2]!];
    if (!name) return null;
    return joinModsAndKey(mods, name);
  }

  // Plain CSI letter (no modifier): ESC [ <letter>
  const plainCsiLetter = seq.match(/^\x1b\[([ABCDFH])$/);
  if (plainCsiLetter) {
    const name = CSI_LETTER_NAMES[plainCsiLetter[1]!];
    if (name) return name;
  }

  // SS3 functional keys: ESC O <letter>
  // VTE sends home/end as ESC O H/F by default; any DECCKM-enabling terminal
  // also sends arrows in this form.
  const ss3 = seq.match(/^\x1bO([A-S])$/);
  if (ss3) {
    const name = SS3_LETTER_NAMES[ss3[1]!];
    if (name) return name;
  }

  // Legacy CSI ~ functional keys with modifiers: ESC [ <num> ; <mod> ~
  // Used by xterm/rxvt/VT220 for page_up/down, insert, delete, F5-F12, etc.
  // Kitty keyboard may append :<event-type> after the modifier.
  const csiTildeMod = seq.match(/^\x1b\[(\d+);(\d+)(?::\d+)?~$/);
  if (csiTildeMod) {
    const num = parseInt(csiTildeMod[1]!, 10);
    const mods = parseInt(csiTildeMod[2]!, 10) - 1;
    const name = CSI_TILDE_NAMES[num];
    if (name) return joinModsAndKey(mods, name);
  }

  // Legacy CSI ~ functional key without modifiers: ESC [ <num> ~
  const csiTildePlain = seq.match(/^\x1b\[(\d+)~$/);
  if (csiTildePlain) {
    const num = parseInt(csiTildePlain[1]!, 10);
    const name = CSI_TILDE_NAMES[num];
    if (name) return name;
  }

  // CSI u key with modifiers: ESC [ <code> ; <mod> u  (kitty protocol)
  // Kitty keyboard may append :<event-type> after the modifier (e.g. 5:1 for ctrl+press).
  // Modifier value is (flags + 1), so subtract 1 before checking bits.
  const csiU = seq.match(/^\x1b\[(\d+)(?::\d+)*;(\d+)(?::\d+)?u$/);
  if (csiU) {
    const code = parseInt(csiU[1]!, 10);
    const mods = parseInt(csiU[2]!, 10) - 1;
    return identifyCodeWithModifiers(code, mods);
  }

  // xterm modifyOtherKeys: ESC [ 27 ; <mod> ; <code> ~
  // Modifier value is (flags + 1), so subtract 1 before checking bits.
  const modifyOtherKeys = seq.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (modifyOtherKeys) {
    const mods = parseInt(modifyOtherKeys[1]!, 10) - 1;
    const code = parseInt(modifyOtherKeys[2]!, 10);
    return identifyCodeWithModifiers(code, mods);
  }

  // CSI u key without modifiers: ESC [ <code> u
  const csiUPlain = seq.match(/^\x1b\[(\d+)u$/);
  if (csiUPlain) {
    const code = parseInt(csiUPlain[1]!, 10);
    // Printable ASCII without modifiers — map back to the literal character
    // so the router's canonical-equals checks (e.g. `canonical === " "`) can
    // match against Kitty-encoded bare keys. Tab and backspace (9, 127) fall
    // through to the named-key path below.
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    return identifyCodeWithModifiers(code, 0);
  }

  // ESC + single character → alt+key
  if (seq.length === 2 && seq[0] === "\x1b") {
    const ch = seq[1]!;
    if (ch === "\x1b") return "alt+escape";
    const lower = ch.toLowerCase();
    if (lower >= "a" && lower <= "z") return `alt+${lower}`;
    const code = ch.charCodeAt(0);
    // NUL (0x00) is what most terminals emit for ctrl+@, ctrl+space, ctrl+2,
    // and ctrl+` on a US layout — they're indistinguishable in-band, so we
    // canonicalize on ctrl+@.
    if (code === 0) return "ctrl+alt+@";
    if (code === 127) return "alt+backspace";
    if (code >= 1 && code <= 26) {
      return `ctrl+alt+${String.fromCharCode(code + 0x60)}`;
    }
    if (code >= 28 && code <= 31) {
      return `ctrl+alt+${String.fromCharCode(code + 0x40)}`;
    }
    if (ch.length === 1) return `alt+${ch}`;
  }

  // Single control character → ctrl+key
  if (seq.length === 1) {
    const code = seq.charCodeAt(0);
    if (code === 0) return "ctrl+@";
    if (code === 127) return "backspace";
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 0x60)}`;
    }
    if (code >= 28 && code <= 31) {
      return `ctrl+${String.fromCharCode(code + 0x40)}`;
    }
  }

  if (seq === "\r") return "enter";

  return null;
}

function identifyCodeWithModifiers(code: number, mods: number): null | string {
  const parts: string[] = [];
  const hasCtrl = !!(mods & 4);
  const hasAlt = !!(mods & 2);
  const hasShift = !!(mods & 1);

  if (hasCtrl) parts.push("ctrl");
  if (hasAlt) parts.push("alt");
  if (hasShift) parts.push("shift");

  // Kitty functional-key high codes (caps lock, F-keys, keypad, media, etc.)
  // take precedence over the ASCII range checks below.
  const functional = FUNCTIONAL_KEY_NAMES[code];
  if (functional) {
    parts.push(functional);
    return parts.join("+");
  }

  if (code === 9) parts.push("tab");
  else if (code === 13) parts.push("enter");
  else if (code === 27) parts.push("escape");
  else if (code === 127) parts.push("backspace");
  else if (code >= 97 && code <= 122) parts.push(String.fromCharCode(code));
  else if (code >= 65 && code <= 90) {
    if (!hasShift) parts.push("shift");
    parts.push(String.fromCharCode(code + 32));
  } else if (code >= 32 && code <= 126) parts.push(String.fromCharCode(code));
  else if (code >= 1 && code <= 26) {
    if (!hasCtrl) parts.push("ctrl");
    parts.push(String.fromCharCode(code + 0x60));
  } else if (code >= 28 && code <= 31) {
    if (!hasCtrl) parts.push("ctrl");
    parts.push(String.fromCharCode(code + 0x40));
  } else {
    return null;
  }

  return parts.join("+");
}

/**
 * Compose a modifier-decorated key name like "ctrl+shift+f1".
 */
function joinModsAndKey(mods: number, key: string): string {
  const parts: string[] = [];
  if (mods & 4) parts.push("ctrl");
  if (mods & 2) parts.push("alt");
  if (mods & 1) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

// ---------------------------------------------------------------------------
// Kitty functional key codes (CSI u high-range, sent under flag 8)
// ---------------------------------------------------------------------------

/**
 * Kitty key codes for functional keys that have no legacy CSI ~ or SS3
 * encoding — sent only when "report all keys as escape codes" (flag 8) is
 * active. Modifier-only keys (57441-57454) are tracked separately in
 * MODIFIER_KEY_CODES.
 */
export const FUNCTIONAL_KEY_NAMES: Record<number, string> = {
  57358: "caps_lock",
  57359: "scroll_lock",
  57360: "num_lock",
  57361: "print_screen",
  57362: "pause",
  57363: "menu",
  57364: "f1",
  57365: "f2",
  57366: "f3",
  57367: "f4",
  57368: "f5",
  57369: "f6",
  57370: "f7",
  57371: "f8",
  57372: "f9",
  57373: "f10",
  57374: "f11",
  57375: "f12",
  57376: "f13",
  57377: "f14",
  57378: "f15",
  57379: "f16",
  57380: "f17",
  57381: "f18",
  57382: "f19",
  57383: "f20",
  57384: "f21",
  57385: "f22",
  57386: "f23",
  57387: "f24",
  57388: "f25",
  57389: "f26",
  57390: "f27",
  57391: "f28",
  57392: "f29",
  57393: "f30",
  57394: "f31",
  57395: "f32",
  57396: "f33",
  57397: "f34",
  57398: "f35",
  57399: "kp_0",
  57400: "kp_1",
  57401: "kp_2",
  57402: "kp_3",
  57403: "kp_4",
  57404: "kp_5",
  57405: "kp_6",
  57406: "kp_7",
  57407: "kp_8",
  57408: "kp_9",
  57409: "kp_decimal",
  57410: "kp_divide",
  57411: "kp_multiply",
  57412: "kp_subtract",
  57413: "kp_add",
  57414: "kp_enter",
  57415: "kp_equal",
  57416: "kp_separator",
  57417: "kp_left",
  57418: "kp_right",
  57419: "kp_up",
  57420: "kp_down",
  57421: "kp_page_up",
  57422: "kp_page_down",
  57423: "kp_home",
  57424: "kp_end",
  57425: "kp_insert",
  57426: "kp_delete",
  57427: "kp_begin",
  57428: "media_play",
  57429: "media_pause",
  57430: "media_play_pause",
  57431: "media_reverse",
  57432: "media_stop",
  57433: "media_fast_forward",
  57434: "media_rewind",
  57435: "media_track_next",
  57436: "media_track_previous",
  57437: "media_record",
  57438: "lower_volume",
  57439: "raise_volume",
  57440: "mute_volume",
};

// ---------------------------------------------------------------------------
// Modifier-only key detection (Kitty keyboard flags 2+8)
// ---------------------------------------------------------------------------

/** Kitty key codes for modifier-only keys. */
export const MODIFIER_KEY_CODES: Record<number, string> = {
  57441: "left_shift",
  57442: "left_ctrl",
  57443: "left_alt",
  57444: "left_super",
  57445: "left_hyper",
  57446: "left_meta",
  57447: "right_shift",
  57448: "right_ctrl",
  57449: "right_alt",
  57450: "right_super",
  57451: "right_hyper",
  57452: "right_meta",
  57453: "iso_level3_shift",
  57454: "iso_level5_shift",
};

/** Set of canonical modifier key names for quick membership testing. */
export const MODIFIER_KEY_NAMES = new Set(Object.values(MODIFIER_KEY_CODES));

export const ZOOM_HOLD_ACTIONS = new Set<KeyAction>(["zoomAgentsView", "zoomServerView"]);

export interface RawKeyEvent {
  code: number;
  eventType: number; // 1 = press, 2 = repeat, 3 = release, 0 = unspecified
  isModifierOnly: boolean;
  mods: number; // modifier bits (already shifted: value - 1)
  /** For CSI special keys: the final letter (A=up, B=down, C=right, D=left, H=home, F=end). */
  specialKey?: string;
}

/**
 * Format a binding value for human display.
 * The value may be a raw escape sequence ("\x07") or a canonical combo
 * string ("ctrl+g").  Raw sequences are identified first; canonical
 * strings are formatted directly.
 */
export function formatBinding(value: string): string {
  if (!value) return "";
  // Canonical modifier key name (e.g. "right_alt", "left_shift")
  if (MODIFIER_KEY_NAMES.has(value)) {
    return value.replace(/_/g, " ");
  }
  // Try parsing as a raw escape sequence
  const combo = identifyKeySequence(value);
  if (combo) return formatKeyCombo(combo);
  // Check if it's already a canonical combo (printable chars with + separators)
  if (value.includes("+") && /^[\x20-\x7e]+$/.test(value)) return formatKeyCombo(value);
  // Fallback: show hex representation for unrecognized sequences
  const hex = [...value]
    .map((c) => {
      const code = c.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : c;
    })
    .join("");
  return hex;
}

/**
 * Format a key combo string for human display.
 * "alt+a" → "alt+a", "ctrl+left" → "ctrl+lt"
 */
export function formatKeyCombo(combo: string): string {
  if (!combo) return "";
  return combo
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "escape") return "esc";
      if (lower === "down") return "dn";
      if (lower === "left") return "lt";
      if (lower === "right") return "rt";
      return lower;
    })
    .join("+");
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** Human-readable display names for modifier key codes. */
export function formatModifierKeyCode(code: number): string {
  return MODIFIER_KEY_CODES[code]?.replace("_", " ") ?? `modifier ${code}`;
}

/**
 * Parse a raw CSI u sequence into structured key event data, preserving
 * event type and recognizing modifier-only key codes.
 * Returns null for non-CSI-u sequences.
 */
export function parseRawKeyEvent(seq: string): RawKeyEvent | null {
  // CSI u with modifiers: ESC [ code (:shifted)* ; mods (:event_type)? u
  const csiU = seq.match(/^\x1b\[(\d+)(?::\d+)*;(\d+)(?::(\d+))?u$/);
  if (csiU) {
    const code = parseInt(csiU[1]!, 10);
    const mods = parseInt(csiU[2]!, 10) - 1;
    const eventType = csiU[3] ? parseInt(csiU[3], 10) : 1;
    return { code, eventType, isModifierOnly: code >= 57441 && code <= 57454, mods };
  }

  // CSI u without modifiers: ESC [ code (:event_type)? u
  const plain = seq.match(/^\x1b\[(\d+)(?::(\d+))?u$/);
  if (plain) {
    const code = parseInt(plain[1]!, 10);
    const eventType = plain[2] ? parseInt(plain[2], 10) : 1;
    return { code, eventType, isModifierOnly: code >= 57441 && code <= 57454, mods: 0 };
  }

  // CSI arrow/special with event type: ESC [ (num)? ; mods (:event_type)? ABCDHF~
  const csiSpecial = seq.match(/^\x1b\[(\d+)?;(\d+)(?::(\d+))?([ABCDHF~])$/);
  if (csiSpecial) {
    const mods = parseInt(csiSpecial[2]!, 10) - 1;
    const eventType = csiSpecial[3] ? parseInt(csiSpecial[3], 10) : 1;
    return { code: 0, eventType, isModifierOnly: false, mods, specialKey: csiSpecial[4] };
  }

  return null;
}
