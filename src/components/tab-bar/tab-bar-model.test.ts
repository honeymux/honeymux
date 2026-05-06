import { describe, expect, test } from "bun:test";

import { stringWidth } from "../../util/text.ts";
import { buildTabBarModel, computeTabBarBadgeReserve } from "./tab-bar-model.ts";

const makeWindow = (id: string, name: string, active = false) => ({
  active,
  id,
  index: Number(id.slice(1)),
  layout: "",
  name,
  paneId: `%${id.slice(1)}`,
});

describe("tab-bar model", () => {
  test("computes active tab id overlay when window ids are shown", () => {
    const model = buildTabBarModel({
      activeIndex: 1,
      activeWindowIdDisplayEnabled: true,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      expandedMuxotronWidth: 0,
      hasLayoutProfileClick: false,
      hasNewWindow: true,
      hasSidebarToggle: false,
      hasToolbarToggle: false,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "alpha",
      uiMode: "adaptive",
      width: 120,
      windows: [makeWindow("@1", "alpha"), makeWindow("@2", "beta", true)],
    });

    expect(model.activeIdOverlay).toEqual({ id: "@2", left: expect.any(Number) });
    expect(model.activeIdOverlay!.left).toBeGreaterThan(0);
  });

  test("composes a drag float while preserving terminal cell width", () => {
    const model = buildTabBarModel({
      activeIndex: 1,
      activeWindowIdDisplayEnabled: false,
      dragFrom: 0,
      dragOver: 2,
      dragX: 28,
      expandedMuxotronWidth: 0,
      hasLayoutProfileClick: false,
      hasNewWindow: true,
      hasSidebarToggle: true,
      hasToolbarToggle: true,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "alpha",
      uiMode: "adaptive",
      width: 80,
      windows: [makeWindow("@1", "alpha"), makeWindow("@2", "beta", true), makeWindow("@3", "gamma")],
    });

    expect(stringWidth(model.top)).toBe(80);
    expect(stringWidth(model.mid)).toBe(80);
    expect(stringWidth(model.bot)).toBe(80);
    expect(model.top).toContain("╭");
    expect(model.mid).toContain(" alpha ");
    expect(model.bot).toContain("╯");
  });

  test("badge tracks the current session name length without padding", () => {
    const model = buildTabBarModel({
      activeIndex: 0,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      hasLayoutProfileClick: false,
      hasNewWindow: false,
      hasSidebarToggle: false,
      hasToolbarToggle: false,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "abc",
      uiMode: "adaptive",
      width: 120,
      windows: [makeWindow("@1", "win", true)],
    });

    // 3-char name + 4 chrome cells = 7
    expect(model.badgeWidth).toBe(7);
    expect(model.badgeLabel).toBe(" abc ▾ ");
  });

  test("badge collapses to a single-char name", () => {
    const model = buildTabBarModel({
      activeIndex: 0,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      hasLayoutProfileClick: false,
      hasNewWindow: false,
      hasSidebarToggle: false,
      hasToolbarToggle: false,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "x",
      uiMode: "adaptive",
      width: 120,
      windows: [makeWindow("@1", "win", true)],
    });

    expect(model.badgeWidth).toBe(5); // " x ▾ "
    expect(model.badgeLabel).toBe(" x ▾ ");
  });

  test("badge expands to fit long names when there is room", () => {
    const model = buildTabBarModel({
      activeIndex: 0,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      hasLayoutProfileClick: false,
      hasNewWindow: false,
      hasSidebarToggle: false,
      hasToolbarToggle: false,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "really-long-session-name", // 24 chars
      uiMode: "adaptive",
      width: 200,
      windows: [makeWindow("@1", "win", true)],
    });

    // Plenty of room — badge accommodates the full name (24 + 4 chrome = 28).
    expect(model.badgeWidth).toBe(28);
    expect(model.badgeLabel).toBe(" really-long-session-name ▾ ");
  });

  test("badge shrinks when expansion would crowd the muxotron, keeping the 2-cell gap", () => {
    const name = "12345678901234"; // 14 chars — desired slot is 14
    // At width=80 with collapsed muxotron (27 wide, centered) and both
    // toolbar+profile buttons (toolbarReserve=6), the desired 14-char slot
    // doesn't fit. The badge shrinks while keeping ≥2 cells from the muxotron.
    const model = buildTabBarModel({
      activeIndex: 0,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      hasLayoutProfileClick: true,
      hasNewWindow: false,
      hasSidebarToggle: false,
      hasToolbarToggle: true,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: name,
      uiMode: "adaptive",
      width: 80,
      windows: [makeWindow("@1", "win", true)],
    });

    const muxotronRight = Math.floor((80 - 27) / 2) + 27; // 53
    const toolbarReserve = 6;
    const badgeLeft = 80 - toolbarReserve - 2 - model.badgeWidth;
    expect(model.badgeWidth).toBeLessThan(name.length + 4); // shrunk vs. desired
    expect(badgeLeft - muxotronRight).toBeGreaterThanOrEqual(2);
  });

  test("computeTabBarBadgeReserve mirrors the dynamic badge width", () => {
    const reserve = computeTabBarBadgeReserve({
      hasLayoutProfileClick: false,
      hasToolbarToggle: false,
      muxotronEnabled: true,
      sessionName: "really-long-session-name", // 24 chars
      uiMode: "adaptive",
      width: 200,
    });
    // Full name fits: 24 chars + 4 chrome + 2 gap = 30 (no toolbar reserve)
    expect(reserve).toBe(30);
  });

  test("places the plus button after the overflow indicator when tabs overflow", () => {
    const model = buildTabBarModel({
      activeIndex: 0,
      activeWindowIdDisplayEnabled: false,
      dragFrom: null,
      dragOver: null,
      dragX: null,
      expandedMuxotronWidth: 0,
      hasLayoutProfileClick: true,
      hasNewWindow: true,
      hasSidebarToggle: false,
      hasToolbarToggle: true,
      muxotronEnabledProp: true,
      muxotronExpanded: false,
      sessionName: "alpha",
      uiMode: "adaptive",
      width: 52,
      windows: [
        makeWindow("@1", "alpha-long"),
        makeWindow("@2", "beta-long"),
        makeWindow("@3", "gamma-long"),
        makeWindow("@4", "delta-long"),
        makeWindow("@5", "epsilon-long"),
      ],
    });

    expect(model.hasOverflow).toBe(true);
    expect(model.overflowStartX).toBeGreaterThanOrEqual(0);
    expect(model.plusStartX).toBe(model.overflowStartX + model.overflowIndicatorWidth + 1);
    expect(model.overflowLabel).toBe(`+${model.overflowWindows.length}`);
  });
});
