import { describe, expect, test } from "bun:test";

import { reEncodeChunk, reEncodeCsiU, splitSequences } from "./csiu-reencode.ts";

const csiU = (code: number, suffix = "u") => `\x1b[${code}${suffix}`;
const codePoint = (text: string) => text.codePointAt(0)!;
const keyReleaseWithPhysicalAlternate = (text: string, physicalKey: string) =>
  csiU(codePoint(text), `::${codePoint(physicalKey)};1:3u`);
const keyWithAssociatedText = (text: string) => csiU(0, `;;${[...text].map((ch) => codePoint(ch)).join(":")}u`);
const keyWithAssociatedTextAndPhysicalKey = (text: string, physicalKey: string, modifier = 1) =>
  csiU(codePoint(text), `::${codePoint(physicalKey)};${modifier};${codePoint(text)}u`);
const keyWithAssociatedTextForKey = (keyCode: number, text: string, modifier = 1) =>
  csiU(keyCode, `;${modifier};${[...text].map((ch) => codePoint(ch)).join(":")}u`);
const keyWithPhysicalAlternate = (text: string, physicalKey: string) =>
  csiU(codePoint(text), `::${codePoint(physicalKey)}u`);

describe("reEncodeCsiU", () => {
  // --- Printable ASCII ---
  test("plain 'a' press → 'a'", () => {
    expect(reEncodeCsiU("\x1b[97;1:1u")).toBe("a");
  });

  test("plain 'a' without event type → 'a'", () => {
    expect(reEncodeCsiU("\x1b[97;1u")).toBe("a");
  });

  test("plain 'a' release → null (dropped)", () => {
    expect(reEncodeCsiU("\x1b[97;1:3u")).toBe(null);
  });

  test("space press → ' '", () => {
    expect(reEncodeCsiU("\x1b[32;1:1u")).toBe(" ");
  });

  // --- Unicode text input ---
  test("Korean syllable press → UTF-8 text", () => {
    expect(reEncodeCsiU("\x1b[54620;1:1u")).toBe("한");
  });

  test("emoji press → UTF-8 text", () => {
    expect(reEncodeCsiU("\x1b[128578;1:1u")).toBe("🙂");
  });

  test("shifted Cyrillic key uses alternate shifted code", () => {
    expect(reEncodeCsiU("\x1b[1072:1040;2:1u")).toBe("А");
  });

  test("release with empty shifted alternate key is dropped", () => {
    expect(reEncodeCsiU(keyReleaseWithPhysicalAlternate("α", "a"))).toBe(null);
  });

  test("unmodified non-ASCII key with physical alternate stays UTF-8 text", () => {
    expect(reEncodeCsiU(keyWithPhysicalAlternate("ф", "a"))).toBe("ф");
  });

  test("associated text payload is forwarded as UTF-8 text", () => {
    expect(reEncodeCsiU(keyWithAssociatedText("å"))).toBe("å");
  });

  test("associated text with Enter forwards committed text then Enter", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextForKey(13, "文"))).toBe("文\r");
  });

  test("associated text with Backspace forwards committed text then Backspace", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextForKey(127, "文"))).toBe("文\x7f");
  });

  test("associated text with arrow forwards committed text then arrow", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextForKey(57418, "文"))).toBe("文\x1b[C");
  });

  test("Ctrl+letter with associated text forwards control character", () => {
    expect(reEncodeCsiU("\x1b[108;5;108u")).toBe("\x0c");
  });

  test("Ctrl+letter under non-Latin input method uses physical alternate", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextAndPhysicalKey("λ", "l", 5))).toBe("\x0c");
    expect(reEncodeCsiU("\x1b[955::108;5:1u")).toBe("\x0c");
  });

  test("Alt+letter under non-Latin input method uses physical alternate", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextAndPhysicalKey("λ", "l", 3))).toBe("\x1bl");
    expect(reEncodeCsiU("\x1b[955::108;3:1u")).toBe("\x1bl");
  });

  test("Ctrl+Alt+letter under non-Latin input method uses physical alternate", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextAndPhysicalKey("λ", "l", 7))).toBe("\x1b\x0c");
  });

  test("Shift-only non-Latin input method still preserves text", () => {
    expect(reEncodeCsiU(keyWithAssociatedTextAndPhysicalKey("λ", "l", 2))).toBe("λ");
  });

  test("Kitty F13 PUA code stays in CSI u form", () => {
    expect(reEncodeCsiU("\x1b[57376;1:1u")).toBe("\x1b[57376u");
  });

  test("Ctrl-modified Korean text stays in CSI u form", () => {
    expect(reEncodeCsiU("\x1b[54620;5:1u")).toBe("\x1b[54620;5u");
  });

  // --- Printable ASCII with modifiers ---
  test("Shift+a → 'A'", () => {
    expect(reEncodeCsiU("\x1b[97;2:1u")).toBe("A");
  });

  // --- Shifted non-letter keys via alternate key codes (flag 4) ---
  // Format: ESC [ base_code : shifted_code ; mods : event_type u
  test("Shift+; → ':' (colon) via alternate key", () => {
    // base=59(;), shifted=58(:), mods=2(shift), event=1(press)
    expect(reEncodeCsiU("\x1b[59:58;2:1u")).toBe(":");
  });

  test("Shift+' → '\"' via alternate key", () => {
    expect(reEncodeCsiU("\x1b[39:34;2:1u")).toBe('"');
  });

  test("Shift+1 → '!' via alternate key", () => {
    expect(reEncodeCsiU("\x1b[49:33;2:1u")).toBe("!");
  });

  test("Shift+; without alternate key → ';' (fallback)", () => {
    // Without flag 4, no shifted code — falls back to base key
    expect(reEncodeCsiU("\x1b[59;2:1u")).toBe(";");
  });

  test("'1' press → '1'", () => {
    expect(reEncodeCsiU("\x1b[49;1:1u")).toBe("1");
  });

  // --- Control characters ---
  test("Ctrl+a → 0x01", () => {
    expect(reEncodeCsiU("\x1b[97;5:1u")).toBe("\x01");
  });

  test("Ctrl+c → 0x03", () => {
    expect(reEncodeCsiU("\x1b[99;5:1u")).toBe("\x03");
  });

  test("Ctrl+z → 0x1a", () => {
    expect(reEncodeCsiU("\x1b[122;5:1u")).toBe("\x1a");
  });

  test("Alt+a → ESC a", () => {
    expect(reEncodeCsiU("\x1b[97;3:1u")).toBe("\x1ba");
  });

  test("Ctrl+Alt+a → ESC 0x01", () => {
    expect(reEncodeCsiU("\x1b[97;7:1u")).toBe("\x1b\x01");
  });

  // --- Special keys ---
  test("Enter → \\r", () => {
    expect(reEncodeCsiU("\x1b[13;1:1u")).toBe("\r");
  });

  test("Tab → \\t", () => {
    expect(reEncodeCsiU("\x1b[9;1:1u")).toBe("\t");
  });

  test("Shift+Tab → CSI Z", () => {
    expect(reEncodeCsiU("\x1b[9;2:1u")).toBe("\x1b[Z");
  });

  test("Backspace → 0x7f", () => {
    expect(reEncodeCsiU("\x1b[127;1:1u")).toBe("\x7f");
  });

  test("Escape → 0x1b", () => {
    expect(reEncodeCsiU("\x1b[27;1:1u")).toBe("\x1b");
  });

  // --- Arrow keys (CSI u format) ---
  test("Up arrow → CSI A", () => {
    expect(reEncodeCsiU("\x1b[57416;1:1u")).toBe("\x1b[A");
  });

  test("Down arrow → CSI B", () => {
    expect(reEncodeCsiU("\x1b[57417;1:1u")).toBe("\x1b[B");
  });

  test("Ctrl+Up → CSI 1;5 A", () => {
    expect(reEncodeCsiU("\x1b[57416;5:1u")).toBe("\x1b[1;5A");
  });

  // --- Arrow keys (CSI letter format with event type) ---
  test("Up arrow CSI format release → null", () => {
    expect(reEncodeCsiU("\x1b[1;1:3A")).toBe(null);
  });

  test("Up arrow CSI format press → bare legacy form", () => {
    expect(reEncodeCsiU("\x1b[1;1:1A")).toBe("\x1b[A");
  });

  // --- Navigation keys ---
  test("Home → CSI H", () => {
    expect(reEncodeCsiU("\x1b[57420;1:1u")).toBe("\x1b[H");
  });

  test("End → CSI F", () => {
    expect(reEncodeCsiU("\x1b[57421;1:1u")).toBe("\x1b[F");
  });

  test("Page Up → CSI 5~", () => {
    expect(reEncodeCsiU("\x1b[57422;1:1u")).toBe("\x1b[5~");
  });

  test("Delete → CSI 3~", () => {
    expect(reEncodeCsiU("\x1b[57425;1:1u")).toBe("\x1b[3~");
  });

  test("Ctrl+Delete → CSI 3;5~", () => {
    expect(reEncodeCsiU("\x1b[57425;5:1u")).toBe("\x1b[3;5~");
  });

  // --- F-keys ---
  test("F1 → ESC OP", () => {
    expect(reEncodeCsiU("\x1b[57364;1:1u")).toBe("\x1bOP");
  });

  test("F5 → CSI 15~", () => {
    expect(reEncodeCsiU("\x1b[57368;1:1u")).toBe("\x1b[15~");
  });

  test("Ctrl+F1 → CSI 1;5P", () => {
    expect(reEncodeCsiU("\x1b[57364;5:1u")).toBe("\x1b[1;5P");
  });

  // --- Modifier-only keys (dropped) ---
  test("Right Shift press → null", () => {
    expect(reEncodeCsiU("\x1b[57447;2:1u")).toBe(null);
  });

  test("Right Shift release → null", () => {
    expect(reEncodeCsiU("\x1b[57447;2:3u")).toBe(null);
  });

  test("Left Ctrl press → null", () => {
    expect(reEncodeCsiU("\x1b[57442;5:1u")).toBe(null);
  });

  // --- Plain CSI u (no modifiers) ---
  test("plain CSI u 'a' → 'a'", () => {
    expect(reEncodeCsiU("\x1b[97u")).toBe("a");
  });

  test("plain CSI u Enter → \\r", () => {
    expect(reEncodeCsiU("\x1b[13u")).toBe("\r");
  });

  test("plain CSI u with release event type → null", () => {
    expect(reEncodeCsiU("\x1b[97:3u")).toBe(null);
  });

  // --- Non-CSI-u passthrough ---
  test("plain byte passes through", () => {
    expect(reEncodeCsiU("a")).toBe("a");
  });

  test("legacy escape sequence passes through", () => {
    expect(reEncodeCsiU("\x1b[A")).toBe("\x1b[A");
  });
});

describe("splitSequences", () => {
  test("single plain byte", () => {
    expect(splitSequences("a")).toEqual(["a"]);
  });

  test("multiple plain bytes", () => {
    expect(splitSequences("abc")).toEqual(["a", "b", "c"]);
  });

  test("single CSI u sequence", () => {
    expect(splitSequences("\x1b[97;1:1u")).toEqual(["\x1b[97;1:1u"]);
  });

  test("two CSI u sequences (press + release)", () => {
    expect(splitSequences("\x1b[97;1:1u\x1b[97;1:3u")).toEqual(["\x1b[97;1:1u", "\x1b[97;1:3u"]);
  });

  test("CSI arrow sequence", () => {
    expect(splitSequences("\x1b[1;1:1A")).toEqual(["\x1b[1;1:1A"]);
  });

  test("mixed CSI and plain", () => {
    expect(splitSequences("x\x1b[97;1:1uy")).toEqual(["x", "\x1b[97;1:1u", "y"]);
  });

  test("ESC + char (alt+key)", () => {
    expect(splitSequences("\x1ba")).toEqual(["\x1ba"]);
  });
});

describe("reEncodeChunk", () => {
  test("press+release chunk → only press forwarded", () => {
    expect(reEncodeChunk("\x1b[97;1:1u\x1b[97;1:3u")).toBe("a");
  });

  test("multiple keypresses in one chunk", () => {
    expect(reEncodeChunk("\x1b[97;1:1u\x1b[97;1:3u\x1b[98;1:1u\x1b[98;1:3u")).toBe("ab");
  });

  test("multi-codepoint emoji in one chunk", () => {
    expect(reEncodeChunk("\x1b[10084;1:1u\x1b[65039;1:1u")).toBe("❤️");
  });

  test("Japanese IME commit in one chunk", () => {
    expect(reEncodeChunk("\x1b[26085;1:1u\x1b[26412;1:1u\x1b[35486;1:1u")).toBe("日本語");
  });

  test("ZWJ emoji sequence in one chunk", () => {
    expect(
      reEncodeChunk(
        "\x1b[128104;1:1u\x1b[8205;1:1u\x1b[128105;1:1u\x1b[8205;1:1u\x1b[128103;1:1u\x1b[8205;1:1u\x1b[128102;1:1u",
      ),
    ).toBe("👨‍👩‍👧‍👦");
  });

  test("modifier-only keys in chunk → empty string", () => {
    expect(reEncodeChunk("\x1b[57447;2:1u\x1b[57447;2:3u")).toBe("");
  });

  test("release chunk with empty shifted alternate keys is dropped", () => {
    expect(
      reEncodeChunk(
        [
          keyReleaseWithPhysicalAlternate("α", "a"),
          keyReleaseWithPhysicalAlternate("β", "b"),
          keyReleaseWithPhysicalAlternate("γ", "g"),
        ].join(""),
      ),
    ).toBe("");
  });

  test("keeps alternate-key Unicode input when no associated text is reported", () => {
    expect(
      reEncodeChunk([keyWithPhysicalAlternate("α", "a"), keyWithPhysicalAlternate("β", "b"), "文!"].join("")),
    ).toBe("αβ文!");
  });

  test("keeps alternate-key Unicode input before associated text", () => {
    expect(
      reEncodeChunk(
        [keyWithPhysicalAlternate("α", "a"), keyWithPhysicalAlternate("β", "b"), keyWithAssociatedText("文")].join(""),
      ),
    ).toBe("αβ文");
  });

  test("plain bytes pass through", () => {
    expect(reEncodeChunk("abc")).toBe("abc");
  });
});

describe("reEncodeCsiU extended-csi-u mode", () => {
  // Unmodified keys should match legacy mode exactly — tmux receives
  // plain literals just like a Kitty terminal in disambiguate-only mode.
  test("plain 'a' → 'a' (no CSI-u escalation)", () => {
    expect(reEncodeCsiU("\x1b[97;1:1u", "extended-csi-u")).toBe("a");
  });

  test("Korean syllable stays UTF-8 text", () => {
    expect(reEncodeCsiU("\x1b[54620;1:1u", "extended-csi-u")).toBe("한");
  });

  test("Shift+a → 'A' (legacy literal, not CSI-u)", () => {
    expect(reEncodeCsiU("\x1b[97;2:1u", "extended-csi-u")).toBe("A");
  });

  test("Ctrl+a → 0x01 (legacy control char, not CSI-u)", () => {
    expect(reEncodeCsiU("\x1b[97;5:1u", "extended-csi-u")).toBe("\x01");
  });

  test("Alt+a → ESC+a (legacy, not CSI-u)", () => {
    expect(reEncodeCsiU("\x1b[97;3:1u", "extended-csi-u")).toBe("\x1ba");
  });

  test("Up arrow → \\x1b[A (legacy, not CSI-u)", () => {
    expect(reEncodeCsiU("\x1b[57416;1:1u", "extended-csi-u")).toBe("\x1b[A");
  });

  test("Ctrl+Up → \\x1b[1;5A (legacy CSI form)", () => {
    expect(reEncodeCsiU("\x1b[57416;5:1u", "extended-csi-u")).toBe("\x1b[1;5A");
  });

  test("Shift+Tab → \\x1b[Z (legacy is unambiguous)", () => {
    expect(reEncodeCsiU("\x1b[9;2:1u", "extended-csi-u")).toBe("\x1b[Z");
  });

  // Lossy combinations should escalate to CSI-u in extended mode so tmux
  // can preserve modifier information for apps that requested extended keys.
  test("Shift+Enter → CSI-u (legacy would lose Shift)", () => {
    expect(reEncodeCsiU("\x1b[13;2:1u", "extended-csi-u")).toBe("\x1b[13;2u");
  });

  test("Ctrl+Enter → CSI-u", () => {
    expect(reEncodeCsiU("\x1b[13;5:1u", "extended-csi-u")).toBe("\x1b[13;5u");
  });

  test("Ctrl+Shift+Enter → CSI-u", () => {
    expect(reEncodeCsiU("\x1b[13;6:1u", "extended-csi-u")).toBe("\x1b[13;6u");
  });

  test("Shift+Backspace → CSI-u", () => {
    expect(reEncodeCsiU("\x1b[127;2:1u", "extended-csi-u")).toBe("\x1b[127;2u");
  });

  test("Ctrl+Tab → CSI-u (legacy would collapse to \\t)", () => {
    expect(reEncodeCsiU("\x1b[9;5:1u", "extended-csi-u")).toBe("\x1b[9;5u");
  });

  test("Alt+Tab → CSI-u", () => {
    expect(reEncodeCsiU("\x1b[9;3:1u", "extended-csi-u")).toBe("\x1b[9;3u");
  });

  test("Ctrl+Shift+a → CSI-u (legacy would lose Shift)", () => {
    expect(reEncodeCsiU("\x1b[97;6:1u", "extended-csi-u")).toBe("\x1b[97;6u");
  });

  test("modified Escape → CSI-u", () => {
    expect(reEncodeCsiU("\x1b[27;5:1u", "extended-csi-u")).toBe("\x1b[27;5u");
  });

  // Drops still apply identically.
  test("release event still dropped", () => {
    expect(reEncodeCsiU("\x1b[13;2:3u", "extended-csi-u")).toBe(null);
  });

  test("modifier-only key still dropped", () => {
    expect(reEncodeCsiU("\x1b[57447;2:1u", "extended-csi-u")).toBe(null);
  });
});
