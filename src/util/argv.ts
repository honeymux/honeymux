/**
 * Format an argv array into a shell-like command string.
 * Arguments containing special characters are single-quoted.
 */
export function formatArgv(argv: string[]): string {
  return argv
    .map((arg) => {
      if (arg.length === 0) return "''";
      if (/[^a-zA-Z0-9_./:=@%^+,-]/.test(arg)) {
        return "'" + arg.replace(/'/g, "'\\''") + "'";
      }
      return arg;
    })
    .join(" ");
}

/**
 * Parse a shell-like command string into an argv array.
 * Handles single quotes, double quotes, and backslash escapes.
 * Returns empty array for empty/whitespace-only input.
 */
export function parseArgv(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let i = 0;
  const len = input.length;
  let hasContent = false;

  while (i < len) {
    const ch = input[i]!;

    if (ch === " " || ch === "\t") {
      if (hasContent) {
        args.push(current);
        current = "";
        hasContent = false;
      }
      i++;
      continue;
    }

    hasContent = true;

    // Single-quoted string: everything until closing quote is literal
    if (ch === "'") {
      i++;
      while (i < len && input[i] !== "'") {
        current += input[i];
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    // Double-quoted string: backslash escapes work inside
    if (ch === '"') {
      i++;
      while (i < len && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < len) {
          const next = input[i + 1]!;
          if (next === '"' || next === "\\" || next === "$" || next === "`") {
            current += next;
            i += 2;
            continue;
          }
        }
        current += input[i];
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    // Backslash escape outside quotes
    if (ch === "\\" && i + 1 < len) {
      current += input[i + 1];
      i += 2;
      continue;
    }

    current += ch;
    i++;
  }

  if (hasContent) {
    args.push(current);
  }

  return args;
}
