import { describe, expect, it } from "bun:test";

import type { PaneTab } from "./types.ts";

import { stringWidth } from "../../util/text.ts";
import {
  buildBorderFormat,
  buildDragBorderFormat,
  computePaneTabDropIndex,
  computePaneTabInsertIndex,
  hitTestPaneTab,
} from "./layout.ts";

const tabs: PaneTab[] = [
  { label: "tab 1", paneId: "%1" },
  { label: "tab 2", paneId: "%2" },
  { label: "tab 3", paneId: "%3" },
];

describe("pane tab drag helpers", () => {
  describe("hitTestPaneTab", () => {
    // Each tab: "┤ tab N ├─" = 5 + 5 = 10 columns
    // With BORDER_PREFIX=2: tab 0 starts at col 2, tab 1 at col 12, tab 2 at col 22

    it("returns -1 for xOffset before border prefix", () => {
      expect(hitTestPaneTab(tabs, 0)).toBe(-1);
      expect(hitTestPaneTab(tabs, 1)).toBe(-1);
    });

    it("returns tab index for xOffset on first tab", () => {
      expect(hitTestPaneTab(tabs, 2)).toBe(0); // adjusted=0, first tab starts at col 0
      expect(hitTestPaneTab(tabs, 8)).toBe(0); // still within first tab (width 10)
    });

    it("returns tab index for xOffset on second tab", () => {
      expect(hitTestPaneTab(tabs, 12)).toBe(1); // adjusted=10, second tab starts at col 10
    });

    it("returns tab index for xOffset on third tab", () => {
      expect(hitTestPaneTab(tabs, 22)).toBe(2); // adjusted=20, third tab starts at col 20
    });

    it("returns -1 for xOffset past all tabs", () => {
      expect(hitTestPaneTab(tabs, 35)).toBe(-1);
    });

    it("uses terminal cell widths for wide CJK labels", () => {
      const wideTabs: PaneTab[] = [
        { label: "漢字", paneId: "%1" },
        { label: "vim", paneId: "%2" },
      ];

      expect(hitTestPaneTab(wideTabs, 2)).toBe(0);
      expect(hitTestPaneTab(wideTabs, 10)).toBe(0);
      expect(hitTestPaneTab(wideTabs, 11)).toBe(1);
    });
  });

  describe("computePaneTabDropIndex", () => {
    it("returns source index when not moved far enough", () => {
      // Tab 1 at center, xOffset roughly at tab 1's position
      expect(computePaneTabDropIndex(tabs, 1, 17)).toBe(1);
    });

    it("computes drop at start when dragged left", () => {
      expect(computePaneTabDropIndex(tabs, 1, 2)).toBe(0);
    });

    it("computes drop at end when dragged right", () => {
      expect(computePaneTabDropIndex(tabs, 1, 30)).toBe(2);
    });
  });

  describe("computePaneTabInsertIndex", () => {
    it("returns 0 for xOffset before first tab midpoint", () => {
      expect(computePaneTabInsertIndex(tabs, 2)).toBe(0);
    });

    it("returns 1 for xOffset between first and second tab midpoints", () => {
      expect(computePaneTabInsertIndex(tabs, 12)).toBe(1);
    });

    it("returns tabs.length for xOffset past all tabs", () => {
      expect(computePaneTabInsertIndex(tabs, 35)).toBe(3);
    });
  });

  describe("buildBorderFormat", () => {
    it("keeps the active tab visible when the tab strip overflows", () => {
      const overflowTabs: PaneTab[] = [
        { label: "one", paneId: "%1" },
        { label: "two", paneId: "%2" },
        { label: "three", paneId: "%3" },
      ];

      // maxWidth=22 gives enough room for "three" without truncation
      // but still forces overflow (only 1 tab visible).
      const format = buildBorderFormat(overflowTabs, 2, "single", 22);

      expect(format).toContain("┤ three ├");
      expect(format).toContain("┤ +2 ├");
      expect(format).not.toContain("┤ one ├");
    });

    it("dynamically truncates long labels to share available space", () => {
      const longTabs: PaneTab[] = [
        { label: "short", paneId: "%1" },
        { label: "very_long_command_name", paneId: "%2" },
      ];

      // maxWidth=35: available = 31 (minus menu 4)
      // raw total = (5+5) + (5+21) = 36 > 31 → truncation needed
      // budget = 31 - 2*5 = 21
      // water-fill: "short"(5) fits in share, "very_long_command_name"(21) truncated
      const format = buildBorderFormat(longTabs, 0, "single", 35);

      expect(format).toContain("┤ short ├");
      expect(format).not.toContain("very_long_command_name");
      expect(format).toContain("…");
    });

    it("truncates wide labels by display width", () => {
      const format = buildBorderFormat([{ label: "漢字漢字漢字", paneId: "%1" }], 0, "single", 16);

      expect(format).toContain("┤ 漢字漢… ├");
      expect(stringWidth("漢字漢…")).toBe(7);
    });

    it("does not truncate labels when there is enough room", () => {
      const fitTabs: PaneTab[] = [
        { label: "bash", paneId: "%1" },
        { label: "vim", paneId: "%2" },
      ];

      // maxWidth=80: plenty of room
      const format = buildBorderFormat(fitTabs, 0, "single", 80);

      expect(format).toContain("┤ bash ├");
      expect(format).toContain("┤ vim ├");
    });

    it("escapes tmux format markers inside tab labels", () => {
      const format = buildBorderFormat([{ label: "#(danger) #{pane_id}", paneId: "%1" }], 0, "single", 80);

      expect(format).toContain("┤ ##(danger) ##{pane_id} ├");
    });
  });

  describe("buildDragBorderFormat", () => {
    it("escapes tmux format markers inside drag labels", () => {
      const format = buildDragBorderFormat([{ label: "#(danger)", paneId: "%1" }], 0, 0, "single", 80);

      expect(format).toContain("┤ ##(danger) ├");
    });
  });

  describe("hitTestPaneTab overflow layout", () => {
    const overflowTabs: PaneTab[] = [
      { label: "one", paneId: "%1" },
      { label: "two", paneId: "%2" },
      { label: "three", paneId: "%3" },
    ];

    it("returns -2 for the overflow indicator", () => {
      expect(hitTestPaneTab(overflowTabs, 12, 20, 2)).toBe(-2);
    });

    it("returns -3 for the menu button hit zone", () => {
      expect(hitTestPaneTab(overflowTabs, 19, 20, 2)).toBe(-3);
    });
  });
});
