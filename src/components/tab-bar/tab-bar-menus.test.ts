import { describe, expect, test } from "bun:test";

import type { TmuxSession } from "../../tmux/types.ts";

import { getTabBarMoveMenuLayout } from "./tab-bar-menus.tsx";
import { buildTabBarContextMenuItems } from "./use-tab-bar-menus.ts";

describe("tab-bar menu helpers", () => {
  test("disables move when no alternate sessions are available", () => {
    expect(buildTabBarContextMenuItems(false)).toEqual([
      { disabled: true, key: "move", label: "Move to session  ▸" },
      { disabled: false, key: "rename", label: "Rename window" },
      { disabled: false, key: "close", label: "Close window" },
    ]);
  });

  test("positions the move submenu to the left when it would overflow", () => {
    const sessions: TmuxSession[] = [
      { attached: true, id: "$1", name: "alpha" },
      { attached: false, id: "$2", name: "beta-session" },
    ];

    expect(getTabBarMoveMenuLayout(50, 30, 26, sessions)).toEqual({
      moveItemWidth: 20,
      moveLeft: 8,
      moveWidth: 22,
    });
  });
});
