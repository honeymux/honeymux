import { describe, expect, test } from "bun:test";

import { classifyTerminalResponse } from "./terminal-response-classifier.ts";

describe("terminal response filtering", () => {
  // --- Should be FILTERED (true) ---

  test("DECRPM responses (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[?1016;4$y")).toBe("opentui");
    expect(classifyTerminalResponse("\x1b[?2027;4$y")).toBe("opentui");
    expect(classifyTerminalResponse("\x1b[?2004;2$y")).toBe("opentui");
  });

  test("kitty keyboard response (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[?0u")).toBe("opentui");
  });

  test("cursor position report (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[1;1R")).toBe("consume");
    expect(classifyTerminalResponse("\x1b[24;80R")).toBe("consume");
  });

  test("device attributes response (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[?64;1;2;6c")).toBe("opentui");
  });

  test("window size in pixels (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[4;1152;1678t")).toBe("opentui");
  });

  test("DSR response (full CSI)", () => {
    expect(classifyTerminalResponse("\x1b[0n")).toBe("consume");
  });

  test("bare DECRPM (CSI prefix consumed by parser)", () => {
    expect(classifyTerminalResponse("1016;4$y")).toBe("consume");
    expect(classifyTerminalResponse("2027;4$y")).toBe("consume");
    expect(classifyTerminalResponse("2004;2$y")).toBe("consume");
  });

  test("bare CPR (CSI prefix consumed)", () => {
    expect(classifyTerminalResponse("1;1R")).toBe("consume");
    expect(classifyTerminalResponse("24;80R")).toBe("consume");
  });

  test("bare window size (CSI prefix consumed)", () => {
    expect(classifyTerminalResponse("4;1152;1678t")).toBe("consume");
  });

  // --- Should NOT be filtered (false) ---

  test("single letter keystrokes must pass through", () => {
    expect(classifyTerminalResponse("t")).toBe("none");
    expect(classifyTerminalResponse("n")).toBe("none");
    expect(classifyTerminalResponse("c")).toBe("none");
    expect(classifyTerminalResponse("u")).toBe("none");
    expect(classifyTerminalResponse("R")).toBe("none");
    expect(classifyTerminalResponse("a")).toBe("none");
    expect(classifyTerminalResponse("z")).toBe("none");
  });

  test("digits must pass through", () => {
    expect(classifyTerminalResponse("0")).toBe("none");
    expect(classifyTerminalResponse("1")).toBe("none");
    expect(classifyTerminalResponse("9")).toBe("none");
  });

  test("digit followed by letter must pass through", () => {
    // e.g. user types "4t" quickly and it arrives in one chunk
    expect(classifyTerminalResponse("4t")).toBe("none");
    expect(classifyTerminalResponse("0u")).toBe("none");
    expect(classifyTerminalResponse("3c")).toBe("none");
  });

  test("normal escape sequences must pass through", () => {
    expect(classifyTerminalResponse("\x1b[A")).toBe("none"); // Up arrow
    expect(classifyTerminalResponse("\x1b[B")).toBe("none"); // Down arrow
    expect(classifyTerminalResponse("\x1b[C")).toBe("none"); // Right arrow
    expect(classifyTerminalResponse("\x1b[D")).toBe("none"); // Left arrow
    expect(classifyTerminalResponse("\x1b[H")).toBe("none"); // Home
    expect(classifyTerminalResponse("\x1b[F")).toBe("none"); // End
    expect(classifyTerminalResponse("\x1b[3~")).toBe("none"); // Delete
  });

  test("ctrl keys must pass through", () => {
    expect(classifyTerminalResponse("\x02")).toBe("none"); // Ctrl-B
    expect(classifyTerminalResponse("\x03")).toBe("none"); // Ctrl-C
    expect(classifyTerminalResponse("\x01")).toBe("none"); // Ctrl-A
  });

  test("regular text must pass through", () => {
    expect(classifyTerminalResponse("hello")).toBe("none");
    expect(classifyTerminalResponse(" ")).toBe("none");
    expect(classifyTerminalResponse("\n")).toBe("none");
    expect(classifyTerminalResponse("\r")).toBe("none");
  });

  test("alt+letter must pass through", () => {
    expect(classifyTerminalResponse("\x1bn")).toBe("none");
    expect(classifyTerminalResponse("\x1bt")).toBe("none");
    expect(classifyTerminalResponse("\x1bc")).toBe("none");
  });

  test("shift+pageup/down must pass through", () => {
    expect(classifyTerminalResponse("\x1b[5;2~")).toBe("none");
    expect(classifyTerminalResponse("\x1b[6;2~")).toBe("none");
  });

  test("function keys must pass through", () => {
    expect(classifyTerminalResponse("\x1bOP")).toBe("none"); // F1
    expect(classifyTerminalResponse("\x1bOQ")).toBe("none"); // F2
    expect(classifyTerminalResponse("\x1b[15~")).toBe("none"); // F5
  });

  // --- DCS responses (should be FILTERED) ---

  test("XTVERSION response", () => {
    expect(classifyTerminalResponse("\x1bP>|iTerm2 3.6.9\x1b\\")).toBe("opentui");
    expect(classifyTerminalResponse("\x1bP>|ghostty 1.2.0\x1b\\")).toBe("opentui");
    expect(classifyTerminalResponse("\x1bP>|WezTerm 20240203-110809-5046fc22\x1b\\")).toBe("opentui");
  });

  test("XTGETTCAP response (capability found)", () => {
    expect(classifyTerminalResponse("\x1bP1+r4d73=\\E[4m\x1b\\")).toBe("opentui");
  });

  test("XTGETTCAP response (capability not found)", () => {
    expect(classifyTerminalResponse("\x1bP0+r4d73\x1b\\")).toBe("opentui");
  });

  test("DECRQSS cursor style response", () => {
    expect(classifyTerminalResponse("\x1bP1$r2 q\x1b\\")).toBe("opentui");
  });

  // --- OSC responses (should be FILTERED) ---

  test("OSC 10 foreground color response (BEL terminated)", () => {
    expect(classifyTerminalResponse("\x1b]10;rgb:cccc/cccc/cccc\x07")).toBe("opentui");
  });

  test("OSC 11 background color response (ST terminated)", () => {
    expect(classifyTerminalResponse("\x1b]11;rgb:0000/0000/0000\x1b\\")).toBe("opentui");
  });

  test("OSC 4 palette color response", () => {
    expect(classifyTerminalResponse("\x1b]4;1;rgb:cc00/0000/0000\x07")).toBe("opentui");
  });

  test("Kitty graphics APC response", () => {
    expect(classifyTerminalResponse("\x1b_Gi=31337;OK\x1b\\")).toBe("opentui");
  });

  // --- DCS/OSC that should NOT be filtered ---

  test("ESC P (incomplete DCS, no ST) must not match", () => {
    expect(classifyTerminalResponse("\x1bP")).toBe("none");
  });

  test("ESC ] (incomplete OSC, no ST) must not match", () => {
    expect(classifyTerminalResponse("\x1b]")).toBe("none");
  });
});
