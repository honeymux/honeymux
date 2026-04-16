import { describe, expect, mock, test } from "bun:test";

import type { KeyAction } from "../util/keybindings.ts";

import { routeKeyboardInput } from "./keyboard-router.ts";

/** Minimal callbacks that satisfy the interface. */
function createCallbacks(overrides: Record<string, unknown> = {}) {
  return {
    isReady: () => true,
    ...overrides,
  } as Parameters<typeof routeKeyboardInput>[2];
}

describe("activateMenu in dialog mode", () => {
  test("activateMenu triggers onActivateMenu when a dialog is open", () => {
    const onActivateMenu = mock(() => {});
    const onDialogInput = mock((_data: string) => {});
    const callbacks = createCallbacks({
      isDialogOpen: () => true,
      onActivateMenu,
      onDialogInput,
    });
    // alt+v bound to activateMenu
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    const handled = routeKeyboardInput("\x1bv", () => {}, callbacks, keybindings);

    expect(handled).toBe(true);
    expect(onActivateMenu).toHaveBeenCalledTimes(1);
    expect(onDialogInput).not.toHaveBeenCalled();
  });

  test("non-activateMenu keys route to dialog handler normally", () => {
    const onActivateMenu = mock(() => {});
    const onDialogInput = mock((_data: string) => {});
    const callbacks = createCallbacks({
      isDialogOpen: () => true,
      onActivateMenu,
      onDialogInput,
    });
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    routeKeyboardInput("a", () => {}, callbacks, keybindings);

    expect(onActivateMenu).not.toHaveBeenCalled();
    expect(onDialogInput).toHaveBeenCalledWith("a");
  });

  test("activateMenu is NOT intercepted in dialogCapture mode", () => {
    const onActivateMenu = mock(() => {});
    const onDialogInput = mock((_data: string) => {});
    const callbacks = createCallbacks({
      isDialogCapturing: () => true,
      isDialogOpen: () => true,
      onActivateMenu,
      onDialogInput,
    });
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    routeKeyboardInput("\x1bv", () => {}, callbacks, keybindings);

    expect(onActivateMenu).not.toHaveBeenCalled();
    expect(onDialogInput).toHaveBeenCalled();
  });

  test("activateMenu works in dropdown owner mode", () => {
    const onActivateMenu = mock(() => {});
    const onDropdownInput = mock((_data: string) => false);
    const callbacks = createCallbacks({
      isDropdownOpen: () => true,
      onActivateMenu,
      onDropdownInput,
    });
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    routeKeyboardInput("\x1bv", () => {}, callbacks, keybindings);

    expect(onActivateMenu).toHaveBeenCalledTimes(1);
    expect(onDropdownInput).not.toHaveBeenCalled();
  });

  test("activateMenu works in default (PTY) mode", () => {
    const onActivateMenu = mock(() => {});
    const callbacks = createCallbacks({
      onActivateMenu,
    });
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    routeKeyboardInput("\x1bv", () => {}, callbacks, keybindings);

    expect(onActivateMenu).toHaveBeenCalledTimes(1);
  });

  test("activateMenu triggers onActivateMenu in quick terminal mode", () => {
    const onActivateMenu = mock(() => {});
    const callbacks = createCallbacks({
      isQuickTerminalOpen: () => true,
      onActivateMenu,
    });
    const keybindings = new Map<string, KeyAction>([["alt+v", "activateMenu"]]);

    routeKeyboardInput("\x1bv", () => {}, callbacks, keybindings);

    expect(onActivateMenu).toHaveBeenCalledTimes(1);
  });
});

describe("interactive agent muxotron input", () => {
  test("Esc dismisses the interactive surface instead of leaking to the PTY", () => {
    const onMuxotronDismiss = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      onMuxotronDismiss,
    });

    const handled = routeKeyboardInput("\x1b", writeToPty, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onMuxotronDismiss).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("plain typing forwards to the PTY when interactive (no zoom-shortcut interception)", () => {
    const onMuxotronDismiss = mock(() => {});
    const writeToPty = mock((_data: string) => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      isMuxotronFocusActive: () => true,
      onMuxotronDismiss,
    });

    routeKeyboardInput("a", writeToPty, callbacks, new Map());

    expect(onMuxotronDismiss).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith("a");
  });

  test("modifier-keyed agent shortcuts still fire while typing into an interactive pane", () => {
    const onQuickApprove = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      isMuxotronFocusActive: () => true,
      onQuickApprove,
    });
    const keybindings = new Map<string, KeyAction>([["ctrl+a", "agentPermApprove"]]);

    routeKeyboardInput("\x01", writeToPty, callbacks, keybindings);

    expect(onQuickApprove).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
  });
});

describe("agent latch / preview", () => {
  test("Enter in preview mode latches instead of reaching PTY", () => {
    const onReviewLatchToggle = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      onReviewLatchToggle,
    });

    const handled = routeKeyboardInput("\r", writeToPty, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("Esc in latched mode forwards to the agent PTY (does not dismiss)", () => {
    const onMuxotronDismiss = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      isMuxotronFocusActive: () => true,
      isReviewLatched: () => true,
      onMuxotronDismiss,
    });

    const handled = routeKeyboardInput("\x1b", writeToPty, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onMuxotronDismiss).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith("\x1b");
  });

  test("agentLatch in latched mode unlatches (does not dismiss zoom)", () => {
    const onReviewLatchToggle = mock(() => {});
    const onZoomEnd = mock(() => {});
    const onAgentLatch = mock(() => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      isMuxotronFocusActive: () => true,
      isReviewLatched: () => true,
      onAgentLatch,
      onReviewLatchToggle,
      onZoomEnd,
    });
    const keybindings = new Map<string, KeyAction>([["alt+i", "agentLatch"]]);

    routeKeyboardInput("\x1bi", () => {}, callbacks, keybindings);

    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(onAgentLatch).not.toHaveBeenCalled();
    expect(onZoomEnd).not.toHaveBeenCalled();
  });

  test("agentLatch in preview mode unlatches (toggles latch)", () => {
    const onReviewLatchToggle = mock(() => {});
    const onAgentLatch = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      onAgentLatch,
      onReviewLatchToggle,
    });
    const keybindings = new Map<string, KeyAction>([["alt+i", "agentLatch"]]);

    routeKeyboardInput("\x1bi", () => {}, callbacks, keybindings);

    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(onAgentLatch).not.toHaveBeenCalled();
  });

  test("agentLatch outside review context calls onAgentLatch", () => {
    const onReviewLatchToggle = mock(() => {});
    const onAgentLatch = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => false,
      isReviewLatched: () => false,
      onAgentLatch,
      onReviewLatchToggle,
    });
    const keybindings = new Map<string, KeyAction>([["alt+i", "agentLatch"]]);

    routeKeyboardInput("\x1bi", () => {}, callbacks, keybindings);

    expect(onAgentLatch).toHaveBeenCalledTimes(1);
    expect(onReviewLatchToggle).not.toHaveBeenCalled();
  });

  test("modifier-bound agentLatch reaches the action dispatch in preview mode", () => {
    const onReviewLatchToggle = mock(() => {});
    const onAgentLatch = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      onAgentLatch,
      onReviewLatchToggle,
    });
    const keybindings = new Map<string, KeyAction>([["right_shift", "agentLatch"]]);

    // CSI u modifier-only press for right_shift (code 57447).
    const handled = routeKeyboardInput("\x1b[57447;1:1u", () => {}, callbacks, keybindings);

    expect(handled).toBe(true);
    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(onAgentLatch).not.toHaveBeenCalled();
  });

  test("modifier-bound agentLatch fires while the sidebar has keyboard focus", () => {
    // User is in review preview mode: sidebar focused on the tree row they
    // just selected. Pressing the modifier-bound latch key must latch.
    const onReviewLatchToggle = mock(() => {});
    const onSidebarCancel = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      isSidebarFocused: () => true,
      onReviewLatchToggle,
      onSidebarCancel,
    });
    const keybindings = new Map<string, KeyAction>([["right_shift", "agentLatch"]]);

    const handled = routeKeyboardInput("\x1b[57447;1:1u", () => {}, callbacks, keybindings);

    expect(handled).toBe(true);
    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(onSidebarCancel).not.toHaveBeenCalled();
  });

  test("combo-bound agentLatch fires while the sidebar has keyboard focus", () => {
    const onReviewLatchToggle = mock(() => {});
    const onSidebarCancel = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      isSidebarFocused: () => true,
      onReviewLatchToggle,
      onSidebarCancel,
    });
    const keybindings = new Map<string, KeyAction>([["alt+i", "agentLatch"]]);

    const handled = routeKeyboardInput("\x1bi", () => {}, callbacks, keybindings);

    expect(handled).toBe(true);
    expect(onReviewLatchToggle).toHaveBeenCalledTimes(1);
    expect(onSidebarCancel).not.toHaveBeenCalled();
  });

  test("zoomAgentsView combo no longer triggers latch toggle", () => {
    const onReviewLatchToggle = mock(() => {});
    const onZoomStart = mock(() => {});
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      isInteractiveAgent: () => true,
      isMuxotronFocusActive: () => true,
      isReviewLatched: () => true,
      onReviewLatchToggle,
      onZoomEnd,
      onZoomStart,
    });
    const keybindings = new Map<string, KeyAction>([["alt+z", "zoomAgentsView"]]);

    routeKeyboardInput("\x1bz", () => {}, callbacks, keybindings);

    expect(onReviewLatchToggle).not.toHaveBeenCalled();
    // muxotronFocusActive is true, so it calls onZoomEnd (pure toggle behavior).
    expect(onZoomEnd).toHaveBeenCalledTimes(1);
  });
});

describe("agent review workflow shortcuts", () => {
  test("agentReviewGoto in preview mode fires onGotoAgent", () => {
    const onGotoAgent = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      onGotoAgent,
    });
    const keybindings = new Map<string, KeyAction>([["g", "agentReviewGoto"]]);

    // Kitty-encoded plain 'g' keypress — canonical lookup resolves to "g".
    routeKeyboardInput("\x1b[103u", writeToPty, callbacks, keybindings);

    expect(onGotoAgent).toHaveBeenCalledTimes(1);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("agentReviewGoto fires from sidebar-focused preview without unfocusing first", () => {
    const onGotoAgent = mock(() => {});
    const onSidebarCancel = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      isSidebarFocused: () => true,
      onGotoAgent,
      onSidebarCancel,
    });
    const keybindings = new Map<string, KeyAction>([["g", "agentReviewGoto"]]);

    routeKeyboardInput("\x1b[103u", writeToPty, callbacks, keybindings);

    expect(onGotoAgent).toHaveBeenCalledTimes(1);
    expect(onSidebarCancel).not.toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("agentReviewNext fires from sidebar-focused preview without unfocusing first", () => {
    const onAgentNext = mock(() => {});
    const onSidebarCancel = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => true,
      isMuxotronFocusActive: () => true,
      isSidebarFocused: () => true,
      onAgentNext,
      onSidebarCancel,
    });
    const keybindings = new Map<string, KeyAction>([["n", "agentReviewNext"]]);

    routeKeyboardInput("\x1b[110u", () => {}, callbacks, keybindings);

    expect(onAgentNext).toHaveBeenCalledTimes(1);
    expect(onSidebarCancel).not.toHaveBeenCalled();
  });

  test("agentReviewGoto when latched falls through to PTY", () => {
    const onGotoAgent = mock(() => {});
    const writeToPty = mock(() => {});
    const callbacks = createCallbacks({
      isAgentPreview: () => false,
      isInteractiveAgent: () => true,
      isReviewLatched: () => true,
      onGotoAgent,
    });
    const keybindings = new Map<string, KeyAction>([["g", "agentReviewGoto"]]);

    routeKeyboardInput("\x1b[103u", writeToPty, callbacks, keybindings);

    expect(onGotoAgent).not.toHaveBeenCalled();
    expect(writeToPty).toHaveBeenCalledWith("\x1b[103u");
  });
});

describe("zoom overlay input", () => {
  test("ignores modifier-only presses while zoom is active", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      isMuxotronFocusActive: () => true,
      matchZoomCode: () => null,
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57441;2:1u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).not.toHaveBeenCalled();
  });

  test("ignores non-zoom modifier releases while zoom is active", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      isMuxotronFocusActive: () => true,
      matchZoomCode: () => null,
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57441;2:3u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).not.toHaveBeenCalled();
  });

  test("still ends zoom on a non-sticky zoom modifier release", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      getActiveZoomAction: () => "zoomAgentsView",
      isMuxotronFocusActive: () => true,
      isZoomStickyAction: () => false,
      matchZoomCode: (code: number) => (code === 57447 ? "zoomAgentsView" : null),
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57447;2:3u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).toHaveBeenCalledTimes(1);
  });

  test("sticky zoom modifier dismisses when it matches the active zoom action", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      getActiveZoomAction: () => "zoomServerView",
      isMuxotronFocusActive: () => true,
      isZoomStickyAction: () => true,
      matchZoomCode: (code: number) => (code === 57448 ? "zoomServerView" : null),
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57448;5:1u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).toHaveBeenCalledTimes(1);
  });

  test("sticky non-active modifiers do not dismiss zoom", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      getActiveZoomAction: () => "zoomServerView",
      isMuxotronFocusActive: () => true,
      isZoomStickyAction: () => true,
      matchZoomCode: (code: number) => (code === 57447 ? "zoomAgentsView" : null),
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57447;2:1u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).not.toHaveBeenCalled();
  });

  test("zoom modifier press dismisses when active zoom action is null (focused muxotron)", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      getActiveZoomAction: () => null,
      isMuxotronFocusActive: () => true,
      isZoomStickyAction: () => false,
      matchZoomCode: (code: number) => (code === 57447 ? "zoomAgentsView" : null),
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57447;2:1u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).toHaveBeenCalledTimes(1);
  });

  test("zoom modifier press dismisses sticky zoom when active action is null", () => {
    const onZoomEnd = mock(() => {});
    const callbacks = createCallbacks({
      getActiveZoomAction: () => null,
      isMuxotronFocusActive: () => true,
      isZoomStickyAction: () => true,
      matchZoomCode: (code: number) => (code === 57447 ? "zoomAgentsView" : null),
      onZoomEnd,
    });

    const handled = routeKeyboardInput("\x1b[57447;2:1u", () => {}, callbacks, new Map());

    expect(handled).toBe(true);
    expect(onZoomEnd).toHaveBeenCalledTimes(1);
  });
});
