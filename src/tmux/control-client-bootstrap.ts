import type { TmuxCursorStyle } from "../util/cursor.ts";

import { type RGB, theme } from "../themes/theme.ts";
import { quoteTmuxArg } from "./escape.ts";

interface SendCommand {
  (command: string): Promise<unknown>;
}

export const CONTROL_CLIENT_SIZE = { cols: 300, rows: 300 } as const;

export async function applyControlClientBootstrap(
  sendCommand: SendCommand,
  fg: RGB,
  cursorStyle: TmuxCursorStyle | null,
): Promise<void> {
  await sendCommand("set-option detach-on-destroy on");
  await sendCommand("set-option -g mouse on");
  await sendCommand("set-option -g pane-border-status top");
  await sendCommand(`set-option -g pane-border-format ${quoteTmuxArg("format", buildDefaultPaneBorderFormat())}`);
  await sendCommand("set-option -g window-size smallest");
  await setLargeControlClientSize(sendCommand);
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

export async function setLargeControlClientSize(sendCommand: SendCommand): Promise<void> {
  await sendCommand(`refresh-client -C ${CONTROL_CLIENT_SIZE.cols},${CONTROL_CLIENT_SIZE.rows}`);
}
