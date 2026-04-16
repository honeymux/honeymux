import { describe, expect, test } from "bun:test";

import type { TmuxKeyBindings } from "../../tmux/types.ts";

import {
  getTmuxSplitSequences,
  resolveHoneybeamDirection,
  shouldMarkPermissionPromptAnswered,
} from "./use-pty-write-pipeline.ts";

const KEY_BINDINGS: TmuxKeyBindings = {
  closePane: "ctrl-b + x",
  detach: "ctrl-b + d",
  killWindow: "ctrl-b + &",
  newWindow: "ctrl-b + c",
  prefix: "ctrl-b",
  selectWindow: [],
  splitHorizontal: 'ctrl-b + "',
  splitVertical: "ctrl-b + %",
};

describe("pty write pipeline helpers", () => {
  test("derives tmux prefix and split sequences", () => {
    expect(getTmuxSplitSequences(null)).toEqual({
      horizontalSplitSequence: null,
      prefixSequence: null,
      verticalSplitSequence: null,
    });
    expect(getTmuxSplitSequences(KEY_BINDINGS)).toEqual({
      horizontalSplitSequence: '"',
      prefixSequence: "\u0002",
      verticalSplitSequence: "%",
    });
  });

  test("detects the honeybeam split direction from the post-prefix key", () => {
    expect(resolveHoneybeamDirection("%", "%", '"')).toBe("vertical");
    expect(resolveHoneybeamDirection('"', "%", '"')).toBe("horizontal");
    expect(resolveHoneybeamDirection("x", "%", '"')).toBeNull();
  });

  test("marks enter and bare escape as permission-prompt answers", () => {
    expect(shouldMarkPermissionPromptAnswered("\r")).toBe(true);
    expect(shouldMarkPermissionPromptAnswered("\x1b")).toBe(true);
    expect(shouldMarkPermissionPromptAnswered("x")).toBe(false);
  });
});
