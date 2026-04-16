import { describe, expect, it } from "bun:test";

import { stringWidth } from "../../util/text.ts";
import { buildTabLines, computeTabDisplayNames, tabWidth } from "./layout.ts";

const makeWindow = (name: string, active = false) => ({
  active,
  id: `@${name}`,
  index: 0,
  layout: "",
  name,
  paneId: `%0`,
});

describe("buildTabLines width consistency", () => {
  const totalWidth = 120;
  const expectWidth = (text: string) => expect(stringWidth(text)).toBe(totalWidth);

  it("produces lines of exactly totalWidth when no badge", () => {
    const windows = [makeWindow("zsh", true)];
    const { bot, mid, top } = buildTabLines(windows, 0, totalWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("produces lines of exactly totalWidth with badge and no toolbar reserve", () => {
    const windows = [makeWindow("zsh", true)];
    const badgeWidth = 10;
    const badgeReserve = badgeWidth + 2; // no toolbar reserve
    const { bot, mid, top } = buildTabLines(windows, 0, totalWidth, badgeReserve, badgeWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("produces lines of exactly totalWidth with badge and toolbar reserve", () => {
    const windows = [makeWindow("zsh", true)];
    const badgeWidth = 10;
    const toolbarReserve = 6;
    const badgeReserve = badgeWidth + 2 + toolbarReserve;
    const { bot, mid, top } = buildTabLines(windows, 0, totalWidth, badgeReserve, badgeWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("produces lines of exactly totalWidth with leftReserve and badge", () => {
    const windows = [makeWindow("zsh", true)];
    const badgeWidth = 10;
    const badgeReserve = badgeWidth + 2;
    const leftReserve = 2;
    const { bot, mid, top } = buildTabLines(windows, 0, totalWidth, badgeReserve, badgeWidth, false, leftReserve);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("produces lines of exactly totalWidth with no windows", () => {
    const { bot, mid, top } = buildTabLines([], 0, totalWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("preserves badge reserve spaces in bot when windows is empty", () => {
    const badgeWidth = 12;
    const badgeReserve = badgeWidth + 2 + 3; // badge + gap + toolbar
    const { bot } = buildTabLines([], 0, totalWidth, badgeReserve, badgeWidth);
    expectWidth(bot);
    // The badge reserve area (near the right end) must contain spaces, not ─
    const reserveStart = totalWidth - 1 - badgeReserve;
    const reserveSlice = bot.slice(reserveStart, reserveStart + badgeReserve);
    expect(reserveSlice).toBe(" ".repeat(badgeReserve));
  });

  it("produces lines of exactly totalWidth with multiple windows", () => {
    const windows = [makeWindow("bash"), makeWindow("vim", true), makeWindow("htop")];
    const badgeWidth = 12;
    const badgeReserve = badgeWidth + 2 + 3; // toolbar
    const { bot, mid, top } = buildTabLines(windows, 1, totalWidth, badgeReserve, badgeWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
  });

  it("keeps cell width stable with wide CJK tab labels", () => {
    const windows = [makeWindow("漢字"), makeWindow("編譯器", true), makeWindow("logs")];
    const { bot, mid, top } = buildTabLines(windows, 1, totalWidth);
    expectWidth(top);
    expectWidth(mid);
    expectWidth(bot);
    expect(tabWidth(windows[0]!, false)).toBe(8);
  });

  it("truncates wide labels by display width", () => {
    const windows = [makeWindow("漢字漢字漢字"), makeWindow("zsh")];
    const displayNames = computeTabDisplayNames(windows, 18);
    expect(displayNames[0]).toContain("…");
    expect(stringWidth(displayNames[0]!)).toBeLessThanOrEqual(8);
  });
});
