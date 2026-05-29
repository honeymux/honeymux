import { describe, expect, test } from "bun:test";

import {
  buildPaneBorderMainMenuItems,
  buildPaneBorderServerMenuItems,
  getPaneBorderMenuItemWidth,
} from "./pane-border-menu.tsx";

describe("buildPaneBorderMainMenuItems", () => {
  test("shows a please-wait label when remote mirrors are still syncing", () => {
    expect(
      buildPaneBorderMainMenuItems({
        hasReadyRemoteServers: false,
        hasRemoteServers: true,
        paneInMultiTabGroup: false,
        paneTabsEnabled: true,
      }),
    ).toEqual([
      { disabled: false, key: "new-tab", label: "New tab" },
      { disabled: true, key: "convert-to-remote", label: "Convert to remote (please wait) " },
    ]);
  });

  test("keeps the please-wait label while configured remotes are still unavailable", () => {
    expect(
      buildPaneBorderMainMenuItems({
        hasReadyRemoteServers: false,
        hasRemoteServers: true,
        paneInMultiTabGroup: false,
        paneTabsEnabled: true,
      }),
    ).toEqual([
      { disabled: false, key: "new-tab", label: "New tab" },
      { disabled: true, key: "convert-to-remote", label: "Convert to remote (please wait) " },
    ]);
  });

  test("enables convert-to-remote once any server is ready", () => {
    expect(
      buildPaneBorderMainMenuItems({
        hasReadyRemoteServers: true,
        hasRemoteServers: true,
        paneInMultiTabGroup: false,
        paneTabsEnabled: true,
      }),
    ).toEqual([
      { disabled: false, key: "new-tab", label: "New tab" },
      { disabled: false, key: "convert-to-remote", label: "Convert to remote  ▸" },
    ]);
  });

  test("disables convert-to-remote for a multi-tab pane even when a server is ready", () => {
    expect(
      buildPaneBorderMainMenuItems({
        hasReadyRemoteServers: true,
        hasRemoteServers: true,
        paneInMultiTabGroup: true,
        paneTabsEnabled: true,
      }),
    ).toEqual([
      { disabled: false, key: "new-tab", label: "New tab" },
      { disabled: true, key: "convert-to-remote", label: "Convert to remote (untab first) " },
    ]);
  });
});

describe("buildPaneBorderServerMenuItems", () => {
  test("disables unavailable servers and annotates waiting ones", () => {
    expect(
      buildPaneBorderServerMenuItems([
        { availability: "ready", name: "alpha" },
        { availability: "waiting", name: "beta" },
        { availability: "unavailable", name: "gamma" },
      ]),
    ).toEqual([
      { disabled: false, label: "alpha", serverName: "alpha" },
      { disabled: true, label: "beta (please wait)", serverName: "beta" },
      { disabled: true, label: "gamma", serverName: "gamma" },
    ]);
  });
});

describe("getPaneBorderMenuItemWidth", () => {
  test("measures labels in terminal cells instead of code units", () => {
    expect(getPaneBorderMenuItemWidth(["漢字漢字漢字漢字漢字漢字"])).toBe(27);
  });
});
