import { describe, expect, test } from "bun:test";

import type { OptionsDialogState } from "./model.ts";

import { routeOptionsDialogInput } from "./controller.ts";

function createState(overrides: Partial<OptionsDialogState> = {}): OptionsDialogState {
  return {
    activeWindowIdDisplayEnabled: false,
    agentAlertAnimConfusables: true,
    agentAlertAnimCycleCount: 1,
    agentAlertAnimDelay: 60,
    agentAlertAnimEqualizer: false,
    agentAlertAnimGlow: false,
    agentAlertAnimScribble: false,
    agentAlertCursorAlert: false,
    agentAlertCursorBlink: true,
    agentAlertCursorColor: "#ff0000",
    agentAlertCursorShape: "underline",
    agentAlertWatermark: "off",
    animationCycleCountCursor: 0,
    animationCycleCountEditing: false,
    animationCycleCountText: "1",
    animationDelayCursor: 0,
    animationDelayEditing: false,
    animationDelayText: "60",
    bufferZoomFade: true,
    cursorColorPickerOpen: false,
    dimInactivePanes: false,
    dimInactivePanesOpacity: 40,
    honeybeamsEnabled: false,
    ignoreMouseInput: false,
    multiSelectEditing: false,
    muxotronEnabled: true,
    paneTabsEnabled: false,
    privilegedPaneDetection: true,
    privilegedPaneDetectionOpacity: 15,
    quickTerminalSize: 90,
    remoteAdding: null,
    remoteEditing: null,
    remoteSelectedIndex: 0,
    remoteServers: [],
    remoteTesting: null,
    row: 0,
    screenshotDir: "",
    screenshotDirCursor: 0,
    screenshotDirEditing: false,
    screenshotFlash: true,
    tab: "general",
    themeBuiltin: "dracula",
    themeMode: "built-in",
    tmuxKeyBindingHints: true,
    tmuxPrefixKeyAlias: null,
    tmuxPrefixKeyAliasCaptureError: "",
    tmuxPrefixKeyAliasCapturing: false,
    uiMode: "adaptive",
    ...overrides,
  };
}

describe("routeOptionsDialogInput", () => {
  test("captures a modifier-only prefix alias", () => {
    const state = createState({
      row: 1,
      tab: "input",
      tmuxPrefixKeyAliasCapturing: true,
    });

    const result = routeOptionsDialogInput("\x1b[57447;2:3u", state, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });

    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.draft.tmuxPrefixKeyAlias).toBe("right_shift");
    expect(result.draft.tmuxPrefixKeyAliasCapturing).toBe(false);
    expect(result.draft.tmuxPrefixKeyAliasCaptureError).toBe("");
  });

  test("reports prefix-alias conflicts with the bound action label", () => {
    const state = createState({
      row: 1,
      tab: "input",
      tmuxPrefixKeyAliasCapturing: true,
    });

    const result = routeOptionsDialogInput("\x1b[57447;2:3u", state, {
      sequenceMap: new Map([["right_shift", "zoomAgentsView"]]),
      suppressModifierRelease: false,
    });

    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.draft.tmuxPrefixKeyAliasCaptureError).toBe("right shift already bound to Zoom agents view");
    expect(result.draft.tmuxPrefixKeyAliasCapturing).toBe(true);
  });

  test("suppresses bare modifier release after rejecting alt+a during prefix capture", () => {
    const state = createState({
      row: 1,
      tab: "input",
      tmuxPrefixKeyAliasCapturing: true,
    });

    const rejected = routeOptionsDialogInput("\x1ba", state, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });

    expect(rejected.kind).toBe("update");
    expect(rejected.suppressModifierRelease).toBe(true);
    if (rejected.kind !== "update") return;
    expect(rejected.draft.tmuxPrefixKeyAliasCaptureError).toBe("prefix key alias must be a modifier key");

    const released = routeOptionsDialogInput("\x1b[57443;3:3u", rejected.draft, {
      sequenceMap: new Map(),
      suppressModifierRelease: rejected.suppressModifierRelease,
    });

    expect(released.kind).toBe("noop");
    expect(released.suppressModifierRelease).toBe(false);
  });

  test("supports the remote add flow across name and host fields", () => {
    const state = createState({ tab: "remote" });

    const startAdd = routeOptionsDialogInput("a", state, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });
    expect(startAdd.kind).toBe("update");
    if (startAdd.kind !== "update") return;

    const typeName = routeOptionsDialogInput("n", startAdd.draft, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });
    expect(typeName.kind).toBe("update");
    if (typeName.kind !== "update") return;

    const moveToHost = routeOptionsDialogInput("\t", typeName.draft, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });
    expect(moveToHost.kind).toBe("update");
    if (moveToHost.kind !== "update") return;
    expect(moveToHost.draft.remoteAdding?.field).toBe("host");

    const typeHost = routeOptionsDialogInput("h", moveToHost.draft, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });
    expect(typeHost.kind).toBe("update");
    if (typeHost.kind !== "update") return;

    const finish = routeOptionsDialogInput("\r", typeHost.draft, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });
    expect(finish.kind).toBe("update");
    if (finish.kind !== "update") return;
    expect(finish.draft.remoteServers).toEqual([{ host: "h", name: "n" }]);
    expect(finish.draft.remoteAdding).toBeNull();
  });

  test("escape confirms the current draft outside of edit modes", () => {
    const state = createState();

    const result = routeOptionsDialogInput("\x1b", state, {
      sequenceMap: new Map(),
      suppressModifierRelease: false,
    });

    expect(result.kind).toBe("confirm");
    if (result.kind !== "confirm") return;
    expect(result.draft).toEqual(state);
  });
});
