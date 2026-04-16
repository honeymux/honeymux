import { describe, expect, test } from "bun:test";

import { formatBinding, identifyKeySequence, parseRawKeyEvent } from "./keybindings.ts";

describe("identifyKeySequence", () => {
  test("formats shifted kitty CSI u letters without duplicating shift", () => {
    expect(identifyKeySequence("\x1b[65;6u")).toBe("ctrl+shift+a");
    expect(formatBinding("\x1b[65;6u")).toBe("ctrl+shift+a");
  });

  test("parses xterm modifyOtherKeys letter bindings", () => {
    expect(identifyKeySequence("\x1b[27;6;65~")).toBe("ctrl+shift+a");
    expect(formatBinding("\x1b[27;6;65~")).toBe("ctrl+shift+a");
  });

  test("parses CSI arrow with modifiers", () => {
    expect(identifyKeySequence("\x1b[1;5D")).toBe("ctrl+left");
    expect(identifyKeySequence("\x1b[1;5C")).toBe("ctrl+right");
    expect(identifyKeySequence("\x1b[1;3A")).toBe("alt+up");
    expect(identifyKeySequence("\x1b[1;2B")).toBe("shift+down");
  });

  test("parses CSI arrow with kitty event-type suffix", () => {
    expect(identifyKeySequence("\x1b[1;5:1D")).toBe("ctrl+left");
    expect(identifyKeySequence("\x1b[1;5:1C")).toBe("ctrl+right");
    expect(identifyKeySequence("\x1b[1;3:1A")).toBe("alt+up");
    expect(identifyKeySequence("\x1b[1;7:1B")).toBe("ctrl+alt+down");
  });

  test("parses CSI u with kitty event-type suffix", () => {
    expect(identifyKeySequence("\x1b[97;5:1u")).toBe("ctrl+a");
    expect(identifyKeySequence("\x1b[65;6:1u")).toBe("ctrl+shift+a");
  });
});

describe("parseRawKeyEvent", () => {
  test("parses modifier-only key (right Shift press)", () => {
    const evt = parseRawKeyEvent("\x1b[57447;2:1u");
    expect(evt).not.toBeNull();
    expect(evt!.code).toBe(57447);
    expect(evt!.isModifierOnly).toBe(true);
    expect(evt!.eventType).toBe(1);
    expect(evt!.mods).toBe(1); // shift bit
  });

  test("parses modifier-only key (right Shift release)", () => {
    const evt = parseRawKeyEvent("\x1b[57447;2:3u");
    expect(evt).not.toBeNull();
    expect(evt!.isModifierOnly).toBe(true);
    expect(evt!.eventType).toBe(3);
  });

  test("parses left Ctrl press", () => {
    const evt = parseRawKeyEvent("\x1b[57442;5:1u");
    expect(evt).not.toBeNull();
    expect(evt!.code).toBe(57442);
    expect(evt!.isModifierOnly).toBe(true);
  });

  test("parses normal key press (not modifier-only)", () => {
    const evt = parseRawKeyEvent("\x1b[97;1:1u");
    expect(evt).not.toBeNull();
    expect(evt!.code).toBe(97);
    expect(evt!.isModifierOnly).toBe(false);
    expect(evt!.eventType).toBe(1);
  });

  test("parses normal key release", () => {
    const evt = parseRawKeyEvent("\x1b[97;1:3u");
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe(3);
    expect(evt!.isModifierOnly).toBe(false);
  });

  test("parses plain CSI u without modifiers", () => {
    const evt = parseRawKeyEvent("\x1b[97u");
    expect(evt).not.toBeNull();
    expect(evt!.code).toBe(97);
    expect(evt!.mods).toBe(0);
    expect(evt!.eventType).toBe(1);
  });

  test("parses plain CSI u with event type", () => {
    const evt = parseRawKeyEvent("\x1b[97:3u");
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe(3);
  });

  test("parses CSI arrow with event type", () => {
    const evt = parseRawKeyEvent("\x1b[1;1:3A");
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe(3);
    expect(evt!.isModifierOnly).toBe(false);
  });

  test("returns null for non-CSI-u sequences", () => {
    expect(parseRawKeyEvent("a")).toBeNull();
    expect(parseRawKeyEvent("\x1b[A")).toBeNull();
    expect(parseRawKeyEvent("\x1ba")).toBeNull();
  });
});
