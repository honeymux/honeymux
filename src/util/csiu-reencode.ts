/**
 * CSI u → legacy terminal re-encoder.
 *
 * When Kitty keyboard flag 8 (all keys as escape codes) is enabled, every
 * keystroke arrives as a CSI u sequence. tmux doesn't understand these, so
 * we re-encode them back to legacy format before forwarding to the PTY.
 *
 * Release events (event type 3) and modifier-only keys are dropped (return null).
 */

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
export function reEncodeChunk(chunk: string): string {
  const seqs = splitSequences(chunk);
  let result = "";
  for (const seq of seqs) {
    const encoded = reEncodeCsiU(seq);
    if (encoded !== null) result += encoded;
  }
  return result;
}

/**
 * Re-encode a single terminal sequence from CSI u to legacy format.
 * Returns null if the event should be dropped (release events, modifier-only keys).
 * Non-CSI-u sequences are returned unchanged.
 */
export function reEncodeCsiU(sequence: string): null | string {
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
    return encodeLegacy(effectiveCode, mods);
  }

  // CSI u without modifiers: ESC [ code (:event_type)? u
  const plain = sequence.match(/^\x1b\[(\d+)(?::(\d+))?u$/);
  if (plain) {
    const code = parseInt(plain[1]!, 10);
    const eventType = plain[2] ? parseInt(plain[2], 10) : 1;
    if (eventType === 3) return null;
    if (code >= 57441 && code <= 57452) return null;
    return encodeLegacy(code, 0);
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

function encodeLegacy(code: number, mods: number): string {
  const hasShift = !!(mods & 1);
  const hasAlt = !!(mods & 2);
  const hasCtrl = !!(mods & 4);

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
  // Unknown — forward as CSI u (best effort)
  else {
    return mods > 0 ? `\x1b[${code};${mods + 1}u` : `\x1b[${code}u`;
  }

  if (hasAlt) result = "\x1b" + result;
  return result;
}
