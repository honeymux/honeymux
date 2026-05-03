interface BoundedLineAppendResult {
  lines: string[];
  overflowed: boolean;
  remainder: string;
}

/**
 * Append a decoded text chunk to a newline-delimited buffer while keeping the
 * retained parser state bounded. Returns `overflowed` when either a complete
 * line or the trailing incomplete remainder exceeds `maxBytes`.
 */
export function appendBoundedLines(remainder: string, chunk: string, maxBytes: number): BoundedLineAppendResult {
  const combined = remainder + chunk;
  const lines = combined.split("\n");
  const nextRemainder = lines.pop() ?? "";

  if (Buffer.byteLength(nextRemainder) > maxBytes) {
    return { lines: [], overflowed: true, remainder: "" };
  }

  for (const line of lines) {
    if (Buffer.byteLength(line) > maxBytes) {
      return { lines: [], overflowed: true, remainder: "" };
    }
  }

  return {
    lines,
    overflowed: false,
    remainder: nextRemainder,
  };
}
