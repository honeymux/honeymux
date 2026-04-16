import { describe, expect, test } from "bun:test";

import { SIDEBAR_VIEWS, clampSidebarWidth, cycleSidebarView, getSidebarMinFocusIndex } from "./use-app-chrome-focus.ts";

describe("app chrome focus helpers", () => {
  test("reports the correct minimum focus index per sidebar view", () => {
    expect(getSidebarMinFocusIndex("agents")).toBe(1);
    expect(getSidebarMinFocusIndex("server")).toBe(1);
    expect(getSidebarMinFocusIndex("hook-sniffer")).toBe(0);
  });

  test("cycles sidebar views in both directions", () => {
    expect(SIDEBAR_VIEWS).toEqual(["agents", "server", "hook-sniffer"]);
    expect(cycleSidebarView("agents", 1)).toBe("server");
    expect(cycleSidebarView("server", 1)).toBe("hook-sniffer");
    expect(cycleSidebarView("agents", -1)).toBe("hook-sniffer");
    expect(cycleSidebarView("hook-sniffer", -1)).toBe("server");
  });

  test("clamps sidebar width to the allowed range", () => {
    expect(clampSidebarWidth(10, 120)).toBe(20);
    expect(clampSidebarWidth(40, 120)).toBe(40);
    expect(clampSidebarWidth(300, 80)).toBe(69);
  });
});
