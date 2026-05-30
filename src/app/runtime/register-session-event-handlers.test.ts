import { describe, expect, mock, test } from "bun:test";

import type { TmuxWindow } from "../../tmux/types.ts";
import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

import { registerSessionEventHandlers } from "./register-session-event-handlers.ts";

class FakeTmuxClient {
  listClientsQueue: Array<Array<{ controlMode: boolean; name: string }>> = [];
  listClients = mock(async () => {
    if (this.listClientsQueue.length === 0) return [];
    return this.listClientsQueue.shift()!;
  });
  listPanesInWindowQueue: Array<Array<{ active: boolean; height: number; id: string; width: number }>> = [];
  listPanesInWindow = mock(async (_windowId: string) => {
    if (this.listPanesInWindowQueue.length === 0) return [];
    return this.listPanesInWindowQueue.shift()!;
  });
  listSessionsQueue: Array<Array<{ attached: boolean; color?: string; id: string; name: string }>> = [];
  listSessions = mock(async () => {
    if (this.listSessionsQueue.length === 0) return [];
    return this.listSessionsQueue.shift()!;
  });
  listWindowsQueue: TmuxWindow[][] = [];
  listWindows = mock(async () => {
    if (this.listWindowsQueue.length === 0) return [];
    return this.listWindowsQueue.shift()!;
  });
  refreshPtyClient = mock(async () => {});
  switchPtyClient = mock(async (_sessionName: string) => {});
  switchSession = mock(async (_sessionName: string) => {});
  private handlers = new Map<string, Array<(...args: any[]) => Promise<void> | void>>();
  async emit(event: string, ...args: any[]): Promise<void> {
    const callbacks = this.handlers.get(event) ?? [];
    for (const callback of callbacks) {
      await callback(...args);
    }
  }

  on(event: string, callback: (...args: any[]) => Promise<void> | void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(callback);
    this.handlers.set(event, existing);
  }
}

function createContext(): {
  activeIndexRef: { current: number };
  ctx: SetupTmuxRuntimeContext;
  currentSessionNameRef: { current: string };
  ptyKillMock: ReturnType<typeof mock>;
  ptyResizeMock: ReturnType<typeof mock>;
  rendererDestroyMock: ReturnType<typeof mock>;
  sessionsRef: { current: Array<{ attached: boolean; color?: string; id: string; name: string }> };
  setActiveIndexMock: ReturnType<typeof mock>;
  setCurrentSessionNameMock: ReturnType<typeof mock>;
  setSessionKeyMock: ReturnType<typeof mock>;
  setSessionsMock: ReturnType<typeof mock>;
  setWindowsMock: ReturnType<typeof mock>;
  windowsRef: { current: TmuxWindow[] };
} {
  const sessionsRef = { current: [] as Array<{ attached: boolean; color?: string; id: string; name: string }> };
  const windowsRef = { current: [] as TmuxWindow[] };
  const activeIndexRef = { current: 0 };
  const currentSessionNameRef = { current: "alpha" };

  const setSessionsMock = mock((next: any) => {
    sessionsRef.current = typeof next === "function" ? next(sessionsRef.current) : next;
  });
  const setWindowsMock = mock((next: any) => {
    windowsRef.current = typeof next === "function" ? next(windowsRef.current) : next;
  });
  const setActiveIndexMock = mock((next: any) => {
    activeIndexRef.current = typeof next === "function" ? next(activeIndexRef.current) : next;
  });
  const setCurrentSessionNameMock = mock((next: any) => {
    currentSessionNameRef.current = typeof next === "function" ? next(currentSessionNameRef.current) : next;
  });
  const setSessionKeyMock = mock((_next: any) => {});
  const ptyResizeMock = mock((_cols: number, _rows: number) => {});
  const ptyKillMock = mock(() => {});
  const rendererDestroyMock = mock(() => {});

  const activePaneIdRef = { current: null as null | string };
  const ctx = {
    agentRuntime: {
      activePaneIdRef,
      muxotronExpandedRef: { current: false },
      registryRef: { current: null },
      setActivePaneId: (paneId: null | string) => {
        activePaneIdRef.current = paneId;
      },
      setAgentSessions: (_value: unknown) => {},
      setClaudeDialogPending: (_value: unknown) => {},
      setCodexDialogPending: (_value: unknown) => {},
      setGeminiDialogPending: (_value: unknown) => {},
      setHookSnifferEvents: (_value: unknown) => {},
      setOpenCodeDialogPending: (_value: unknown) => {},
      storeRef: { current: null },
      uiModeRef: { current: "adaptive" as const },
    },
    configRuntime: {
      setConfig: (_value: unknown) => {},
      setConfigThemeBuiltin: (_value: unknown) => {},
      setConfigThemeMode: (_value: unknown) => {},
      setConfigUIMode: (_value: unknown) => {},
      setToolbarOpen: (_value: unknown) => {},
    },
    dialogs: {
      anyDialogOpenRef: { current: false },
      dialogInputRef: { current: (_data: string) => {} },
      dialogMenuToggleRef: { current: null },
      dropdownInputRef: { current: null },
      mainMenuCapturingRef: { current: false },
      optionsDialogCapturingRef: { current: false },
      setMainMenuDialogOpen: (_open: boolean) => {},
    },
    input: {
      handleActivateMenuRef: { current: () => {} },
      handleApplyFavoriteProfile: () => {},
      handleDismissRef: { current: () => {} },
      handleGotoAgentRef: { current: () => {} },
      handleLayoutProfileClick: () => {},
      handleNewPaneTabRef: { current: () => {} },
      handleNextPaneTabRef: { current: () => {} },
      handleNotificationsClickRef: { current: () => {} },
      handleOpenAgentsDialog: () => {},
      handleOpenConversationsRef: { current: () => {} },
      handleOptionsClickRef: { current: () => {} },
      handlePrevPaneTabRef: { current: () => {} },
      handleQuickApproveRef: { current: () => {} },

      handleQuickDenyRef: { current: () => {} },
      handleRedrawRef: { current: () => {} },
      handleSessionClickRef: { current: () => {} },
      handleTabNextRef: { current: () => {} },
      handleTabPrevRef: { current: () => {} },
      handleTextInputEscape: () => {},
      paneTabBorderClickRef: { current: null },
      sequenceMapRef: { current: new Map() },
      showHintRef: { current: null },
      tmuxPrefixKeyAliasRef: { current: null },
      tmuxPrefixSequenceRef: { current: null },
      writeFnRef: { current: (_data: string) => {} },
    },
    mouse: {
      agentsDialogOpenRef: { current: false },
      dropdownOpenRef: { current: false },
      ignoreMouseInputRef: { current: false },
      layoutDropdownOpenRef: { current: false },
      mainMenuDialogOpenRef: { current: false },
      muxotronExpandedRef: { current: false },
      overflowOpenRef: { current: false },
      overlayOpenRef: { current: false },
      paneTabBorderHitTestRef: { current: null },
      paneTabBorderRightClickRef: { current: null },
      paneTabDragEndRef: { current: null },
      paneTabDragMoveRef: { current: null },
      paneTabDraggingRef: { current: false },
      qtResizeDragEndRef: { current: null },
      qtResizeDragMoveRef: { current: null },
      qtResizeDraggingRef: { current: false },
      qtResizeSizeRef: { current: 90 },
      sidebarDragEndRef: { current: null },
      sidebarDragMoveRef: { current: null },
      sidebarDraggingRef: { current: false },
      sidebarOpenRef: { current: false },
      sidebarWidthRef: { current: 32 },
      statusBarBottomOffsetRef: { current: 0 },
      statusBarClickRef: { current: null },
      statusBarTopOffsetRef: { current: 0 },
      tabDragEndRef: { current: null },
      tabDragMoveRef: { current: null },
      tabDraggingRef: { current: false },
      tabPressOriginRef: { current: null },
      tabRightClickRef: { current: null },
      uiModeRef: { current: "adaptive" as const },
    },
    sessionRuntime: {
      clientRef: { current: null },
      deferredSessionRef: { current: null },
      detachingRef: { current: false },
      dimsRef: { current: { cols: 120, height: 40, rows: 40, width: 120 } },
      initTargetRef: { current: "alpha" },
      inputReady: { current: true },
      inputRouterSetup: { current: true },
      promptClickStateRef: { current: "unknown" as const },
      promptInputStartRef: { current: null },
      ptyRef: {
        current: {
          exited: Promise.resolve(0),
          kill: ptyKillMock,
          resize: ptyResizeMock,
          write: mock((_data: string) => {}),
        },
      },
      renderer: { destroy: rendererDestroyMock },
      spawnPtyBridge: (_target: string) => null,
      switchingRef: { current: new Set<string>() },
      terminalRef: { current: null },
      textInputActive: { current: false },
      tooNarrowRef: { current: false },
    },
    sessionState: {
      historyLoadStartedRef: { current: false },
      setActiveIndex: setActiveIndexMock,
      setConnected: (_value: unknown) => {},
      setCurrentSessionName: setCurrentSessionNameMock,
      setHistoryReady: (_value: unknown) => {},
      setKeyBindings: (_value: unknown) => {},
      setSessionKey: setSessionKeyMock,
      setSessions: setSessionsMock,
      setStatusBarInfo: (_value: unknown) => {},
      setWindows: setWindowsMock,
    },
  } as unknown as SetupTmuxRuntimeContext;

  return {
    activeIndexRef,
    ctx,
    currentSessionNameRef,
    ptyKillMock,
    ptyResizeMock,
    rendererDestroyMock,
    sessionsRef,
    setActiveIndexMock,
    setCurrentSessionNameMock,
    setSessionKeyMock,
    setSessionsMock,
    setWindowsMock,
    windowsRef,
  };
}

describe("registerSessionEventHandlers", () => {
  test("applies buffered rename after window-add refresh", async () => {
    const client = new FakeTmuxClient();
    const { ctx, windowsRef } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("window-renamed", "@2", "renamed-pane");
    client.listWindowsQueue.push([{ active: true, id: "@2", index: 1, layout: "abc", name: "old-name", paneId: "%2" }]);

    await client.emit("window-add", "@2");

    expect(windowsRef.current).toHaveLength(1);
    expect(windowsRef.current[0]!.name).toBe("renamed-pane");
  });

  test("syncs active tab and refreshes PTY on session-window-changed", async () => {
    const client = new FakeTmuxClient();
    const { activeIndexRef, ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    client.listWindowsQueue.push([
      { active: false, id: "@1", index: 1, layout: "abc", name: "one", paneId: "%1" },
      { active: true, id: "@2", index: 2, layout: "def", name: "two", paneId: "%2" },
    ]);
    client.listPanesInWindowQueue.push([
      { active: false, height: 20, id: "%2", width: 80 },
      { active: true, height: 20, id: "%7", width: 80 },
    ]);

    await client.emit("session-window-changed");
    expect(activeIndexRef.current).toBe(1);
    expect(ctx.agentRuntime.activePaneIdRef.current).toBe("%7");
    expect(client.refreshPtyClient).toHaveBeenCalledTimes(1);
  });

  test("keeps existing windows when window-add sees only staging windows", async () => {
    const client = new FakeTmuxClient();
    const { ctx, windowsRef } = createContext();
    windowsRef.current = [{ active: true, id: "@1", index: 1, layout: "abc", name: "main", paneId: "%1" }];
    registerSessionEventHandlers(client as any, ctx);

    client.listWindowsQueue.push([
      { active: false, id: "@2", index: 2, layout: "def", name: "_hmx_tab", paneId: "%2" },
    ]);

    await client.emit("window-add", "@2");

    expect(windowsRef.current).toEqual([
      { active: true, id: "@1", index: 1, layout: "abc", name: "main", paneId: "%1" },
    ]);
  });

  test("handles intentional session switch without exit path", async () => {
    const client = new FakeTmuxClient();
    const { ctx, currentSessionNameRef, rendererDestroyMock, sessionsRef } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    ctx.sessionRuntime.switchingRef.current.add("beta");
    client.listWindowsQueue.push([{ active: true, id: "@3", index: 1, layout: "ghi", name: "beta", paneId: "%3" }]);
    client.listPanesInWindowQueue.push([
      { active: false, height: 20, id: "%3", width: 80 },
      { active: true, height: 20, id: "%9", width: 80 },
    ]);
    client.listSessionsQueue.push([
      { attached: false, color: "#ff8b16", id: "$1", name: "alpha" },
      { attached: true, color: "#1c38ff", id: "$2", name: "beta" },
    ]);

    await client.emit("session-changed", "$2", "beta");

    expect(currentSessionNameRef.current).toBe("beta");
    expect(ctx.sessionRuntime.switchingRef.current.has("beta")).toBe(false);
    expect(sessionsRef.current).toEqual([
      { attached: false, color: "#ff8b16", id: "$1", name: "alpha" },
      { attached: true, color: "#1c38ff", id: "$2", name: "beta" },
    ]);
    expect(ctx.agentRuntime.activePaneIdRef.current).toBe("%9");
    expect(rendererDestroyMock).not.toHaveBeenCalled();
  });

  test("adopts external PTY-client switch to a known session", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    client.listClientsQueue.push([{ controlMode: false, name: "/dev/pts/3" }]);
    client.listSessionsQueue.push([
      { attached: false, color: "#ff8b16", id: "$1", name: "alpha" },
      { attached: false, color: "#1c38ff", id: "$2", name: "beta" },
    ]);

    await client.emit("client-session-changed", "/dev/pts/3", "$2", "beta");

    expect(ctx.sessionRuntime.switchingRef.current.has("beta")).toBe(true);
    expect(client.switchSession).toHaveBeenCalledWith("beta");
    expect(client.switchPtyClient).not.toHaveBeenCalled();
  });

  test("reverts external PTY-client switch to an unknown session", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    client.listClientsQueue.push([{ controlMode: false, name: "/dev/pts/3" }]);
    client.listSessionsQueue.push([{ attached: true, color: "#ff8b16", id: "$1", name: "alpha" }]);

    await client.emit("client-session-changed", "/dev/pts/3", "$9", "external-foo");

    expect(client.switchPtyClient).toHaveBeenCalledWith("alpha");
    expect(client.switchSession).not.toHaveBeenCalled();
    expect(ctx.sessionRuntime.switchingRef.current.size).toBe(0);
  });

  test("ignores client-session-changed when target equals attached session", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    await client.emit("client-session-changed", "/dev/pts/3", "$1", "alpha");

    expect(client.switchSession).not.toHaveBeenCalled();
    expect(client.switchPtyClient).not.toHaveBeenCalled();
  });

  test("ignores client-session-changed when target is an in-flight intentional switch", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    ctx.sessionRuntime.switchingRef.current.add("beta");

    await client.emit("client-session-changed", "/dev/pts/3", "$2", "beta");

    expect(client.switchSession).not.toHaveBeenCalled();
    expect(client.switchPtyClient).not.toHaveBeenCalled();
  });

  test("ignores client-session-changed before initial attach", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("client-session-changed", "/dev/pts/3", "$1", "alpha");

    expect(client.switchSession).not.toHaveBeenCalled();
    expect(client.switchPtyClient).not.toHaveBeenCalled();
  });

  test("ignores client-session-changed for hmx-internal overlay sessions", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    // Our own agent-pty-bridge PTY attaching to its overlay session would
    // emit %client-session-changed with a `__hmx-zoom-*` target. The control
    // client must stay put — adopting that switch creates a feedback loop
    // that flips activePaneId, unlatches the agent, kills the overlay, and
    // immediately re-creates it.
    await client.emit("client-session-changed", "/dev/pts/3", "$7", "__hmx-zoom-1700000000000");

    expect(client.switchSession).not.toHaveBeenCalled();
    expect(client.switchPtyClient).not.toHaveBeenCalled();
    expect(ctx.sessionRuntime.switchingRef.current.size).toBe(0);
  });

  test("ignores client-session-changed from control-mode clients (hmx aux observers)", async () => {
    const client = new FakeTmuxClient();
    const { ctx } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    // use-agent-pane-activity opens auxiliary control-mode clients on
    // non-primary sessions to forward %output back into the activity
    // tracker. Each one's `tmux -C attach-session` emits
    // %client-session-changed for the target session. The control client
    // must NOT chase those — doing so rotates the user's session through
    // every aux target in a never-ending loop.
    client.listClientsQueue.push([
      { controlMode: false, name: "/dev/pts/3" },
      { controlMode: true, name: "aux-beta" },
    ]);

    const sessionsBefore = client.listSessions.mock.calls.length;
    await client.emit("client-session-changed", "aux-beta", "$2", "beta");

    // Handler must bail before reaching the listSessions / switch* path.
    expect(client.listSessions.mock.calls.length).toBe(sessionsBefore);
    expect(client.switchSession).not.toHaveBeenCalled();
    expect(client.switchPtyClient).not.toHaveBeenCalled();
    expect(ctx.sessionRuntime.switchingRef.current.size).toBe(0);
  });

  test("ignores rename events for unattached background sessions", async () => {
    const client = new FakeTmuxClient();
    const { ctx, currentSessionNameRef } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$1", "alpha");
    await client.emit("session-renamed", "$2", "beta-renamed");

    expect(currentSessionNameRef.current).toBe("alpha");
  });

  test("refreshes cached sessions when the attached session is renamed", async () => {
    const client = new FakeTmuxClient();
    const { ctx, currentSessionNameRef, sessionsRef } = createContext();
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("session-changed", "$2", "codex-old");
    client.listSessionsQueue.push([
      { attached: true, color: "#1c38ff", id: "$2", name: "Codex" },
      { attached: false, color: "#ff8b16", id: "$0", name: "Claude" },
    ]);

    await client.emit("session-renamed", "$2", "Codex");

    expect(currentSessionNameRef.current).toBe("Codex");
    expect(sessionsRef.current).toEqual([
      { attached: true, color: "#1c38ff", id: "$2", name: "Codex" },
      { attached: false, color: "#ff8b16", id: "$0", name: "Claude" },
    ]);
  });

  test("on exit in too-narrow mode kills pty and avoids full shutdown", async () => {
    const client = new FakeTmuxClient();
    const { ctx, ptyKillMock, rendererDestroyMock } = createContext();
    ctx.sessionRuntime.tooNarrowRef.current = true;
    registerSessionEventHandlers(client as any, ctx);

    await client.emit("exit");

    expect(ptyKillMock).toHaveBeenCalledTimes(1);
    expect(ctx.sessionRuntime.ptyRef.current).toBeNull();
    expect(rendererDestroyMock).not.toHaveBeenCalled();
  });

  test("on exit with remaining sessions reinitializes without retargeting the old runtime", async () => {
    const client = new FakeTmuxClient();
    const { ctx, currentSessionNameRef, ptyKillMock, setCurrentSessionNameMock, setSessionKeyMock } = createContext();
    const originalSpawn = Bun.spawn;
    const encoder = new TextEncoder();

    const spawnMock = mock((_options: unknown) => {
      const stdout = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("beta\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
      return { exited: Promise.resolve(0), stderr, stdout } as unknown as ReturnType<typeof Bun.spawn>;
    });
    (Bun as any).spawn = spawnMock;

    try {
      registerSessionEventHandlers(client as any, ctx);

      await client.emit("exit");

      expect(ptyKillMock).toHaveBeenCalledTimes(1);
      expect(ctx.sessionRuntime.initTargetRef.current).toBe("beta");
      expect(currentSessionNameRef.current).toBe("alpha");
      expect(setCurrentSessionNameMock).not.toHaveBeenCalled();
      expect(setSessionKeyMock).toHaveBeenCalledTimes(1);
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });
});
