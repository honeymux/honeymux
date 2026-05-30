import { describe, expect, test } from "bun:test";

import { resolveInputOwner } from "./input-owner.ts";

const baseState = {
  dialogCapturing: false,
  dialogOpen: false,
  dropdownOpen: false,
  mobileMode: false,
  quickTerminalOpen: false,
  reviewLatched: false,
  sidebarFocused: false,
  textInputActive: false,
  toolbarFocused: false,
};

describe("resolveInputOwner", () => {
  test("quick terminal owns input when open with nothing above it", () => {
    expect(resolveInputOwner({ ...baseState, quickTerminalOpen: true })).toBe("quickTerminal");
  });

  test("a dialog opened above the quick terminal takes ownership", () => {
    expect(resolveInputOwner({ ...baseState, dialogOpen: true, quickTerminalOpen: true })).toBe("dialog");
  });

  test("a capturing dialog above the quick terminal takes ownership", () => {
    expect(resolveInputOwner({ ...baseState, dialogCapturing: true, dialogOpen: true, quickTerminalOpen: true })).toBe(
      "dialogCapture",
    );
  });

  test("text input above the quick terminal takes ownership", () => {
    expect(resolveInputOwner({ ...baseState, quickTerminalOpen: true, textInputActive: true })).toBe("textInput");
  });

  test("quick terminal still outranks dropdown / toolbar / sidebar", () => {
    expect(
      resolveInputOwner({
        ...baseState,
        dropdownOpen: true,
        quickTerminalOpen: true,
        sidebarFocused: true,
        toolbarFocused: true,
      }),
    ).toBe("quickTerminal");
  });
});
