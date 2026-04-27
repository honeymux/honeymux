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
  // Honeymux crashes should detach clients, not destroy the user's sessions,
  // even if a user tmux.conf enabled destroy-unattached globally.
  await sendCommand("set-option -g destroy-unattached off");
  await sendCommand("set-option destroy-unattached off");
  await sendCommand("set-option detach-on-destroy on");
  await sendCommand("set-option -g mouse on");
  await sendCommand("set-option -g pane-border-status top");
  await sendCommand(`set-option -g pane-border-format ${quoteTmuxArg("format", buildDefaultPaneBorderFormat())}`);
  await applyControlClientPaneBorderColors(sendCommand);
  await sendCommand("set-option -g window-size smallest");
  await applyControlClientCwdBindings(sendCommand);
  await setControlClientSize(sendCommand, size);
  await applyControlClientTerminalColors(sendCommand, fg);
  if (cursorStyle) {
    await sendCommand(`set-option -g cursor-style ${cursorStyle}`);
  }
}

/**
 * For each of tmux's default new-window/split-window prefix bindings, if the
 * user hasn't customized it, rebind it to inherit cwd from the active pane.
 *
 * We query the current binding first and only rewrite when the action body
 * exactly matches tmux's default — anything else (custom command, existing
 * `-c`, removed binding) is left alone so users with non-default tmux configs
 * are not surprised.
 */
export async function applyControlClientCwdBindings(sendCommand: SendCommand): Promise<void> {
  for (const { defaultAction, keyArg, keyMarker, rebind } of DEFAULT_PREFIX_BINDINGS) {
    let current = "";
    try {
      const raw = await sendCommand(`list-keys -T prefix ${keyArg}`);
      if (typeof raw === "string") current = raw.trim();
    } catch {
      // tmux refused (e.g., key not bound) — skip rebind.
      continue;
    }
    const match = keyMarker.exec(current);
    if (!match) continue;
    const action = current.slice(match.index + match[0].length).trim();
    if (action === defaultAction) {
      await sendCommand(rebind);
    }
  }
}

/**
 * tmux's three default prefix bindings that we want to upgrade to inherit
 * cwd from the active pane. `keyArg` is what we send to `list-keys`/`bind-key`
 * on the command line; `keyMarker` matches how that key appears in tmux's
 * `list-keys` output. tmux escapes some keys with a leading backslash (`\"`,
 * `\%`) and the exact behavior varies by version, so the markers tolerate an
 * optional `\`.
 */
const DEFAULT_PREFIX_BINDINGS = [
  {
    defaultAction: "new-window",
    keyArg: "c",
    keyMarker: / -T prefix c /,
    rebind: "bind-key -T prefix c new-window -c '#{pane_current_path}'",
  },
  {
    defaultAction: "split-window",
    keyArg: `'"'`,
    keyMarker: / -T prefix \\?" /,
    rebind: `bind-key -T prefix '"' split-window -c '#{pane_current_path}'`,
  },
  {
    defaultAction: "split-window -h",
    keyArg: "%",
    keyMarker: / -T prefix \\?% /,
    rebind: "bind-key -T prefix % split-window -h -c '#{pane_current_path}'",
  },
] as const;

/**
 * Push uniform pane-border styling so every tmux-drawn border char (the
 * vertical divider between panes, the horizontal divider between stacked
 * panes, and any `#[default]`-styled runs inside `pane-border-format`) paints
 * in the same color as the tab-bar brackets. Without this, tmux falls back
 * to its built-in defaults (`fg=default` for inactive borders and `fg=green`
 * for active borders) and the border reads as a patchwork of mismatched
 * colors around the theme-colored brackets.
 *
 * Applied both at bootstrap and whenever pane tabs are re-enabled; call sites
 * that live-update the theme should invoke this again to refresh tmux's view
 * of the current palette.
 */
export async function applyControlClientPaneBorderColors(sendCommand: SendCommand): Promise<void> {
  const style = `fg=${theme.textDim}`;
  await sendCommand(`set-option -g pane-border-style '${style}'`);
  await sendCommand(`set-option -g pane-active-border-style '${style}'`);
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
