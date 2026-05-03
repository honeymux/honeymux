import { mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";

import type { RemoteServerConfig } from "../remote/types.ts";
import type { Base16Palette, Base16SchemeName, ThemeMode } from "../themes/theme.ts";

import { validateSshDestination } from "../remote/ssh.ts";
import { BASE16_SCHEME_NAMES, DEFAULT_SCHEME, THEME_MODES } from "../themes/theme.ts";
import { MODIFIER_KEY_NAMES } from "./keybindings.ts";

export type CursorAlertBlink = "default" | "off" | "on";
export type CursorAlertShape = "bar" | "block" | "default" | "underline";
export type Osc52Passthrough = "all" | "off" | "write-only";
export type OtherOscPassthrough = "allow" | "off";
export type UIMode = "adaptive" | "marquee-bottom" | "marquee-top" | "raw";

export type WatermarkShape = "bear face" | "bear paw" | "honeycomb" | "off" | "unanswered count";
export const DEFAULT_LOCAL_OSC52_PASSTHROUGH: Osc52Passthrough = "write-only";
export const DEFAULT_LOCAL_OTHER_OSC_PASSTHROUGH: OtherOscPassthrough = "allow";
const OTHER_OSC_PASSTHROUGH_MODES: OtherOscPassthrough[] = ["off", "allow"];
const OSC52_PASSTHROUGH_MODES: Osc52Passthrough[] = ["off", "write-only", "all"];

/** Returns true for both "marquee-top" and "marquee-bottom". */
export function isMarqueeMode(mode: UIMode): boolean {
  return mode === "marquee-top" || mode === "marquee-bottom";
}

export const WATERMARK_SHAPES: WatermarkShape[] = ["off", "bear face", "bear paw", "honeycomb", "unanswered count"];

export interface HoneymuxConfig {
  activeWindowIdDisplayEnabled: boolean;
  agentAlertAnimConfusables: boolean;
  agentAlertAnimCycleCount: number;
  agentAlertAnimDelay: number;
  agentAlertAnimEqualizer: boolean;
  agentAlertAnimGlow: boolean;
  agentAlertAnimScribble: boolean;
  agentAlertCursorAlert: boolean;
  agentAlertCursorBlink: CursorAlertBlink;
  agentAlertCursorColor: string;
  agentAlertCursorShape: CursorAlertShape;
  agentAlertWatermark: WatermarkShape;
  /** When true, buffer zoom uses a quick fade transition (truecolor terminals only). */
  bufferZoomFade: boolean;
  /** Maximum number of scrollback lines captured by buffer zoom (0 = unlimited). */
  bufferZoomMaxLines: number;
  dimInactivePanes: boolean;
  dimInactivePanesOpacity: number;
  honeybeamsEnabled: boolean;
  ignoreMouseInput: boolean;
  metaSavedAt: number;

  muxotronEnabled: boolean;
  paneTabsEnabled: boolean;
  /** Policy for forwarding local pane-originated OSC 52 clipboard sequences to the outer terminal emulator. */
  policyLocalOsc52Passthrough: Osc52Passthrough;
  /** Policy for forwarding host-affecting non-clipboard OSC passthrough sequences from local panes. */
  policyLocalOtherOscPassthrough: OtherOscPassthrough;
  privilegedPaneDetection: boolean;
  privilegedPaneDetectionOpacity: number;
  quickTerminalSize: number;
  remote?: RemoteServerConfig[];
  screenshotDir: string;
  screenshotFlash: boolean;
  /** Maximum image height in pixels for screenshot captures. Scrollback exceeding this is refused. */
  screenshotMaxHeightPixels: number;
  themeBuiltin: Base16SchemeName;
  /** Base16 palette for the "custom" theme. Edit in config.json. */
  themeCustom?: Base16Palette;
  themeMode: ThemeMode;
  tmuxKeyBindingHints: boolean;
  /** Modifier-only alias that sends the current tmux prefix key. */
  tmuxPrefixKeyAlias: null | string;
  uiMode: UIMode;
  /** When true, zoom-agents modifier key uses tap-to-toggle instead of hold. */
  zoomAgentsViewStickyKey: boolean;
  /** When true, zoom-panes modifier key uses tap-to-toggle instead of hold. */
  zoomServerViewStickyKey: boolean;
}

const CONFIG_DIR = `${process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`}/honeymux`;
export const CONFIG_FILE = `${CONFIG_DIR}/config.json`;

/**
 * Returns null if no config file exists (first run).
 */
type LoadedHoneymuxConfig = Partial<HoneymuxConfig>;

export function defaultConfig(): HoneymuxConfig {
  return {
    activeWindowIdDisplayEnabled: false,
    agentAlertAnimConfusables: true,
    agentAlertAnimCycleCount: 1,
    agentAlertAnimDelay: 60,
    agentAlertAnimEqualizer: false,
    agentAlertAnimGlow: false,
    agentAlertAnimScribble: false,
    agentAlertCursorAlert: true,
    agentAlertCursorBlink: "default",
    agentAlertCursorColor: "#ff0000",
    agentAlertCursorShape: "default",
    agentAlertWatermark: "off",
    bufferZoomFade: true,
    bufferZoomMaxLines: 50_000,
    dimInactivePanes: false,
    dimInactivePanesOpacity: 40,
    honeybeamsEnabled: false,
    ignoreMouseInput: false,
    metaSavedAt: 0,
    muxotronEnabled: true,

    paneTabsEnabled: false,
    policyLocalOsc52Passthrough: DEFAULT_LOCAL_OSC52_PASSTHROUGH,
    policyLocalOtherOscPassthrough: DEFAULT_LOCAL_OTHER_OSC_PASSTHROUGH,
    privilegedPaneDetection: true,
    privilegedPaneDetectionOpacity: 10,
    quickTerminalSize: 90,
    remote: undefined,
    screenshotDir: "~/.local/state/honeymux/screenshots",
    screenshotFlash: true,
    screenshotMaxHeightPixels: 65535,
    themeBuiltin: DEFAULT_SCHEME,
    themeCustom: {
      base00: "#000000",
      base01: "#111111",
      base02: "#222222",
      base03: "#444444",
      base04: "#888888",
      base05: "#bbbbbb",
      base06: "#dddddd",
      base07: "#ffffff",
      base08: "#555555",
      base09: "#999999",
      base0A: "#cccccc",
      base0B: "#666666",
      base0C: "#777777",
      base0D: "#aaaaaa",
      base0E: "#eeeeee",
      base0F: "#333333",
    },
    themeMode: "built-in",
    tmuxKeyBindingHints: true,
    tmuxPrefixKeyAlias: null,
    uiMode: "adaptive",
    zoomAgentsViewStickyKey: true,
    zoomServerViewStickyKey: true,
  };
}

export function loadConfig(): HoneymuxConfig | null {
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as LoadedHoneymuxConfig;
    return mergeLoadedConfig(parsed);
  } catch {
    return null;
  }
}

export function mergeLoadedConfig(parsed: LoadedHoneymuxConfig): HoneymuxConfig {
  const defaults = defaultConfig();
  const loaded = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key in defaults),
  ) as Partial<HoneymuxConfig>;
  // Migrate legacy boolean agentAlertCursorBlink to the 3-way enum.
  const rawBlink = (loaded as { agentAlertCursorBlink?: unknown }).agentAlertCursorBlink;
  if (typeof rawBlink === "boolean") {
    loaded.agentAlertCursorBlink = rawBlink ? "on" : "off";
  }
  return {
    ...defaults,
    ...loaded,
  };
}

export async function saveConfig(config: HoneymuxConfig): Promise<void> {
  let tempFile: null | string = null;
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    tempFile = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
    await Bun.write(tempFile, serializeConfigForSave(config));
    renameSync(tempFile, CONFIG_FILE);
  } catch {
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        // best-effort
      }
    }
    // best-effort
  }
}

export function serializeConfigForSave(config: HoneymuxConfig, metaSavedAt = Date.now()): string {
  const obj = { ...config, metaSavedAt };
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted, null, 2);
}

const VALID_UI_MODES: UIMode[] = ["adaptive", "marquee-top", "marquee-bottom", "raw"];

const VALID_BUILTIN_THEMES: string[] = BASE16_SCHEME_NAMES as unknown as string[];
const VALID_THEME_MODES: ThemeMode[] = THEME_MODES;
const VALID_WATERMARKS: WatermarkShape[] = ["off", "bear face", "bear paw", "honeycomb", "unanswered count"];

/**
 * Validate a loaded config. Returns an error message or null if valid.
 */
export function validateConfig(config: HoneymuxConfig): null | string {
  if (!VALID_UI_MODES.includes(config.uiMode)) {
    return `Invalid uiMode value "${config.uiMode}" in ${CONFIG_FILE}\n  Valid values: ${VALID_UI_MODES.map((v) => `"${v}"`).join(", ")}`;
  }
  if (config.themeMode && !VALID_THEME_MODES.includes(config.themeMode)) {
    return `Invalid themeMode "${config.themeMode}" in ${CONFIG_FILE}\n  Valid values: ${VALID_THEME_MODES.map((v) => `"${v}"`).join(", ")}`;
  }
  if (config.themeBuiltin && !VALID_BUILTIN_THEMES.includes(config.themeBuiltin)) {
    return `Invalid themeBuiltin "${config.themeBuiltin}" in ${CONFIG_FILE}\n  Valid values: ${VALID_BUILTIN_THEMES.map((v) => `"${v}"`).join(", ")}`;
  }
  if (config.agentAlertWatermark && !VALID_WATERMARKS.includes(config.agentAlertWatermark)) {
    return `Invalid agentAlertWatermark "${config.agentAlertWatermark}" in ${CONFIG_FILE}\n  Valid values: ${VALID_WATERMARKS.map((v) => `"${v}"`).join(", ")}`;
  }
  if (config.tmuxPrefixKeyAlias !== null && !MODIFIER_KEY_NAMES.has(config.tmuxPrefixKeyAlias)) {
    return `Invalid tmuxPrefixKeyAlias "${config.tmuxPrefixKeyAlias}" in ${CONFIG_FILE}\n  Expected a modifier key name such as "right_shift"`;
  }
  if (!OSC52_PASSTHROUGH_MODES.includes(config.policyLocalOsc52Passthrough)) {
    return `Invalid policyLocalOsc52Passthrough "${config.policyLocalOsc52Passthrough}" in ${CONFIG_FILE}\n  Valid values: ${OSC52_PASSTHROUGH_MODES.map((v) => `"${v}"`).join(", ")}`;
  }
  if (!OTHER_OSC_PASSTHROUGH_MODES.includes(config.policyLocalOtherOscPassthrough)) {
    return `Invalid policyLocalOtherOscPassthrough "${config.policyLocalOtherOscPassthrough}" in ${CONFIG_FILE}\n  Valid values: ${OTHER_OSC_PASSTHROUGH_MODES.map((v) => `"${v}"`).join(", ")}`;
  }
  if (config.remote != null) {
    if (!Array.isArray(config.remote)) {
      return `Invalid remote value in ${CONFIG_FILE}\n  Expected an array of remote server objects`;
    }
    for (let i = 0; i < config.remote.length; i++) {
      const server = config.remote[i];
      if (!server || typeof server !== "object") {
        return `Invalid remote[${i}] entry in ${CONFIG_FILE}\n  Expected an object`;
      }
      if (typeof server.name !== "string" || server.name.trim().length === 0) {
        return `Invalid remote[${i}].name in ${CONFIG_FILE}\n  Remote server names must be non-empty strings`;
      }
      if (typeof server.host !== "string") {
        return `Invalid remote[${i}].host in ${CONFIG_FILE}\n  Remote server hosts must be strings`;
      }
      const hostError = validateSshDestination(server.host);
      if (hostError) {
        return `Invalid remote[${i}].host in ${CONFIG_FILE}\n  ${hostError}`;
      }
    }
  }
  return null;
}
