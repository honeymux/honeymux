import type { TerminalData, TerminalLine, TerminalSpan } from "ghostty-opentui";

/**
 * Crop terminal data to a rectangular region in terminal-cell space.
 */
export function cropTerminalData(
  full: TerminalData,
  left: number,
  top: number,
  width: number,
  height: number,
): TerminalData {
  const croppedLines: TerminalLine[] = [];
  for (let row = top; row < top + height && row < full.lines.length; row++) {
    const line = full.lines[row]!;
    const croppedSpans: TerminalSpan[] = [];
    let col = 0;
    for (const span of line.spans) {
      const spanEnd = col + span.width;
      if (spanEnd <= left) {
        col = spanEnd;
        continue;
      }
      if (col >= left + width) break;
      const clipStart = Math.max(0, left - col);
      const clipEnd = Math.min(span.width, left + width - col);
      if (clipEnd > clipStart) {
        const textLen = span.text.length;
        const charStart = Math.round((clipStart * textLen) / span.width);
        const charEnd = Math.round((clipEnd * textLen) / span.width);
        croppedSpans.push({
          bg: span.bg,
          fg: span.fg,
          flags: span.flags,
          text: span.text.slice(charStart, charEnd),
          width: clipEnd - clipStart,
        });
      }
      col = spanEnd;
    }
    croppedLines.push({ spans: croppedSpans });
  }
  return {
    cols: width,
    cursor: [0, 0],
    cursorStyle: full.cursorStyle,
    cursorVisible: false,
    lines: croppedLines,
    offset: 0,
    rows: height,
    totalLines: croppedLines.length,
  };
}
