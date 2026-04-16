import { describe, expect, it } from "bun:test";

import { stringWidth } from "../util/text.ts";
import {
  centerOptionsText,
  fitOptionsText,
  renderCursorViewport,
  rightTruncateOptionsText,
  wrapOptionsText,
} from "./options-dialog-display.ts";

describe("options dialog display helpers", () => {
  it("centers sanitized text by display width", () => {
    const centered = centerOptionsText("a\t漢", 5);
    expect(centered).not.toContain("\t");
    expect(stringWidth(centered)).toBe(5);
  });

  it("wraps mixed-width help text without exceeding the width budget", () => {
    const lines = wrapOptionsText("A 漢字 mix width", 6);
    expect(lines).toEqual(["A 漢字", "mix", "width"]);
    expect(lines.every((line) => stringWidth(line) <= 6)).toBe(true);
  });

  it("right-truncates long labels by display width", () => {
    const truncated = rightTruncateOptionsText("~/projects/漢字/path", 8);
    expect(truncated.startsWith("…")).toBe(true);
    expect(truncated.endsWith("path")).toBe(true);
    expect(stringWidth(truncated)).toBeLessThanOrEqual(8);
  });

  it("renders cursor viewports with clipping that preserves the width budget", () => {
    const viewport = renderCursorViewport("ab漢字cd", 6, 6, { leadingEllipsis: true });
    expect(viewport.startsWith("…")).toBe(true);
    expect(viewport).toContain("█");
    expect(stringWidth(viewport)).toBe(6);
  });

  it("fits sanitized text to a fixed width", () => {
    const fitted = fitOptionsText("ab\tcd", 5);
    expect(fitted).toBe("abcd ");
    expect(stringWidth(fitted)).toBe(5);
  });
});
