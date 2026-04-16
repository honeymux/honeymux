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

const ARROW_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
};

/**
 * Identify a raw terminal escape sequence and return its human-readable
 * key combo string (e.g. "\x1ba" → "alt+a", "\x07" → "ctrl+g").
 * Used only for display — never on the matching hot path.
 * Returns null for unrecognizable sequences.
 */
export function identifyKeySequence(seq: string): null | string {
  if (!seq) return null;

  // CSI arrow with modifiers: ESC [ 1 ; <mod> <dir>  or  ESC [ <mod> <dir>
  // Kitty keyboard may append :<event-type> after the modifier (e.g. 5:1 for ctrl+press).
  // Modifier value is (flags + 1), so subtract 1 before checking bits.
  const csiArrow = seq.match(/^\x1b\[(?:1;)?(\d+)(?::\d+)?([ABCD])$/);
  if (csiArrow) {
    const mods = parseInt(csiArrow[1]!, 10) - 1;
    const dir = ARROW_NAMES[csiArrow[2]!];
    if (!dir) return null;
    const parts: string[] = [];
    if (mods & 4) parts.push("ctrl");
    if (mods & 2) parts.push("alt");
    if (mods & 1) parts.push("shift");
    parts.push(dir);
    return parts.join("+");
  }

  // Plain arrow (no modifier): ESC [ <dir>
  const plainArrow = seq.match(/^\x1b\[([ABCD])$/);
  if (plainArrow) {
    const dir = ARROW_NAMES[plainArrow[1]!];
    if (dir) return dir;
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
    if (code === 13) return "enter";
    if (code === 27) return "escape";
    // Printable ASCII without modifiers — map back to the literal character
    // so the router's canonical-equals checks (e.g. `canonical === " "`) can
    // match against Kitty-encoded bare keys.
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    return null;
  }

  // ESC + single character → alt+key
  if (seq.length === 2 && seq[0] === "\x1b") {
    const ch = seq[1]!;
    if (ch === "\x1b") return "alt+escape";
    const lower = ch.toLowerCase();
    if (lower >= "a" && lower <= "z") return `alt+${lower}`;
    const code = ch.charCodeAt(0);
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

  if (code === 13) parts.push("enter");
  else if (code === 27) parts.push("escape");
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
    return { code, eventType, isModifierOnly: code >= 57441 && code <= 57452, mods };
  }

  // CSI u without modifiers: ESC [ code (:event_type)? u
  const plain = seq.match(/^\x1b\[(\d+)(?::(\d+))?u$/);
  if (plain) {
    const code = parseInt(plain[1]!, 10);
    const eventType = plain[2] ? parseInt(plain[2], 10) : 1;
    return { code, eventType, isModifierOnly: code >= 57441 && code <= 57452, mods: 0 };
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
