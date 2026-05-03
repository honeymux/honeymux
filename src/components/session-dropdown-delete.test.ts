import { describe, expect, test } from "bun:test";

import {
  SESSION_DELETE_CONFIRM_DEFAULT_FOCUS,
  SESSION_DELETE_CONFIRM_YES,
  handleSessionDeleteConfirmInput,
} from "./session-dropdown-delete.ts";

describe("session dropdown delete confirmation", () => {
  test("defaults focus to No for destructive confirmation", () => {
    expect(SESSION_DELETE_CONFIRM_DEFAULT_FOCUS).toBe(1);
  });

  test("pressing Enter on the default focus closes instead of deleting", () => {
    expect(handleSessionDeleteConfirmInput("\r", SESSION_DELETE_CONFIRM_DEFAULT_FOCUS)).toEqual({
      action: "close",
      focused: SESSION_DELETE_CONFIRM_DEFAULT_FOCUS,
    });
  });

  test("moving focus to Yes and pressing Enter confirms deletion", () => {
    const toggled = handleSessionDeleteConfirmInput("\x1b[C", SESSION_DELETE_CONFIRM_DEFAULT_FOCUS);

    expect(toggled).toEqual({
      action: "none",
      focused: SESSION_DELETE_CONFIRM_YES,
    });
    expect(handleSessionDeleteConfirmInput("\r", toggled.focused)).toEqual({
      action: "delete",
      focused: SESSION_DELETE_CONFIRM_YES,
    });
  });
});
