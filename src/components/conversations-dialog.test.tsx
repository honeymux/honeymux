import { describe, expect, test } from "bun:test";

import { theme } from "../themes/theme.ts";
import { stringWidth } from "../util/text.ts";
import {
  buildConversationsMenuItems,
  buildConversationsPositionLabel,
  buildConversationsStatusLine,
  formatConversationTimestamp,
  getConversationsStatusColor,
} from "./conversations-dialog.tsx";

describe("buildConversationsStatusLine", () => {
  test("formats the footer status for paged long result sets", () => {
    const line = buildConversationsStatusLine(100, 428, true, 48);

    expect(line.startsWith(" ")).toBe(true);
    expect(line).toContain("Showing 100 of 428 conversations");
    expect(line).toContain("↓ loads more");
    expect(stringWidth(line)).toBe(48);
  });

  test("keeps footer status generic when regex is invalid", () => {
    const line = buildConversationsStatusLine(0, 0, false, 40);

    expect(line.startsWith(" ")).toBe(true);
    expect(line).toContain("Showing 0 of 0 conversations");
    expect(line).not.toContain("Invalid regex");
    expect(stringWidth(line)).toBe(40);
  });
});

describe("getConversationsStatusColor", () => {
  test("uses the error color for invalid regex output", () => {
    expect(getConversationsStatusColor("Unterminated group")).toBe(theme.statusError);
    expect(getConversationsStatusColor()).toBe(theme.textDim);
  });
});

describe("buildConversationsPositionLabel", () => {
  test("uses the absolute result offset for older pages", () => {
    expect(buildConversationsPositionLabel(37, 1088, 1050)).toBe(" 1088/1088 ");
  });
});

describe("buildConversationsMenuItems", () => {
  test("shows checkbox state for case-sensitive and regex search", () => {
    expect(buildConversationsMenuItems(true, false)).toEqual(["[x] Case-sensitive search", "[ ] Regex search"]);
  });
});

describe("formatConversationTimestamp", () => {
  test("formats local date and time without a relative suffix", () => {
    const timestamp = new Date(2026, 0, 10, 17, 30).getTime();

    expect(formatConversationTimestamp(timestamp)).toBe("2026/01/10 05:30PM");
  });
});
