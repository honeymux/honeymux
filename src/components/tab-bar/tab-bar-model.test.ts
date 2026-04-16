import { describe, expect, test } from "bun:test";

import { stringWidth } from "../../util/text.ts";
import { buildTabBarModel } from "./tab-bar-model.ts";

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
      ptyDragging: false,
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
      ptyDragging: false,
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
      ptyDragging: false,
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
