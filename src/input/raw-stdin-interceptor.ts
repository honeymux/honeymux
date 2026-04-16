/* eslint-disable no-control-regex */
import { StringDecoder } from "node:string_decoder";

import { writeTerminalOutput } from "../util/terminal-output.ts";
import { createBracketedPasteParser } from "./bracketed-paste-parser.ts";
import { stripAndForwardFocusEvents } from "./focus-event-forwarder.ts";

// SGR mouse sequence: ESC [ < Cb ; Cx ; Cy M/m
// Cb = button+modifiers, Cx/Cy = 1-based screen coordinates
// M = press/motion, m = release
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const MAX_PENDING_CONTROL_CHARS = 128;

export interface MouseForwardConfig {
  /** True when a dialog with custom input handling is open (e.g. conversations dialog).
   *  Paste content should be fed to onDialogInput character by character. */
  isDialogOpen?: () => boolean;
  /** True when a dropdown with custom input handling is open.
   *  Paste content should be fed to onDropdownInput character by character. */
  isDropdownOpen?: () => boolean;
  /** True when an OpenTUI textarea has focus (e.g. rename/new-session input).
   *  Bracketed paste should be passed through to OpenTUI instead of the PTY. */
  isTextInputActive?: () => boolean;
  /** True while the modifier-zoom overlay is active. When set, modifier bits
   *  are stripped from mouse events passed to OpenTUI so the held modifier
   *  key doesn't alter the click behavior. */
  isZoomActive?: () => boolean;
  /**
   * Given 1-based screen coordinates from a mouse event, return:
   * - { x, y } to forward to PTY at those coordinates
   * - null to let OpenTUI handle it (e.g., tab bar clicks)
   * - "consume" to silently discard (strip from input, don't forward)
   *
   * @param button Raw SGR button code (bit 5 = motion flag)
   * @param suffix "M" for press/motion, "m" for release
   */
  mapCoordinates: (
    screenX: number,
    screenY: number,
    button: number,
    suffix: string,
  ) => "consume" | { x: number; y: number } | null;
  onDialogInput?: (data: string) => void;
  onDropdownInput?: (data: string) => void;
}

/**
 * Install raw stdin interception for mouse, focus, and bracketed-paste
 * handling. Returns a teardown that restores the original stdin emitter.
 */
export function installRawStdinInterceptor(
  writeToPty: (data: string) => void,
  mouseConfig: MouseForwardConfig,
): () => void {
  // Enable button-event tracking (motion while button pressed) + SGR format.
  // OpenTUI already enabled \x1b[?1000h (basic click) and \x1b[?1006h (SGR).
  // Adding 1002 upgrades to button-event tracking (superset of 1000).
  writeTerminalOutput("\x1b[?1002h");

  const decoder = new StringDecoder("utf8");
  const originalEmit = process.stdin.emit.bind(process.stdin);
  const parser = createBracketedPasteParser();
  const stdin = process.stdin as any;
  let controlCarry = "";

  const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

  const isIncompleteSgrMousePrefix = (text: string): boolean => {
    if (!text.startsWith("\x1b[<")) return false;

    let index = 3;
    if (index === text.length) return true;

    // Parse first number (button code)
    const cb0 = index;
    while (index < text.length && isDigit(text[index])) index += 1;
    if (index === cb0 || index === text.length || text[index] !== ";") return index === cb0 || index === text.length;

    index += 1;
    if (index === text.length) return true;

    // Parse second number (X coordinate)
    const x0 = index;
    while (index < text.length && isDigit(text[index])) index += 1;
    if (index === x0 || index === text.length || text[index] !== ";") return index === x0 || index === text.length;

    index += 1;
    if (index === text.length) return true;

    // Parse third number (Y coordinate)
    const y0 = index;
    while (index < text.length && isDigit(text[index])) index += 1;
    if (index === y0) return false;
    if (index === text.length) return true;

    return false;
  };

  const isIncompleteCsiSequence = (text: string): boolean => {
    if (!text.startsWith("\x1b[")) return false;
    if (text === "\x1b[") return true;

    // A CSI sequence is: ESC [ <params> <final-letter>
    // Find the first letter after ESC [ — that's the CSI final byte.
    // If we haven't seen a letter yet, the sequence is incomplete.
    for (let i = 2; i < text.length; i += 1) {
      const ch = text.charCodeAt(i);
      // Check if it's a letter (A-Z: 65-90, a-z: 97-122)
      if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) {
        // CSI sequence is complete, but there's extra content after it.
        // Return false to stop carrying — the sequence ends here.
        return false;
      }
    }

    // No final byte found, sequence is incomplete.
    return true;
  };

  const takeTrailingControlPrefix = (text: string): string => {
    // Lone ESC at end is the most common incomplete sequence. Handle it first.
    if (text.endsWith("\x1b")) return "\x1b";

    const lastEscIdx = text.lastIndexOf("\x1b");
    if (lastEscIdx === -1) return "";

    const suffix = text.slice(lastEscIdx);
    if (suffix.length > MAX_PENDING_CONTROL_CHARS) return "";

    // Check for known incomplete patterns at the end of the string.
    // This includes incomplete CSI sequences and SGR mouse sequences.
    if (suffix === "\x1b[" || isIncompleteSgrMousePrefix(suffix) || isIncompleteCsiSequence(suffix)) {
      return suffix;
    }

    return "";
  };

  /** Route completed paste content to the right destination. */
  const deliverPaste = (text: string): void => {
    if (mouseConfig.isTextInputActive?.()) {
      originalEmit("data", Buffer.from(`\x1b[200~${text}\x1b[201~`, "utf-8"));
      return;
    }
    if (mouseConfig.isDialogOpen?.() && mouseConfig.onDialogInput) {
      for (const ch of text) {
        mouseConfig.onDialogInput(ch);
      }
      return;
    }
    if (mouseConfig.isDropdownOpen?.() && mouseConfig.onDropdownInput) {
      for (const ch of text) {
        mouseConfig.onDropdownInput(ch);
      }
      return;
    }
    writeToPty(`\x1b[200~${text}\x1b[201~`);
  };

  const emitOriginalText = (text: string): void => {
    if (text.length === 0) return;
    originalEmit("data", Buffer.from(text, "utf-8"));
  };

  const forwardTextSegment = (text: string): void => {
    let pending = controlCarry + text;
    controlCarry = "";
    const trailingControlPrefix = takeTrailingControlPrefix(pending);
    if (trailingControlPrefix.length > 0) {
      pending = pending.slice(0, pending.length - trailingControlPrefix.length);
      controlCarry = trailingControlPrefix;
    }
    if (pending.length === 0) return;

    const cleaned = stripAndForwardFocusEvents(pending, writeToPty);
    if (cleaned.length === 0) return;

    let lastIdx = 0;
    const re = new RegExp(SGR_MOUSE_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(cleaned)) !== null) {
      if (match.index > lastIdx) {
        emitOriginalText(cleaned.slice(lastIdx, match.index));
      }

      lastIdx = match.index + match[0].length;
      const cb = parseInt(match[1]!, 10);
      const cx = parseInt(match[2]!, 10);
      const cy = parseInt(match[3]!, 10);
      const suffix = match[4]!;
      const mapped = mouseConfig.mapCoordinates(cx, cy, cb, suffix);
      if (mapped === "consume") {
        continue;
      }
      if (mapped && mapped.x >= 1 && mapped.y >= 1) {
        writeToPty(`\x1b[<${match[1]};${mapped.x};${mapped.y}${suffix}`);
        continue;
      }

      // Pass through to OpenTUI. When the zoom overlay is active the user is
      // holding a modifier key — strip modifier bits (shift=4, alt=8, ctrl=16)
      // so OpenTUI dispatches a clean button event.
      let seq = match[0];
      if (mouseConfig.isZoomActive?.()) {
        const cleanCb = cb & ~(4 | 8 | 16);
        if (cleanCb !== cb) seq = `\x1b[<${cleanCb};${cx};${cy}${suffix}`;
      }
      emitOriginalText(seq);
    }

    if (lastIdx < cleaned.length) {
      emitOriginalText(cleaned.slice(lastIdx));
    }
  };

  const processDecodedChunk = (chunk: string): void => {
    if (chunk.length === 0) return;
    // NFC-normalize early so that combining sequences (e.g. NFD å = a + ◌̊)
    // are composed before OpenTUI's StdinBuffer splits them character-by-character.
    // This is safe for escape sequences since NFC is a no-op on pure ASCII.
    const str = chunk.normalize("NFC");
    const segments = parser.push(str);
    for (const segment of segments) {
      if (segment.type === "paste") {
        deliverPaste(segment.text);
      } else {
        forwardTextSegment(segment.text);
      }
    }
  };

  const patchedEmit = function (event: string, ...args: any[]) {
    if (event !== "data") return originalEmit(event, ...args);

    const buf: Buffer = args[0];
    processDecodedChunk(decoder.write(buf));
    return true;
  };

  stdin.emit = patchedEmit;

  return () => {
    processDecodedChunk(decoder.end());
    parser.reset();
    controlCarry = "";
    if (stdin.emit === patchedEmit) {
      stdin.emit = originalEmit;
    }
  };
}
