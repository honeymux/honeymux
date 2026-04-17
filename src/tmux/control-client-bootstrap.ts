import type { TmuxCursorStyle } from "../util/cursor.ts";

import { type RGB, theme } from "../themes/theme.ts";
import { quoteTmuxArg } from "./escape.ts";

export interface ControlClientSize {
  cols: number;
  rows: number;
}

interface SendCommand {
  (command: string): Promise<unknown>;
}

/**
 * Minimum control-client dimensions. Used when the caller can't supply real
 * terminal dimensions yet, and as a floor on every subsequent resize so we
 * never ask tmux to reshape below a usable pane size.
 */
export const MIN_CONTROL_CLIENT_SIZE: ControlClientSize = { cols: 80, rows: 24 };

export async function applyControlClientBootstrap(
  sendCommand: SendCommand,
  fg: RGB,
  cursorStyle: TmuxCursorStyle | null,
  size: ControlClientSize,
): Promise<void> {
  await sendCommand("set-option detach-on-destroy on");
  await sendCommand("set-option -g mouse on");
  await sendCommand("set-option -g pane-border-status top");
  await sendCommand(`set-option -g pane-border-format ${quoteTmuxArg("format", buildDefaultPaneBorderFormat())}`);
  await sendCommand("set-option -g window-size smallest");
  await setControlClientSize(sendCommand, size);
  await applyControlClientTerminalColors(sendCommand, fg);
  if (cursorStyle) {
    await sendCommand(`set-option -g cursor-style ${cursorStyle}`);
  }
}

export async function applyControlClientTerminalColors(sendCommand: SendCommand, fg: RGB): Promise<void> {
  const style = buildControlClientWindowStyle(fg);
  await sendCommand(`set-option -g window-style '${style}'`);
  await sendCommand(`set-option -g window-active-style '${style}'`);
}

export function buildControlClientWindowStyle(fg: RGB): string {
  const fgHex = `#${fg.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return `fg=${fgHex},bg=terminal`;
}

export function buildDefaultPaneBorderFormat(colors: { accent: string; textDim: string } = theme): string {
  return `#{?pane_active,#[fg=${colors.accent}],#[fg=${colors.textDim}]}┤ #{pane_current_command} ├#[default]#[align=right]#{?pane_active,#[fg=${colors.textDim}] ≡ ,───}#[default]─`;
}

/**
 * Clamp a requested control-client size to {@link MIN_CONTROL_CLIENT_SIZE}.
 * `refresh-client -C` below the floor would cause tmux to reshape panes to
 * a near-useless size whenever the control client is briefly the smallest
 * attached client (e.g. during startup or transient detach).
 */
export function clampControlClientSize(size: ControlClientSize): ControlClientSize {
  return {
    cols: Math.max(MIN_CONTROL_CLIENT_SIZE.cols, Math.floor(size.cols)),
    rows: Math.max(MIN_CONTROL_CLIENT_SIZE.rows, Math.floor(size.rows)),
  };
}

export async function setControlClientSize(sendCommand: SendCommand, size: ControlClientSize): Promise<void> {
  const { cols, rows } = clampControlClientSize(size);
  await sendCommand(`refresh-client -C ${cols},${rows}`);
}
