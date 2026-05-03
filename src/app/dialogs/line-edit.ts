import { identifyKeySequence } from "../../util/keybindings.ts";

/**
 * Pure, cursor-aware line-editing primitive shared by non-textarea query
 * dialogs (e.g. the conversations dialog). Operates on codepoint indices,
 * not UTF-16 code units, so surrogate-pair emoji count as one position.
 *
 * Supported keys (emacs/readline conventions):
 *   ctrl+a / home        beginning of line
 *   ctrl+e / end         end of line
 *   ctrl+b / left        backward char
 *   ctrl+f / right       forward char
 *   ctrl+d / delete      delete forward char
 *   ctrl+h / backspace   delete backward char
 *   ctrl+k               kill to end of line
 *   ctrl+u               kill to beginning of line
 *   ctrl+w               delete whitespace-delimited word backward
 *   alt+b                move word backward
 *   alt+f                move word forward
 *   alt+d                delete word forward
 *   alt+backspace        delete word backward
 *   printable codepoint  insert at cursor
 */

export interface LineEditState {
  /** Codepoint index in [0, codepoints(query).length]. */
  cursor: number;
  query: string;
}

interface LineEditResult {
  /** Whether `applyLineEdit` consumed this key. */
  handled: boolean;
  /** New state (same object if unchanged). */
  next: LineEditState;
  /** Whether the query string changed (cursor-only motion → false). */
  queryChanged: boolean;
}

export function applyLineEdit(state: LineEditState, data: string): LineEditResult {
  // --- Raw-byte fast paths for keys that identifyKeySequence does not cover ---

  // Backspace (varies by terminal)
  if (data === "\x7f" || data === "\x08") {
    return deleteBackwardChar(state);
  }
  // Alt+Backspace — readline backward-kill-word
  if (data === "\x1b\x7f" || data === "\x1b\x08") {
    return deleteWordBackward(state);
  }
  // Forward delete
  if (data === "\x1b[3~") {
    return deleteForwardChar(state);
  }
  // Home / End in various legacy encodings
  if (data === "\x1b[H" || data === "\x1bOH" || data === "\x1b[1~" || data === "\x1b[7~") {
    return moveBeginning(state);
  }
  if (data === "\x1b[F" || data === "\x1bOF" || data === "\x1b[4~" || data === "\x1b[8~") {
    return moveEnd(state);
  }

  // --- Canonical combo dispatch (covers both legacy and Kitty CSI u) ---
  const combo = identifyKeySequence(data);
  if (combo) {
    switch (combo) {
      case "alt+b":
        return moveWordBackward(state);
      case "alt+d":
        return deleteWordForwardClass(state);
      case "alt+f":
        return moveWordForward(state);
      case "ctrl+a":
        return moveBeginning(state);
      case "ctrl+b":
      case "left":
        return moveBackwardChar(state);
      case "ctrl+d":
        return deleteForwardChar(state);
      case "ctrl+e":
        return moveEnd(state);
      case "ctrl+f":
      case "right":
        return moveForwardChar(state);
      case "ctrl+h":
        return deleteBackwardChar(state);
      case "ctrl+k":
        return killToEnd(state);
      case "ctrl+u":
        return killToBeginning(state);
      case "ctrl+w":
        return deleteWhitespaceWordBackward(state);
    }
  }

  // --- Printable insert ---
  if (isPrintableChar(data)) {
    return insertChar(state, data);
  }

  return { handled: false, next: state, queryChanged: false };
}

/** True if `s` is a single printable codepoint (ASCII, CJK, emoji, etc.). */
export function isPrintableChar(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined || cp < 32) return false;
  // DEL + C1 controls
  if (cp >= 0x7f && cp <= 0x9f) return false;
  // Verify exactly one codepoint (for..of counts codepoints, not UTF-16 units)
  let count = 0;
  for (const _ of s) {
    if (++count > 1) return false;
  }
  return count === 1;
}

/** Convenience: build a fresh state at end-of-query (useful for callers). */
export function lineEditStateAtEnd(query: string): LineEditState {
  return { cursor: [...query].length, query };
}

// --- Helpers --------------------------------------------------------------

function backwardWhitespaceWordIndex(cps: string[], i: number): number {
  let j = i;
  while (j > 0 && isWhitespace(cps[j - 1]!)) j--;
  while (j > 0 && !isWhitespace(cps[j - 1]!)) j--;
  return j;
}

function backwardWordIndex(cps: string[], i: number): number {
  let j = i;
  while (j > 0 && !isWordChar(cps[j - 1]!)) j--;
  while (j > 0 && isWordChar(cps[j - 1]!)) j--;
  return j;
}

function clampCursor(cps: string[], cursor: number): number {
  return Math.max(0, Math.min(cps.length, cursor));
}

function cursorOnly(state: LineEditState, cursor: number): LineEditResult {
  const cps = [...state.query];
  const next = clampCursor(cps, cursor);
  if (next === state.cursor) {
    return { handled: true, next: state, queryChanged: false };
  }
  return { handled: true, next: { cursor: next, query: state.query }, queryChanged: false };
}

function deleteBackwardChar(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor <= 0) return { handled: true, next: state, queryChanged: false };
  cps.splice(state.cursor - 1, 1);
  return mutation(cps, state.cursor - 1);
}

function deleteForwardChar(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor >= cps.length) return { handled: true, next: state, queryChanged: false };
  cps.splice(state.cursor, 1);
  return mutation(cps, state.cursor);
}

function deleteWhitespaceWordBackward(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor <= 0) return { handled: true, next: state, queryChanged: false };
  const target = backwardWhitespaceWordIndex(cps, state.cursor);
  if (target === state.cursor) return { handled: true, next: state, queryChanged: false };
  cps.splice(target, state.cursor - target);
  return mutation(cps, target);
}

function deleteWordBackward(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor <= 0) return { handled: true, next: state, queryChanged: false };
  const target = backwardWordIndex(cps, state.cursor);
  if (target === state.cursor) return { handled: true, next: state, queryChanged: false };
  cps.splice(target, state.cursor - target);
  return mutation(cps, target);
}

function deleteWordForwardClass(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor >= cps.length) return { handled: true, next: state, queryChanged: false };
  const target = forwardWordIndex(cps, state.cursor);
  if (target === state.cursor) return { handled: true, next: state, queryChanged: false };
  cps.splice(state.cursor, target - state.cursor);
  return mutation(cps, state.cursor);
}

function forwardWordIndex(cps: string[], i: number): number {
  let j = i;
  while (j < cps.length && !isWordChar(cps[j]!)) j++;
  while (j < cps.length && isWordChar(cps[j]!)) j++;
  return j;
}

function insertChar(state: LineEditState, ch: string): LineEditResult {
  const cps = [...state.query];
  cps.splice(state.cursor, 0, ch);
  return mutation(cps, state.cursor + 1);
}

function isWhitespace(cp: string): boolean {
  return /\s/.test(cp);
}

function isWordChar(cp: string): boolean {
  return /[\p{L}\p{N}_]/u.test(cp);
}

function killToBeginning(state: LineEditState): LineEditResult {
  if (state.cursor <= 0) return { handled: true, next: state, queryChanged: false };
  const cps = [...state.query];
  cps.splice(0, state.cursor);
  return mutation(cps, 0);
}

function killToEnd(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  if (state.cursor >= cps.length) return { handled: true, next: state, queryChanged: false };
  cps.splice(state.cursor, cps.length - state.cursor);
  return mutation(cps, state.cursor);
}

function moveBackwardChar(state: LineEditState): LineEditResult {
  return cursorOnly(state, state.cursor - 1);
}

function moveBeginning(state: LineEditState): LineEditResult {
  return cursorOnly(state, 0);
}

function moveEnd(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  return cursorOnly(state, cps.length);
}

function moveForwardChar(state: LineEditState): LineEditResult {
  return cursorOnly(state, state.cursor + 1);
}

function moveWordBackward(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  return cursorOnly(state, backwardWordIndex(cps, state.cursor));
}

function moveWordForward(state: LineEditState): LineEditResult {
  const cps = [...state.query];
  return cursorOnly(state, forwardWordIndex(cps, state.cursor));
}

function mutation(cps: string[], cursor: number): LineEditResult {
  return {
    handled: true,
    next: { cursor, query: cps.join("") },
    queryChanged: true,
  };
}
