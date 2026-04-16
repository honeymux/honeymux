const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const MIN_SHARED_MARKER_PREFIX = 2;

// Keep parser state explicitly bounded so malformed or hostile streams cannot
// grow memory indefinitely while waiting for a closing marker.
export const MAX_BRACKETED_PASTE_CHARS = 1024 * 1024;

export interface BracketedPasteParser {
  push: (chunk: string) => RawInputSegment[];
  reset: () => void;
}

export type RawInputSegment = { text: string; type: "paste" } | { text: string; type: "text" };

export function createBracketedPasteParser(maxChars: number = MAX_BRACKETED_PASTE_CHARS): BracketedPasteParser {
  let pasteAccum: null | string = null;
  let pasteAccumLength = 0;
  let discardingPaste = false;
  let discardCarry = "";
  let pasteEndCarry = "";
  let textCarry = "";

  function takeTrailingMarkerPrefix(text: string, marker: string): string {
    const maxPrefixLength = Math.min(text.length, marker.length - 1);
    for (let len = maxPrefixLength; len >= MIN_SHARED_MARKER_PREFIX; len -= 1) {
      const suffix = text.slice(-len);
      if (marker.startsWith(suffix)) return suffix;
    }
    return "";
  }

  const appendPastePart = (text: string): boolean => {
    if (pasteAccum === null) return false;
    if (pasteAccumLength + text.length > maxChars) return false;
    pasteAccum += text;
    pasteAccumLength += text.length;
    return true;
  };

  return {
    push(chunk: string): RawInputSegment[] {
      const segments: RawInputSegment[] = [];
      let remaining = chunk;
      if (discardingPaste) {
        remaining = discardCarry + remaining;
        discardCarry = "";
      } else if (pasteAccum !== null) {
        remaining = pasteEndCarry + remaining;
        pasteEndCarry = "";
      } else {
        remaining = textCarry + remaining;
        textCarry = "";
      }

      while (remaining.length > 0) {
        if (discardingPaste) {
          const endIdx = remaining.indexOf(BRACKETED_PASTE_END);
          if (endIdx === -1) {
            discardCarry = takeTrailingMarkerPrefix(remaining, BRACKETED_PASTE_END);
            return segments;
          }
          discardingPaste = false;
          remaining = remaining.slice(endIdx + BRACKETED_PASTE_END.length);
          continue;
        }

        if (pasteAccum !== null) {
          const endIdx = remaining.indexOf(BRACKETED_PASTE_END);
          if (endIdx === -1) {
            const endCarry = takeTrailingMarkerPrefix(remaining, BRACKETED_PASTE_END);
            const pastePart = remaining.slice(0, remaining.length - endCarry.length);
            if (!appendPastePart(pastePart)) {
              pasteAccum = null;
              pasteAccumLength = 0;
              discardingPaste = true;
              discardCarry = endCarry;
            } else {
              pasteEndCarry = endCarry;
            }
            return segments;
          }

          const pastePart = remaining.slice(0, endIdx);
          if (pasteAccumLength + pastePart.length <= maxChars) {
            pasteAccum += pastePart;
            segments.push({ text: pasteAccum, type: "paste" });
          }
          pasteAccum = null;
          pasteAccumLength = 0;
          pasteEndCarry = "";
          remaining = remaining.slice(endIdx + BRACKETED_PASTE_END.length);
          continue;
        }

        const startIdx = remaining.indexOf(BRACKETED_PASTE_START);
        if (startIdx === -1) {
          const startCarry = takeTrailingMarkerPrefix(remaining, BRACKETED_PASTE_START);
          const textPart = remaining.slice(0, remaining.length - startCarry.length);
          if (textPart.length > 0) {
            segments.push({ text: textPart, type: "text" });
          }
          textCarry = startCarry;
          return segments;
        }

        if (startIdx > 0) {
          segments.push({ text: remaining.slice(0, startIdx), type: "text" });
        }

        const afterStart = remaining.slice(startIdx + BRACKETED_PASTE_START.length);
        const endIdx = afterStart.indexOf(BRACKETED_PASTE_END);
        if (endIdx !== -1) {
          const pasteText = afterStart.slice(0, endIdx);
          if (pasteText.length <= maxChars) {
            segments.push({ text: pasteText, type: "paste" });
          }
          remaining = afterStart.slice(endIdx + BRACKETED_PASTE_END.length);
          continue;
        }

        const endCarry = takeTrailingMarkerPrefix(afterStart, BRACKETED_PASTE_END);
        const pastePart = afterStart.slice(0, afterStart.length - endCarry.length);
        if (pastePart.length > maxChars) {
          discardingPaste = true;
          discardCarry = endCarry;
          return segments;
        }

        pasteAccum = pastePart;
        pasteAccumLength = pastePart.length;
        pasteEndCarry = endCarry;
        return segments;
      }

      return segments;
    },

    reset(): void {
      pasteAccum = null;
      pasteAccumLength = 0;
      discardingPaste = false;
      discardCarry = "";
      pasteEndCarry = "";
      textCarry = "";
    },
  };
}
