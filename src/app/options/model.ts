import type { Base16SchemeName, ThemeMode } from "../../themes/theme.ts";
import type { CursorAlertShape, UIMode, WatermarkShape } from "../../util/config.ts";

import { BASE16_SCHEME_NAMES } from "../../themes/theme.ts";
import { WATERMARK_SHAPES } from "../../util/config.ts";

export type OptionsTab = "agents" | "appearance" | "general" | "input" | "misc" | "remote";

export const TAB_ORDER: OptionsTab[] = ["general", "appearance", "input", "agents", "remote", "misc"];

export const TAB_LABELS: Record<OptionsTab, string> = {
  agents: "Agent Alerts",
  appearance: "Appearance",
  general: "General",
  input: "Input",
  misc: "Misc",
  remote: "Remote",
};

export type RowKind =
  | "activeWindowIdDisplayEnabled"
  | "agentAlertAnimConfusables"
  | "agentAlertAnimCycleCount"
  | "agentAlertAnimDelay"
  | "agentAlertAnimEqualizer"
  | "agentAlertAnimGlow"
  | "agentAlertAnimScribble"
  | "agentAlertCursorAlert"
  | "agentAlertCursorBlink"
  | "agentAlertCursorColor"
  | "agentAlertCursorShape"
  | "agentAlertWatermark"
  | "bufferZoomFade"
  | "dimPanes"
  | "generalSep"
  | "honeybeamsEnabled"
  | "ignoreMouseInput"
  | "muxotronEnabled"
  | "paletteSwatch1"
  | "paletteSwatch2"
  | "paneTabsEnabled"
  | "quickTerminalSize"
  | "rootDetect"
  | "screenshotDir"
  | "screenshotFlash"
  | "themeBuiltin"
  | "themeMode"
  | "tmuxKeyBindingHints"
  | "tmuxPrefixKeyAlias"
  | "uiMode";

export const TAB_ROWS: Record<OptionsTab, RowKind[]> = {
  agents: [
    "agentAlertCursorAlert",
    "agentAlertCursorShape",
    "agentAlertCursorBlink",
    "agentAlertCursorColor",
    "generalSep",
    "agentAlertWatermark",
    "agentAlertAnimEqualizer",
    "agentAlertAnimConfusables",
    "agentAlertAnimGlow",
    "agentAlertAnimScribble",
    "generalSep",
    "agentAlertAnimDelay",
    "agentAlertAnimCycleCount",
  ],
  appearance: [
    "uiMode",
    "generalSep",
    "themeMode",
    "themeBuiltin",
    "generalSep",
    "paletteSwatch1",
    "paletteSwatch2",
    "generalSep",
    "dimPanes",
    "rootDetect",
  ],
  general: [
    "muxotronEnabled",
    "paneTabsEnabled",
    "activeWindowIdDisplayEnabled",
    "generalSep",
    "quickTerminalSize",
    "screenshotDir",
  ],
  input: ["ignoreMouseInput", "tmuxPrefixKeyAlias"],
  misc: ["bufferZoomFade", "honeybeamsEnabled", "screenshotFlash", "tmuxKeyBindingHints"],
  remote: [],
};

export const MAX_CONTENT_ROWS = 10;

export interface OptionsDialogState {
  activeWindowIdDisplayEnabled: boolean;
  agentAlertAnimConfusables: boolean;
  agentAlertAnimCycleCount: number;
  agentAlertAnimDelay: number;
  agentAlertAnimEqualizer: boolean;
  agentAlertAnimGlow: boolean;
  agentAlertAnimScribble: boolean;
  agentAlertCursorAlert: boolean;
  agentAlertCursorBlink: boolean;
  agentAlertCursorColor: string;
  agentAlertCursorShape: CursorAlertShape;
  agentAlertWatermark: WatermarkShape;
  animationCycleCountCursor: number;
  animationCycleCountEditing: boolean;
  animationCycleCountText: string;
  animationDelayCursor: number;
  animationDelayEditing: boolean;
  animationDelayText: string;
  bufferZoomFade: boolean;
  cursorColorPickerOpen: boolean;
  dimInactivePanes: boolean;
  dimInactivePanesOpacity: number;
  honeybeamsEnabled: boolean;
  ignoreMouseInput: boolean;
  multiSelectEditing: boolean;
  muxotronEnabled: boolean;
  paneTabsEnabled: boolean;
  privilegedPaneDetection: boolean;
  privilegedPaneDetectionOpacity: number;
  quickTerminalSize: number;
  remoteAdding: RemoteAddingState;
  remoteEditing: RemoteEditingState;
  remoteSelectedIndex: number;
  remoteServers: RemoteServer[];
  remoteTesting: RemoteTestingState;
  row: number;
  screenshotDir: string;
  screenshotDirCursor: number;
  screenshotDirEditing: boolean;
  screenshotFlash: boolean;
  tab: OptionsTab;
  themeBuiltin: Base16SchemeName;
  themeMode: ThemeMode;
  tmuxKeyBindingHints: boolean;
  tmuxPrefixKeyAlias: null | string;
  tmuxPrefixKeyAliasCaptureError: string;
  tmuxPrefixKeyAliasCapturing: boolean;
  uiMode: UIMode;
}
export type RemoteAddingState = { cursor: number; field: "host" | "name"; host: string; name: string } | null;
export type RemoteEditingState = { cursor: number; field: "host" | "name"; value: string } | null;
export type RemoteServer = { agentForwarding?: boolean; host: string; name: string };

export type RemoteTestingState = { index: number; message?: string; status: "error" | "success" | "testing" } | null;

const UI_MODE_OPTIONS: UIMode[] = ["adaptive", "marquee-top", "marquee-bottom", "raw"];

export function cycleBuiltinTheme(current: Base16SchemeName, direction: -1 | 1): Base16SchemeName {
  const idx = BASE16_SCHEME_NAMES.indexOf(current);
  const next = (idx + direction + BASE16_SCHEME_NAMES.length) % BASE16_SCHEME_NAMES.length;
  return BASE16_SCHEME_NAMES[next]!;
}

export function cycleUIMode(current: UIMode, direction: -1 | 1): UIMode {
  const idx = UI_MODE_OPTIONS.indexOf(current);
  const next = (idx + direction + UI_MODE_OPTIONS.length) % UI_MODE_OPTIONS.length;
  return UI_MODE_OPTIONS[next]!;
}

export function cycleWatermark(current: WatermarkShape, direction: -1 | 1): WatermarkShape {
  const idx = WATERMARK_SHAPES.indexOf(current);
  const next = (idx + direction + WATERMARK_SHAPES.length) % WATERMARK_SHAPES.length;
  return WATERMARK_SHAPES[next]!;
}

export function toggleThemeMode(current: ThemeMode): ThemeMode {
  return current === "custom" ? "built-in" : "custom";
}

const CURSOR_ALERT_SHAPES: CursorAlertShape[] = ["block", "bar", "underline"];

export function cycleCursorShape(current: CursorAlertShape, direction: -1 | 1): CursorAlertShape {
  const idx = CURSOR_ALERT_SHAPES.indexOf(current);
  const next = (idx + direction + CURSOR_ALERT_SHAPES.length) % CURSOR_ALERT_SHAPES.length;
  return CURSOR_ALERT_SHAPES[next]!;
}

export const ROOT_TINT_MIN = 1;
export const ROOT_TINT_MAX = 15;
export const ROOT_TINT_STEP = 1;

export function cycleRootTintOpacity(current: number, direction: -1 | 1): number {
  const next = current + direction * ROOT_TINT_STEP;
  if (next > ROOT_TINT_MAX) return ROOT_TINT_MIN;
  if (next < ROOT_TINT_MIN) return ROOT_TINT_MAX;
  return next;
}

export const DIM_OPACITY_MIN = 10;
export const DIM_OPACITY_MAX = 80;
export const DIM_OPACITY_STEP = 5;

export function cycleDimOpacity(current: number, direction: -1 | 1): number {
  const next = current + direction * DIM_OPACITY_STEP;
  if (next > DIM_OPACITY_MAX) return DIM_OPACITY_MIN;
  if (next < DIM_OPACITY_MIN) return DIM_OPACITY_MAX;
  return next;
}

const QUICK_SIZE_MIN = 20;
const QUICK_SIZE_MAX = 100;
const QUICK_SIZE_STEP = 5;

export function cycleQuickSize(current: number, direction: -1 | 1): number {
  const next = current + direction * QUICK_SIZE_STEP;
  if (next > QUICK_SIZE_MAX) return QUICK_SIZE_MIN;
  if (next < QUICK_SIZE_MIN) return QUICK_SIZE_MAX;
  return next;
}

export const NON_NAV_KINDS: ReadonlySet<string> = new Set(["generalSep", "paletteSwatch1", "paletteSwatch2"]);

/** Row kinds where left/right arrows edit a value (requires Enter to activate). */
export const ARROW_EDITABLE_KINDS: ReadonlySet<string> = new Set([
  "agentAlertCursorShape",
  "agentAlertWatermark",
  "dimPanes",
  "quickTerminalSize",
  "rootDetect",
  "themeBuiltin",
  "themeMode",
  "uiMode",
]);

export const AGENTS_LEFT_HEADER = "Continuous";
export const AGENTS_RIGHT_HEADER = "Intermittent";
export const AGENTS_SPLIT_START = 0;
export const AGENTS_LEFT_COUNT = 6;

export const INPUT_LEFT_HEADER = "Mouse";
export const INPUT_RIGHT_HEADER = "Keyboard";
export const INPUT_SPLIT_START = 0;
export const INPUT_LEFT_COUNT = 1;

export const OPTION_HELP: Partial<Record<RowKind, string>> = {
  activeWindowIdDisplayEnabled: "Example: @0",
  agentAlertAnimConfusables: "Uses homoglyphs to create an animated effect when an agent needs attention",
  agentAlertAnimCycleCount: "Number of animation cycles to play before each delay",
  agentAlertAnimDelay: "Seconds between intermittent animation bursts; 0 == continuous",
  agentAlertAnimEqualizer: "Right away Michael",
  agentAlertAnimGlow: "Pulsing glow when an agent needs attention",
  agentAlertAnimScribble: "Line scribble effect when an agent needs attention",
  agentAlertCursorAlert: "Change cursor shape and color when an agent needs attention",
  agentAlertCursorBlink: "Blink cursor when an agent needs attention (may not be supported by some terminal emulators)",
  agentAlertCursorColor: "Set custom cursor color when an agent needs attention",
  agentAlertCursorShape: "Set cursor shape when an agent needs attention",
  agentAlertWatermark: "Background watermark shape displayed in the terminal when an agent needs attention",
  bufferZoomFade: "Quick fade transition when entering buffer zoom (truecolor terminals only)",
  dimPanes: "Dim unfocused panes; press ↵ then ← / → to adjust dimming intensity (10-80%)",
  honeybeamsEnabled: "Animated border-drawing effect when creating new pane split",
  ignoreMouseInput: "Disable all mouse input, forcing all navigation via assigned keyboard shortcuts only",
  muxotronEnabled: "Always-visible panel for monitoring coding agent activity and system-level information",
  paneTabsEnabled: "Allow each pane to hold multiple tabs that share the same tmux layout slot",
  quickTerminalSize: "Height of quick terminal pop-up dialog as a percentage of terminal height",
  rootDetect: "Privileged pane detection; press ↵ then ← / → to adjust red tint opacity (1-15%)",
  screenshotDir: "Directory for pane screenshot; clear to revert to default",
  screenshotFlash: "Brief visual flash on a pane when capturing a screenshot",
  themeBuiltin: "Built-in theme",
  themeMode: "Toggle between a built-in theme or a custom palette defined in config.json",
  tmuxKeyBindingHints: "Briefly show tmux key binding hints when associated UI elements activated",
  tmuxPrefixKeyAlias: "Map a single-press modifier key to send the current tmux prefix key",
  uiMode: "",
};
