import { describe, expect, mock, test } from "bun:test";

import { theme } from "../themes/theme.ts";
import {
  MIN_CONTROL_CLIENT_SIZE,
  applyControlClientBootstrap,
  buildControlClientWindowStyle,
  buildDefaultPaneBorderFormat,
  clampControlClientSize,
  setControlClientSize,
} from "./control-client-bootstrap.ts";

describe("control client bootstrap helpers", () => {
  test("builds the default pane border format from theme colors", () => {
    expect(buildDefaultPaneBorderFormat({ accent: "#123456", textBright: "#fedcba", textDim: "#abcdef" })).toBe(
      "#{?pane_active,#[fg=#123456],#[fg=#abcdef]}┤ #{pane_current_command} ├#[default]#[align=right]#{?pane_active,#{?@hmx-pane-menu-open,#[fg=#fedcba],#[fg=#abcdef]} ≡ ,───}#[default]─",
    );
  });

  test("builds the window style from the probed terminal foreground", () => {
    expect(buildControlClientWindowStyle([255, 170, 0])).toBe("fg=#ffaa00,bg=terminal");
  });

  test("applies the bootstrap command sequence using the requested size", async () => {
    const sendCommand = mock(async (cmd: string) => {
      if (cmd === "list-keys -T prefix c") return "bind-key -T prefix c new-window";
      if (cmd === `list-keys -T prefix '"'`) return String.raw`bind-key -T prefix \" split-window`;
      if (cmd === "list-keys -T prefix %") return String.raw`bind-key -T prefix \% split-window -h`;
      return "";
    });

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], "underline", { cols: 120, rows: 40 });

    const borderStyle = `fg=${theme.textDim}`;
    expect(sendCommand).toHaveBeenNthCalledWith(1, "set-option -g destroy-unattached off");
    expect(sendCommand).toHaveBeenNthCalledWith(2, "set-option destroy-unattached off");
    expect(sendCommand).toHaveBeenNthCalledWith(3, "set-option detach-on-destroy on");
    expect(sendCommand).toHaveBeenNthCalledWith(4, "set-option -g mouse on");
    expect(sendCommand).toHaveBeenNthCalledWith(5, "set-option -g pane-border-status top");
    expect(sendCommand.mock.calls[5]?.[0]).toContain("set-option -g pane-border-format ");
    expect(sendCommand).toHaveBeenNthCalledWith(7, `set-option -g pane-border-style '${borderStyle}'`);
    expect(sendCommand).toHaveBeenNthCalledWith(8, `set-option -g pane-active-border-style '${borderStyle}'`);
    expect(sendCommand).toHaveBeenNthCalledWith(9, "set-option -g window-size smallest");
    expect(sendCommand).toHaveBeenNthCalledWith(10, "list-keys -T prefix c");
    expect(sendCommand).toHaveBeenNthCalledWith(11, "bind-key -T prefix c new-window -c '#{pane_current_path}'");
    expect(sendCommand).toHaveBeenNthCalledWith(12, `list-keys -T prefix '"'`);
    expect(sendCommand).toHaveBeenNthCalledWith(13, `bind-key -T prefix '"' split-window -c '#{pane_current_path}'`);
    expect(sendCommand).toHaveBeenNthCalledWith(14, "list-keys -T prefix %");
    expect(sendCommand).toHaveBeenNthCalledWith(15, "bind-key -T prefix % split-window -h -c '#{pane_current_path}'");
    expect(sendCommand).toHaveBeenNthCalledWith(16, "refresh-client -C 120,40");
    expect(sendCommand).toHaveBeenNthCalledWith(17, "set-option -g window-style 'fg=#ffaa00,bg=terminal'");
    expect(sendCommand).toHaveBeenNthCalledWith(18, "set-option -g window-active-style 'fg=#ffaa00,bg=terminal'");
    expect(sendCommand).toHaveBeenNthCalledWith(19, "set-option -g cursor-style underline");
  });

  test("rebinds % when tmux reports it escaped as \\%", async () => {
    const sendCommand = mock(async (cmd: string) => {
      if (cmd === "list-keys -T prefix c") return "";
      if (cmd === `list-keys -T prefix '"'`) return "";
      if (cmd === "list-keys -T prefix %") return String.raw`bind-key -T prefix \% split-window -h`;
      return "";
    });

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], null, MIN_CONTROL_CLIENT_SIZE);

    const sent = sendCommand.mock.calls.map(([c]) => c);
    expect(sent).toContain("bind-key -T prefix % split-window -h -c '#{pane_current_path}'");
  });

  test("preserves user-customized prefix bindings (does not rebind for cwd)", async () => {
    const sendCommand = mock(async (cmd: string) => {
      if (cmd === "list-keys -T prefix c") return `bind-key -T prefix c new-window -c '~/projects'`;
      if (cmd === `list-keys -T prefix '"'`) return String.raw`bind-key -T prefix \" split-window`;
      if (cmd === "list-keys -T prefix %") return "";
      return "";
    });

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], null, MIN_CONTROL_CLIENT_SIZE);

    const sent = sendCommand.mock.calls.map(([c]) => c);
    expect(sent.some((c) => c.startsWith("bind-key -T prefix c "))).toBe(false);
    expect(sent).toContain(`bind-key -T prefix '"' split-window -c '#{pane_current_path}'`);
    expect(sent.some((c) => c.startsWith("bind-key -T prefix % "))).toBe(false);
  });

  test("skips the cursor-style command when the terminal style is unknown", async () => {
    const sendCommand = mock(async (_command: string) => "");

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], null, MIN_CONTROL_CLIENT_SIZE);

    expect(sendCommand.mock.calls.some(([command]) => command.includes("cursor-style"))).toBe(false);
  });

  test("clampControlClientSize enforces the minimum floor", () => {
    expect(clampControlClientSize({ cols: 10, rows: 5 })).toEqual(MIN_CONTROL_CLIENT_SIZE);
    expect(clampControlClientSize({ cols: 200, rows: 60 })).toEqual({ cols: 200, rows: 60 });
    expect(clampControlClientSize({ cols: 120.7, rows: 40.2 })).toEqual({ cols: 120, rows: 40 });
  });

  test("setControlClientSize clamps to the floor before sending refresh-client -C", async () => {
    const sendCommand = mock(async (_command: string) => "");

    await setControlClientSize(sendCommand, { cols: 10, rows: 5 });

    expect(sendCommand).toHaveBeenCalledWith(
      `refresh-client -C ${MIN_CONTROL_CLIENT_SIZE.cols},${MIN_CONTROL_CLIENT_SIZE.rows}`,
    );
  });
});
