import { describe, expect, mock, test } from "bun:test";

import {
  CONTROL_CLIENT_SIZE,
  applyControlClientBootstrap,
  buildControlClientWindowStyle,
  buildDefaultPaneBorderFormat,
} from "./control-client-bootstrap.ts";

describe("control client bootstrap helpers", () => {
  test("builds the default pane border format from theme colors", () => {
    expect(buildDefaultPaneBorderFormat({ accent: "#123456", textDim: "#abcdef" })).toBe(
      "#{?pane_active,#[fg=#123456],#[fg=#abcdef]}┤ #{pane_current_command} ├#[default]#[align=right]#{?pane_active,#[fg=#abcdef] ≡ ,───}#[default]─",
    );
  });

  test("builds the window style from the probed terminal foreground", () => {
    expect(buildControlClientWindowStyle([255, 170, 0])).toBe("fg=#ffaa00,bg=terminal");
  });

  test("applies the bootstrap command sequence and optional cursor style", async () => {
    const sendCommand = mock(async (_command: string) => "");

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], "underline");

    expect(sendCommand).toHaveBeenNthCalledWith(1, "set-option detach-on-destroy on");
    expect(sendCommand).toHaveBeenNthCalledWith(2, "set-option -g mouse on");
    expect(sendCommand).toHaveBeenNthCalledWith(3, "set-option -g pane-border-status top");
    expect(sendCommand.mock.calls[3]?.[0]).toContain("set-option -g pane-border-format ");
    expect(sendCommand).toHaveBeenNthCalledWith(5, "set-option -g window-size smallest");
    expect(sendCommand).toHaveBeenNthCalledWith(
      6,
      `refresh-client -C ${CONTROL_CLIENT_SIZE.cols},${CONTROL_CLIENT_SIZE.rows}`,
    );
    expect(sendCommand).toHaveBeenNthCalledWith(7, "set-option -g window-style 'fg=#ffaa00,bg=terminal'");
    expect(sendCommand).toHaveBeenNthCalledWith(8, "set-option -g window-active-style 'fg=#ffaa00,bg=terminal'");
    expect(sendCommand).toHaveBeenNthCalledWith(9, "set-option -g cursor-style underline");
  });

  test("skips the cursor-style command when the terminal style is unknown", async () => {
    const sendCommand = mock(async (_command: string) => "");

    await applyControlClientBootstrap(sendCommand, [255, 170, 0], null);

    expect(sendCommand.mock.calls.some(([command]) => command.includes("cursor-style"))).toBe(false);
  });
});
