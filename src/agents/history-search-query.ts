export interface HistorySearchMatcher {
  active: boolean;
  buildHighlightMask: (text: string) => boolean[];
  error?: string;
  matches: (text: string | undefined) => boolean;
}

export interface HistorySearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export function compileHistorySearchMatcher(query: string, options: HistorySearchOptions = {}): HistorySearchMatcher {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      active: false,
      buildHighlightMask: emptyHighlightMask,
      matches: () => true,
    };
  }

  const caseSensitive = options.caseSensitive === true;

  if (options.regex) {
    try {
      const testRegex = new RegExp(trimmedQuery, caseSensitive ? "" : "i");
      const highlightRegex = new RegExp(trimmedQuery, caseSensitive ? "g" : "gi");
      return {
        active: true,
        buildHighlightMask: (text: string) => buildRegexHighlightMask(text, highlightRegex),
        matches: (text: string | undefined) => typeof text === "string" && testRegex.test(text),
      };
    } catch (error) {
      return {
        active: true,
        buildHighlightMask: emptyHighlightMask,
        error: normalizeRegexError(error),
        matches: () => false,
      };
    }
  }

  const foldedQuery = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
  return {
    active: true,
    buildHighlightMask: (text: string) => buildSubstringHighlightMask(text, trimmedQuery, caseSensitive),
    matches: (text: string | undefined) => {
      if (typeof text !== "string") return false;
      const haystack = caseSensitive ? text : text.toLowerCase();
      return haystack.includes(foldedQuery);
    },
  };
}

function buildRegexHighlightMask(text: string, pattern: RegExp): boolean[] {
  const mask = emptyHighlightMask(text);
  const regex = new RegExp(pattern.source, pattern.flags);
  for (const match of text.matchAll(regex)) {
    const matchedText = match[0] ?? "";
    const start = match.index ?? 0;
    if (matchedText.length === 0) continue;
    for (let i = start; i < Math.min(text.length, start + matchedText.length); i++) {
      mask[i] = true;
    }
  }
  return mask;
}

function buildSubstringHighlightMask(text: string, query: string, caseSensitive: boolean): boolean[] {
  const mask = emptyHighlightMask(text);
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let start = haystack.indexOf(needle);
  while (start !== -1) {
    for (let i = start; i < start + needle.length; i++) {
      mask[i] = true;
    }
    start = haystack.indexOf(needle, start + needle.length);
  }
  return mask;
}

function emptyHighlightMask(text: string): boolean[] {
  return new Array(text.length).fill(false);
}

function normalizeRegexError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "Invalid regular expression";
  const withoutPrefix = rawMessage.replace(/^Invalid regular expression:\s*/i, "").trim();
  if (withoutPrefix.startsWith("/")) {
    const detailIndex = withoutPrefix.indexOf(": ");
    if (detailIndex !== -1) {
      const detail = withoutPrefix.slice(detailIndex + 2).trim();
      if (detail) return detail;
    }
  }
  return withoutPrefix || "Invalid regular expression";
}
