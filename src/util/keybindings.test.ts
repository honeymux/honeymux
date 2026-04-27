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

  test("parses kitty functional keys via CSI u", () => {
    expect(identifyKeySequence("\x1b[57358u")).toBe("caps_lock");
    expect(identifyKeySequence("\x1b[57359u")).toBe("scroll_lock");
    expect(identifyKeySequence("\x1b[57360u")).toBe("num_lock");
    expect(identifyKeySequence("\x1b[57361u")).toBe("print_screen");
    expect(identifyKeySequence("\x1b[57362u")).toBe("pause");
    expect(identifyKeySequence("\x1b[57363u")).toBe("menu");
  });

  test("parses kitty F-keys via CSI u (F1-F35)", () => {
    expect(identifyKeySequence("\x1b[57364u")).toBe("f1");
    expect(identifyKeySequence("\x1b[57375u")).toBe("f12");
    expect(identifyKeySequence("\x1b[57382u")).toBe("f19");
    expect(identifyKeySequence("\x1b[57398u")).toBe("f35");
  });

  test("parses kitty F-keys with modifiers", () => {
    expect(identifyKeySequence("\x1b[57364;5u")).toBe("ctrl+f1");
    expect(identifyKeySequence("\x1b[57375;6u")).toBe("ctrl+shift+f12");
    expect(identifyKeySequence("\x1b[57382;3u")).toBe("alt+f19");
  });

  test("parses kitty caps lock with modifiers", () => {
    expect(identifyKeySequence("\x1b[57358;5u")).toBe("ctrl+caps_lock");
    expect(identifyKeySequence("\x1b[57358;5:1u")).toBe("ctrl+caps_lock");
  });

  test("parses kitty keypad and media keys", () => {
    expect(identifyKeySequence("\x1b[57399u")).toBe("kp_0");
    expect(identifyKeySequence("\x1b[57414u")).toBe("kp_enter");
    expect(identifyKeySequence("\x1b[57427u")).toBe("kp_begin");
    expect(identifyKeySequence("\x1b[57430u")).toBe("media_play_pause");
    expect(identifyKeySequence("\x1b[57440u")).toBe("mute_volume");
  });

  test("names tab and backspace under kitty disambiguation", () => {
    expect(identifyKeySequence("\x1b[9u")).toBe("tab");
    expect(identifyKeySequence("\x1b[127u")).toBe("backspace");
    expect(identifyKeySequence("\x1b[9;5u")).toBe("ctrl+tab");
    expect(identifyKeySequence("\x1b[127;3u")).toBe("alt+backspace");
  });

  test("parses plain home and end via CSI letter", () => {
    expect(identifyKeySequence("\x1b[H")).toBe("home");
    expect(identifyKeySequence("\x1b[F")).toBe("end");
  });

  test("parses home and end with modifiers", () => {
    expect(identifyKeySequence("\x1b[1;5H")).toBe("ctrl+home");
    expect(identifyKeySequence("\x1b[1;3F")).toBe("alt+end");
  });

  test("parses SS3 F1-F4 (legacy unmodified form)", () => {
    expect(identifyKeySequence("\x1bOP")).toBe("f1");
    expect(identifyKeySequence("\x1bOQ")).toBe("f2");
    expect(identifyKeySequence("\x1bOR")).toBe("f3");
    expect(identifyKeySequence("\x1bOS")).toBe("f4");
  });

  test("parses SS3 home and end (VTE default form)", () => {
    // VTE/GNOME Terminal sends Home/End in SS3 form even with DECCKM off,
    // so binding "home" or "end" must work without Kitty keyboard support.
    expect(identifyKeySequence("\x1bOH")).toBe("home");
    expect(identifyKeySequence("\x1bOF")).toBe("end");
  });

  test("parses SS3 arrows (application cursor key mode)", () => {
    expect(identifyKeySequence("\x1bOA")).toBe("up");
    expect(identifyKeySequence("\x1bOB")).toBe("down");
    expect(identifyKeySequence("\x1bOC")).toBe("right");
    expect(identifyKeySequence("\x1bOD")).toBe("left");
  });

  test("parses legacy CSI ~ functional keys (no modifier)", () => {
    expect(identifyKeySequence("\x1b[2~")).toBe("insert");
    expect(identifyKeySequence("\x1b[3~")).toBe("delete");
    expect(identifyKeySequence("\x1b[5~")).toBe("page_up");
    expect(identifyKeySequence("\x1b[6~")).toBe("page_down");
    expect(identifyKeySequence("\x1b[15~")).toBe("f5");
    expect(identifyKeySequence("\x1b[24~")).toBe("f12");
  });

  test("parses legacy CSI ~ functional keys with modifiers", () => {
    expect(identifyKeySequence("\x1b[5;5~")).toBe("ctrl+page_up");
    expect(identifyKeySequence("\x1b[3;6~")).toBe("ctrl+shift+delete");
    expect(identifyKeySequence("\x1b[15;3~")).toBe("alt+f5");
  });

  test("does not collide with xterm modifyOtherKeys (3-arg CSI ~)", () => {
    // 3-number CSI ~ form is xterm modifyOtherKeys, must still resolve correctly.
    expect(identifyKeySequence("\x1b[27;5;65~")).toBe("ctrl+shift+a");
  });

  test("canonicalizes NUL to ctrl+@ (covers ctrl+`, ctrl+space, ctrl+2)", () => {
    // Most terminals emit NUL for ctrl+@/ctrl+space/ctrl+`/ctrl+2 on a US
    // layout — indistinguishable in-band, so we canonicalize on ctrl+@.
    expect(identifyKeySequence("\x00")).toBe("ctrl+@");
    expect(identifyKeySequence("\x1b\x00")).toBe("ctrl+alt+@");
  });

  test("canonicalizes DEL to backspace (legacy form)", () => {
    // Modern terminals send 0x7f for the Backspace key. The Kitty CSI u path
    // already named this; the legacy raw-byte path must not leak \x7f into
    // the canonical string.
    expect(identifyKeySequence("\x7f")).toBe("backspace");
    expect(identifyKeySequence("\x1b\x7f")).toBe("alt+backspace");
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

  test("treats kitty functional keys as non-modifier-only", () => {
    // Caps lock, F-keys, etc. are real key events with press/release
    // semantics; they must not be classified as ambient modifiers, or the
    // router would never fire actions bound to them.
    const caps = parseRawKeyEvent("\x1b[57358;1:1u");
    expect(caps).not.toBeNull();
    expect(caps!.code).toBe(57358);
    expect(caps!.isModifierOnly).toBe(false);

    const f19 = parseRawKeyEvent("\x1b[57382u");
    expect(f19).not.toBeNull();
    expect(f19!.isModifierOnly).toBe(false);
  });

  test("parses ISO level3/5 shift modifier-only keys", () => {
    const isoLevel3 = parseRawKeyEvent("\x1b[57453;1:1u");
    expect(isoLevel3).not.toBeNull();
    expect(isoLevel3!.code).toBe(57453);
    expect(isoLevel3!.isModifierOnly).toBe(true);

    const isoLevel5 = parseRawKeyEvent("\x1b[57454;1:3u");
    expect(isoLevel5).not.toBeNull();
    expect(isoLevel5!.isModifierOnly).toBe(true);
    expect(isoLevel5!.eventType).toBe(3);
  });
});
