/**
 * CSI u → tmux-friendly terminal re-encoder.
 *
 * When Kitty keyboard flag 8 (all keys as escape codes) is enabled, every
 * keystroke arrives as a CSI u sequence. tmux's bare default doesn't
 * understand these, so we re-encode them before forwarding to the PTY.
 *
 * Two modes:
 * - `"legacy"` (default): emit pure pre-CSI-u terminal sequences (literal
 *   characters, control chars, classic CSI/SS3 forms). Used when tmux's
 *   `extended-keys` option is `off` — matches what plain tmux would receive
 *   from a non-Kitty terminal.
 * - `"extended-csi-u"`: emit legacy form for unambiguous combinations and
 *   CSI-u form for combinations where legacy would be lossy (modified
 *   Enter/Backspace/Escape, Ctrl/Alt+Tab, Ctrl+Shift+letter). Used when
 *   tmux has `extended-keys on` + `extended-keys-format csi-u` — matches
 *   what tmux would receive from a Kitty-capable terminal that has
 *   accepted tmux's `\x1b[>1u` (disambiguate-only) request.
 *
 * Release events (event type 3) and modifier-only keys are dropped (return null).
 */

export type ForwardMode = "extended-csi-u" | "legacy";

// Legacy CSI sequences for special Kitty key codes
const SPECIAL_KEY_LEGACY: Record<number, string> = {
  57399: "\t", // Tab (alternate code)
  57416: "\x1b[A", // Up
  57417: "\x1b[B", // Down
  57418: "\x1b[C", // Right
  57419: "\x1b[D", // Left
  57420: "\x1b[H", // Home
  57421: "\x1b[F", // End
  57422: "\x1b[5~", // Page Up
  57423: "\x1b[6~", // Page Down
  57424: "\x1b[2~", // Insert
  57425: "\x1b[3~", // Delete
};

// F-key legacy sequences (F1-F12)
const FKEY_LEGACY: Record<number, string> = {
  57364: "\x1bOP", // F1
  57365: "\x1bOQ", // F2
  57366: "\x1bOR", // F3
  57367: "\x1bOS", // F4
  57368: "\x1b[15~", // F5
  57369: "\x1b[17~", // F6
  57370: "\x1b[18~", // F7
  57371: "\x1b[19~", // F8
  57372: "\x1b[20~", // F9
  57373: "\x1b[21~", // F10
  57374: "\x1b[23~", // F11
  57375: "\x1b[24~", // F12
};

/**
 * Re-encode a full input chunk. Splits into sequences, re-encodes each,
 * and returns the concatenated result for forwarding to the PTY.
 * Dropped events (releases, modifier-only) are silently consumed.
 */
export function reEncodeChunk(chunk: string, mode: ForwardMode = "legacy"): string {
  const seqs = splitSequences(chunk);
  let result = "";
  for (const seq of seqs) {
    const encoded = reEncodeCsiU(seq, mode);
    if (encoded !== null) result += encoded;
  }
  return result;
}

/**
 * Re-encode a single terminal sequence from CSI u to a tmux-friendly form.
 * Returns null if the event should be dropped (release events, modifier-only keys).
 * Non-CSI-u sequences are returned unchanged.
 */
export function reEncodeCsiU(sequence: string, mode: ForwardMode = "legacy"): null | string {
  // CSI u with modifiers: ESC [ code (:shifted_code)? (:base_code)? ; mods (:event_type)? u
  // With flag 4 (alternate keys), the shifted key code is in the second field.
  const csiU = sequence.match(/^\x1b\[(\d+)(?::(\d+))?(?::\d+)?;(\d+)(?::(\d+))?u$/);
  if (csiU) {
    const code = parseInt(csiU[1]!, 10);
    const shiftedCode = csiU[2] ? parseInt(csiU[2], 10) : 0;
    const mods = parseInt(csiU[3]!, 10) - 1;
    const eventType = csiU[4] ? parseInt(csiU[4], 10) : 1;
    if (eventType === 3) return null; // release
    if (code >= 57441 && code <= 57452) return null; // modifier-only
    // Use shifted code when available and Shift is pressed (for layout-correct chars)
    const effectiveCode = shiftedCode > 0 && mods & 1 ? shiftedCode : code;
    return encodeForward(effectiveCode, mods, mode);
  }

  // CSI u without modifiers: ESC [ code (:event_type)? u
  const plain = sequence.match(/^\x1b\[(\d+)(?::(\d+))?u$/);
  if (plain) {
    const code = parseInt(plain[1]!, 10);
    const eventType = plain[2] ? parseInt(plain[2], 10) : 1;
    if (eventType === 3) return null;
    if (code >= 57441 && code <= 57452) return null;
    return encodeForward(code, 0, mode);
  }

  // CSI arrow/special with event type: ESC [ num? ; mods :event_type ABCDHF~
  const csiSpecial = sequence.match(/^\x1b\[(\d+)?;(\d+)(?::(\d+))?([ABCDHF~])$/);
  if (csiSpecial) {
    const eventType = csiSpecial[3] ? parseInt(csiSpecial[3], 10) : 1;
    if (eventType === 3) return null; // drop release
    // Strip event type; when mods=1 (no modifiers) emit the bare legacy form
    const num = csiSpecial[1] ?? "";
    const mods = csiSpecial[2]!;
    const suffix = csiSpecial[4]!;
    if (mods === "1") {
      // No modifiers — emit bare form: ESC [ suffix or ESC [ num suffix
      return suffix === "~" ? `\x1b[${num}~` : `\x1b[${suffix}`;
    }
    return `\x1b[${num};${mods}${suffix}`;
  }

  // Not a CSI u sequence — pass through unchanged
  return sequence;
}

/**
 * Split a raw input chunk into individual terminal sequences.
 * Handles CSI sequences (ESC [ ... letter), ESC + char, and plain bytes.
 */
export function splitSequences(str: string): string[] {
  const seqs: string[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\x1b" && i + 1 < str.length && str[i + 1] === "[") {
      // CSI sequence: scan for terminating byte (0x40-0x7E)
      let j = i + 2;
      while (j < str.length && (str.charCodeAt(j) < 0x40 || str.charCodeAt(j) > 0x7e)) {
        j++;
      }
      if (j < str.length) {
        seqs.push(str.slice(i, j + 1));
        i = j + 1;
      } else {
        // Incomplete CSI — push remainder as-is
        seqs.push(str.slice(i));
        break;
      }
    } else if (str[i] === "\x1b" && i + 1 < str.length) {
      // ESC + next char (SS3, alt+key, etc.)
      seqs.push(str.slice(i, i + 2));
      i += 2;
    } else {
      // Plain byte
      seqs.push(str[i]!);
      i++;
    }
  }
  return seqs;
}

function encodeForward(code: number, mods: number, mode: ForwardMode): string {
  const hasShift = !!(mods & 1);
  const hasAlt = !!(mods & 2);
  const hasCtrl = !!(mods & 4);
  const isTextOnlyMods = mods === 0 || mods === 1;

  // In extended-csi-u mode, route lossy modifier combinations through CSI u
  // so tmux (with extended-keys-format=csi-u) preserves the modifier
  // information when dispatching to apps that have requested extended keys.
  // Unmodified keys and combinations whose legacy encoding is unambiguous
  // (Shift+letter, Ctrl+letter, modified arrows/specials) keep their legacy
  // form — this matches what a Kitty-capable terminal emits in tmux's
  // disambiguate-only mode and avoids confusing tmux's CSI-u parser with
  // sequences it doesn't expect.
  if (mode === "extended-csi-u" && mods > 0) {
    const isLetter = code >= 97 && code <= 122;
    const wouldBeLossy =
      code === 13 || // Enter
      code === 8 ||
      code === 127 || // Backspace / DEL
      code === 27 || // Escape
      (code === 9 && (hasCtrl || hasAlt)) || // Ctrl/Alt+Tab (Shift+Tab → \x1b[Z is fine)
      (hasCtrl && hasShift && isLetter); // Ctrl+Shift+letter
    if (wouldBeLossy) {
      return `\x1b[${code};${mods + 1}u`;
    }
  }

  let result: string;

  // Special keys (arrows, home, end, etc.)
  const special = SPECIAL_KEY_LEGACY[code];
  if (special) {
    if (mods > 0) {
      if (special.startsWith("\x1b[")) {
        const suffix = special[special.length - 1]!;
        const param = special.slice(2, -1); // e.g., "" for \x1b[A, "5" for \x1b[5~
        result = suffix === "~" ? `\x1b[${param};${mods + 1}~` : `\x1b[${param || "1"};${mods + 1}${suffix}`;
      } else {
        result = special;
      }
    } else {
      result = special;
    }
    return result;
  }

  // F-keys
  const fkey = FKEY_LEGACY[code];
  if (fkey) {
    if (mods > 0) {
      if (fkey.startsWith("\x1b[")) {
        const suffix = fkey[fkey.length - 1]!;
        const param = fkey.slice(2, -1);
        result = `\x1b[${param};${mods + 1}${suffix}`;
      } else if (fkey.startsWith("\x1bO")) {
        // SS3 F-keys (F1-F4) with modifiers use CSI format
        const letter = fkey[2]!;
        result = `\x1b[1;${mods + 1}${letter}`;
      } else {
        result = fkey;
      }
    } else {
      result = fkey;
    }
    return result;
  }

  // Enter, Backspace, Escape, Tab
  if (code === 13) {
    result = "\r";
  } else if (code === 127 || code === 8) {
    result = "\x7f";
  } else if (code === 27) {
    result = "\x1b";
  } else if (code === 9) {
    result = hasShift ? "\x1b[Z" : "\t";
  }
  // Ctrl+letter → control character (0x01-0x1A)
  else if (hasCtrl && code >= 97 && code <= 122) {
    result = String.fromCharCode(code - 96);
    if (hasAlt) return "\x1b" + result;
    return result;
  }
  // Printable ASCII
  else if (code >= 32 && code <= 126) {
    const ch = hasShift && code >= 97 && code <= 122 ? code - 32 : code;
    result = String.fromCharCode(ch);
  }
  // Printable Unicode text. Keep modified non-ASCII keys in CSI u form so
  // shortcuts and terminal-specific modifier semantics are not widened here.
  else if (isTextOnlyMods && isUnicodeTextCodePoint(code)) {
    result = String.fromCodePoint(code);
  }
  // Unknown — forward as CSI u (best effort)
  else {
    return mods > 0 ? `\x1b[${code};${mods + 1}u` : `\x1b[${code}u`;
  }

  if (hasAlt) result = "\x1b" + result;
  return result;
}

function isUnicodeTextCodePoint(code: number): boolean {
  // Kitty uses Unicode PUA code points for non-text functional keys, so
  // treat PUA as ambiguous unless explicitly mapped above:
  // https://sw.kovidgoyal.net/kitty/keyboard-protocol/#functional-key-definitions
  // Unicode reserves PUA for private agreements and noncharacters for
  // internal use, not ordinary text: https://www.unicode.org/faq/private_use.html
  // U+FDD0..U+FDEF and the final two code points of each plane.
  if (code < 0xa0 || code > 0x10ffff) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  if (code >= 0xe000 && code <= 0xf8ff) return false;
  if (code >= 0xf0000 && code <= 0xffffd) return false;
  if (code >= 0x100000 && code <= 0x10fffd) return false;
  if (code >= 0xfdd0 && code <= 0xfdef) return false;
  return (code & 0xfffe) !== 0xfffe;
}
