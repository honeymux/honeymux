import { describe, expect, test } from "bun:test";

import { parseLayoutSize } from "./snapshot.ts";

describe("parseLayoutSize", () => {
  test("extracts WxH from a single-pane layout", () => {
    expect(parseLayoutSize("a97d,121x30,0,0,0")).toEqual({ cols: 121, rows: 30 });
  });

  test("extracts the window WxH (not a child cell) from a split layout", () => {
    expect(parseLayoutSize("6f8c,121x30,0,0{60x30,0,0,0,60x30,61,0,1}")).toEqual({ cols: 121, rows: 30 });
  });

  test("returns null for an empty layout (freshly created window)", () => {
    expect(parseLayoutSize("")).toBeNull();
  });

  test("returns null for a string with no leading WxH", () => {
    expect(parseLayoutSize("x")).toBeNull();
  });
});
