import { describe, expect, test } from "bun:test";

import { SESSION_PALETTE, getNextSessionColor } from "./theme.ts";

describe("getNextSessionColor", () => {
  test("returns first palette color when no colors are in use", () => {
    expect(getNextSessionColor([])).toBe(SESSION_PALETTE[0]!);
  });

  test("skips colors already in use", () => {
    expect(getNextSessionColor([SESSION_PALETTE[0]!])).toBe(SESSION_PALETTE[1]!);
    expect(getNextSessionColor([SESSION_PALETTE[0]!, SESSION_PALETTE[1]!])).toBe(SESSION_PALETTE[2]!);
  });

  test("ignores undefined entries instead of phantom-mapping them", () => {
    // undefined should NOT block SESSION_PALETTE[0] from being returned
    expect(getNextSessionColor([undefined])).toBe(SESSION_PALETTE[0]!);
    expect(getNextSessionColor([undefined, undefined])).toBe(SESSION_PALETTE[0]!);
  });

  test("case-insensitive matching", () => {
    expect(getNextSessionColor([SESSION_PALETTE[0]!.toUpperCase()])).toBe(SESSION_PALETTE[1]!);
  });

  test("returns palette[0] when palette exhausted and all counts equal", () => {
    const allUsed = SESSION_PALETTE.map((c) => c);
    expect(getNextSessionColor(allUsed)).toBe(SESSION_PALETTE[0]!);
  });

  test("when palette exhausted picks least-used color", () => {
    // palette[0] used twice, rest once — should pick palette[1]
    const colors = [...SESSION_PALETTE, SESSION_PALETTE[0]!];
    expect(getNextSessionColor(colors)).toBe(SESSION_PALETTE[1]!);
  });

  test("cycling distributes evenly after exhaustion", () => {
    // Simulate creating many sessions: first 15 get unique colors,
    // then we keep adding and verify even distribution.
    const assigned: string[] = [];
    for (let i = 0; i < SESSION_PALETTE.length; i++) {
      assigned.push(getNextSessionColor(assigned));
    }
    // First 15 should each be a unique palette entry
    expect(new Set(assigned).size).toBe(SESSION_PALETTE.length);

    // Next batch should cycle evenly — each palette color gets used once more
    for (let i = 0; i < SESSION_PALETTE.length; i++) {
      assigned.push(getNextSessionColor(assigned));
    }
    // After 30 total, each color should be used exactly 2 times
    const counts = new Map<string, number>();
    for (const c of assigned) {
      const key = c.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const color of SESSION_PALETTE) {
      expect(counts.get(color.toLowerCase())).toBe(2);
    }
  });

  test("undefined entries do not bias exhaustion cycling", () => {
    // All 15 palette colors used once + some undefined entries
    const colors: (string | undefined)[] = [...SESSION_PALETTE, undefined, undefined];
    // Should pick palette[0] (least used = all tied at 1, first wins)
    expect(getNextSessionColor(colors)).toBe(SESSION_PALETTE[0]!);
  });
});
