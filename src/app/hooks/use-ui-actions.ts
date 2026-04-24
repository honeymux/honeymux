import type { CliRenderer } from "@opentui/core";
import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef } from "react";

import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { TmuxSessionState, UiChromeState } from "./use-app-state-groups.ts";
import type { LayoutProfilesApi } from "./use-layout-profiles.ts";
import type { OptionsWorkflowApi } from "./use-options-workflow.ts";

import { getNextSessionColor, theme } from "../../themes/theme.ts";
import {
  type BeamToken,
  type PaneBorderLines,
  computeHoneybeamMaxCol,
  computeHoneybeamOffsets,
  runHoneybeamAnimation,
} from "../../util/honeybeam-animation.ts";
import { writeTerminalOutput } from "../../util/terminal-output.ts";
import { CLEAR_SCREEN_AND_SCROLLBACK } from "../../util/terminal-sequences.ts";
import { refreshAttachedTmuxClient } from "../runtime/tmux-client-resync.ts";
import {
  PANE_TAB_STATE_OPTION,
  type PaneTabPersistState,
  parsePaneTabStateText,
} from "../services/session-persistence.ts";

export interface UiActionsApi {
  beamPromiseRef: MutableRefObject<Promise<void> | null>;
  beamTokenRef: MutableRefObject<BeamToken | null>;
  handleClosePane: () => void;
  handleCreateSession: (name: string) => Promise<void>;
  handleDeleteSession: (name: string) => Promise<void>;
  handleDetach: () => void;
  handleGetSessionInfo: (name: string) => Promise<{ paneTabsEnabled: number; panes: number; windows: number }>;
  handleNewWindow: () => void;
  handleRedraw: () => void;
  handleRenameSession: (oldName: string, newName: string) => Promise<void>;
  handleSessionClick: () => Promise<void>;
  handleSessionNext: () => void;
  handleSessionPrev: () => void;
  handleSessionSelect: (newSessionName: string) => Promise<void>;
  handleSetSessionColor: (sessionName: string, color: null | string) => Promise<void>;
  handleSplitHorizontal: () => void;
  handleSplitVertical: () => void;
  handleTextInputActive: (active: boolean) => void;
  handleTextInputEscape: () => void;
}

type GhosttyTerminalWithDirtyFlag = {
  _ansiDirty?: boolean;
};

type HoneybeamTopologyClient = {
  off(event: string, handler: () => void): unknown;
  on(event: string, handler: () => void): unknown;
};

interface UseUiActionsOptions {
  layoutProfiles: LayoutProfilesApi;
  optionsWorkflow: OptionsWorkflowApi;
  refs: AppRuntimeRefs;
  renderer: CliRenderer;
  tmuxSessionState: TmuxSessionState;
  uiChromeState: UiChromeState;
}

const HONEYBEAM_TOPOLOGY_CHANGE_EVENTS = ["layout-change", "session-window-changed", "window-pane-changed"] as const;
const HONEYBEAM_TOPOLOGY_CHANGE_TIMEOUT_MS = 250;

export function summarizeSessionInfo(
  sessionInfo: {
    paneTabActive: Set<string>;
    paneTabMembers: Set<string>;
    paneWindowIds: Map<string, string>;
    windowNames: Map<string, string>;
    windowPanes: Map<string, number>;
  },
  tabState: PaneTabPersistState | null,
): { paneTabsEnabled: number; panes: number; windows: number } {
  if (sessionInfo.paneTabMembers.size > 0 || sessionInfo.paneTabActive.size > 0) {
    const hiddenWindowIds = new Set<string>();
    for (const paneId of sessionInfo.paneTabMembers) {
      const windowId = sessionInfo.paneWindowIds.get(paneId);
      if (!windowId) continue;
      if (!sessionInfo.paneTabActive.has(paneId)) {
        hiddenWindowIds.add(windowId);
      }
    }

    let windows = 0;
    let panes = 0;
    for (const [windowId, paneCount] of sessionInfo.windowPanes) {
      if (hiddenWindowIds.has(windowId)) continue;
      windows++;
      panes += paneCount;
    }
    return { paneTabsEnabled: sessionInfo.paneTabMembers.size, panes, windows };
  }

  const internalWindowIds = new Set<string>();
  for (const [windowId, windowName] of sessionInfo.windowNames) {
    if (windowName.startsWith("_hmx_")) internalWindowIds.add(windowId);
  }

  let windows = 0;
  let panes = 0;
  for (const [windowId, paneCount] of sessionInfo.windowPanes) {
    if (internalWindowIds.has(windowId)) continue;
    windows++;
    panes += paneCount;
  }

  let paneTabsEnabled = 0;
  for (const group of tabState?.groups ?? []) {
    const liveTabs = group.tabs.filter((tab) => sessionInfo.paneWindowIds.has(tab.paneId));
    if (liveTabs.length === 0) continue;
    paneTabsEnabled += liveTabs.length;
  }

  return { paneTabsEnabled, panes, windows };
}

export function useUiActions({
  layoutProfiles,
  optionsWorkflow,
  refs,
  renderer,
  tmuxSessionState,
  uiChromeState,
}: UseUiActionsOptions): UiActionsApi {
  const {
    clientRef,
    dimsRef,
    dropdownInputRef,
    ptyRef,
    terminalRef,
    textInputActive: textInputActiveRef,
    textInputEscapeHandlerRef,
  } = refs;
  const { currentSessionName, detachingRef, setCurrentSessionName, setSessions, switchingRef } = tmuxSessionState;
  const { dropdownOpen, setDropdownOpen, sidebarOpen, sidebarWidth, toolbarOpen } = uiChromeState;
  const { setLayoutDropdownOpen } = layoutProfiles;
  const { config } = optionsWorkflow;
  const handleSessionClick = useCallback(async () => {
    if (dropdownOpen) {
      dropdownInputRef.current = null;
      setDropdownOpen(false);
      return;
    }
    dropdownInputRef.current = null;
    setLayoutDropdownOpen(false);
    const client = clientRef.current;
    if (!client) return;
    try {
      const sessionList = await client.listSessions();
      setSessions(sessionList);
      setDropdownOpen(true);
    } catch {
      // ignore
    }
  }, [clientRef, dropdownInputRef, dropdownOpen, setDropdownOpen, setLayoutDropdownOpen, setSessions]);

  // Text input active toggle (for input router gate)
  const handleTextInputActive = useCallback(
    (active: boolean) => {
      textInputActiveRef.current = active;
    },
    [textInputActiveRef],
  );

  // Escape pressed while text input is active — close dropdown
  const handleTextInputEscape = useCallback(() => {
    textInputEscapeHandlerRef.current?.();
    textInputEscapeHandlerRef.current = null;
    textInputActiveRef.current = false;
    dropdownInputRef.current = null;
    setDropdownOpen(false);
    setLayoutDropdownOpen(false);
  }, [dropdownInputRef, setDropdownOpen, setLayoutDropdownOpen, textInputActiveRef, textInputEscapeHandlerRef]);

  // Serialize session switches — only one switch may be in-flight at a time.
  // Rapid keypresses that arrive while a switch is running are coalesced:
  // only the most recent target is kept and executed after the current switch.
  const switchActiveRef = useRef(false);
  const pendingSessionRef = useRef<null | string>(null);

  // Session switch handler (serialized + throttled).
  // Switches BOTH the control client and the PTY client to the new session
  // without killing/respawning the PTY.  Keeping the same PTY connection
  // alive avoids tmux server races from rapid attach/detach cycles and
  // prevents ghostty VT parser state corruption from interrupted data streams.
  //
  // A cooldown between consecutive switches prevents rapid-fire tmux
  // commands that can crash the tmux server.
  const handleSessionSelect = useCallback(
    async (newSessionName: string) => {
      dropdownInputRef.current = null;
      setDropdownOpen(false);

      if (switchActiveRef.current) {
        // A switch is already running — queue the latest target
        pendingSessionRef.current = newSessionName;
        return;
      }

      switchActiveRef.current = true;
      try {
        // Track the effective current session across loop iterations since
        // currentSessionName (React state) won't update within this async call.
        let effectiveSession = currentSessionName;
        let target: null | string = newSessionName;

        while (target !== null) {
          if (target === effectiveSession) break;
          const client = clientRef.current;
          if (!client) break;

          pendingSessionRef.current = null;

          // Flag intentional switch so session-changed handler doesn't exit.
          switchingRef.current.add(target);

          try {
            // Switch control client to the new session
            await client.switchSession(target);
            // Switch the PTY client to the same session in-place — tmux
            // redraws the new session content without dropping the connection.
            await client.switchPtyClient(target);
          } catch {
            switchingRef.current.delete(target);
            break;
          }

          effectiveSession = target;

          // Pick up the latest pending target (last-write-wins)
          target = pendingSessionRef.current;
          pendingSessionRef.current = null;
        }
      } finally {
        switchActiveRef.current = false;
      }
    },
    [clientRef, currentSessionName, dropdownInputRef, setDropdownOpen, switchingRef],
  );

  // Cycle to adjacent session (by delta: +1 = next, -1 = prev)
  const cycleSession = useCallback(
    async (delta: number) => {
      // Skip if a switch is already in-flight — avoids flooding the
      // control client with list-sessions queries during rapid pressing.
      if (switchActiveRef.current) return;
      const client = clientRef.current;
      if (!client) return;
      try {
        const sessionList = await client.listSessions();
        if (sessionList.length < 2) return;
        const idx = sessionList.findIndex((s) => s.name === currentSessionName);
        if (idx < 0) return;
        const nextIdx = (idx + delta + sessionList.length) % sessionList.length;
        const target = sessionList[nextIdx];
        if (target && target.name !== currentSessionName) {
          await handleSessionSelect(target.name);
        }
      } catch {
        // ignore
      }
    },
    [clientRef, currentSessionName, handleSessionSelect],
  );

  const handleSessionNext = useCallback(() => {
    cycleSession(1);
  }, [cycleSession]);
  const handleSessionPrev = useCallback(() => {
    cycleSession(-1);
  }, [cycleSession]);

  // Create new session handler
  const handleCreateSession = useCallback(
    async (name: string) => {
      dropdownInputRef.current = null;
      setDropdownOpen(false);
      textInputActiveRef.current = false;
      const client = clientRef.current;
      if (!client) return;
      try {
        const cwd = await client.getActivePaneCwd();
        const sessionName = await client.createSession(name || undefined, cwd);
        // Auto-assign a color from the palette based on what other sessions use
        const existing = await client.listSessions();
        const color = getNextSessionColor(existing.filter((s) => s.name !== sessionName).map((s) => s.color));
        await client.setSessionColor(sessionName, color);
        // Refresh session list so the badge picks up the new color immediately
        const updated = await client.listSessions();
        setSessions(updated);
        await handleSessionSelect(sessionName);
      } catch {
        // ignore
      }
    },
    [clientRef, dropdownInputRef, handleSessionSelect, setDropdownOpen, setSessions, textInputActiveRef],
  );

  // Rename session handler
  const handleRenameSession = useCallback(
    async (oldName: string, newName: string) => {
      dropdownInputRef.current = null;
      setDropdownOpen(false);
      textInputActiveRef.current = false;
      const client = clientRef.current;
      if (!client) return;
      try {
        await client.renameSession(oldName, newName);
        if (oldName === currentSessionName) {
          setCurrentSessionName(newName);
        }
        const sessionList = await client.listSessions();
        setSessions(sessionList);
      } catch {
        // ignore
      }
    },
    [
      clientRef,
      currentSessionName,
      dropdownInputRef,
      setCurrentSessionName,
      setDropdownOpen,
      setSessions,
      textInputActiveRef,
    ],
  );

  const handleDeleteSession = useCallback(
    async (name: string) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        await client.killSession(name);
        const sessionList = await client.listSessions();
        setSessions(sessionList);
      } catch {
        // ignore
      }
    },
    [clientRef, setSessions],
  );

  const handleGetSessionInfo = useCallback(
    async (name: string): Promise<{ paneTabsEnabled: number; panes: number; windows: number }> => {
      const client = clientRef.current;
      if (!client) return { paneTabsEnabled: 0, panes: 0, windows: 0 };
      try {
        return summarizeSessionInfo(
          await client.getSessionInfo(name),
          parsePaneTabStateText(await client.getSessionUserOption(name, PANE_TAB_STATE_OPTION)),
        );
      } catch {
        return { paneTabsEnabled: 0, panes: 0, windows: 0 };
      }
    },
    [clientRef],
  );

  const handleNewWindow = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      client
        .getActivePaneCwd()
        .then((cwd) => client.newWindow(cwd).catch(() => {}))
        .catch(() => client.newWindow().catch(() => {}));
    }
  }, [clientRef]);

  // Cancel-and-chain mechanism for honeybeam animations.
  // When a new split is requested, any in-progress animation is cancelled.
  // The new animation is chained after the previous split completes so it
  // queries fresh geometry.
  const beamTokenRef = useRef<BeamToken | null>(null);
  const beamPromiseRef = useRef<Promise<void> | null>(null);
  const forceHoneybeamResync = useCallback(() => {
    if (terminalRef.current) {
      (terminalRef.current as unknown as GhosttyTerminalWithDirtyFlag)._ansiDirty = true;
    }
    renderer.currentRenderBuffer.clear();
    renderer.requestRender();
  }, [renderer, terminalRef]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const cancelBeam = () => {
      if (!beamTokenRef.current || beamTokenRef.current.cancelled) return;
      beamTokenRef.current.cancelled = true;
      forceHoneybeamResync();
      void refreshAttachedTmuxClient({
        client,
        dims: dimsRef.current,
        pty: ptyRef.current,
      });
    };

    client.on("layout-change", cancelBeam);
    client.on("session-window-changed", cancelBeam);
    client.on("window-pane-changed", cancelBeam);

    return () => {
      client.off("layout-change", cancelBeam);
      client.off("session-window-changed", cancelBeam);
      client.off("window-pane-changed", cancelBeam);
    };
  }, [clientRef, dimsRef, forceHoneybeamResync, ptyRef]);

  const handleSplitVertical = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    if (config.honeybeamsEnabled === false || !terminalRef.current) {
      client
        .getActivePaneCwd()
        .then((cwd) => client.splitVertical(undefined, cwd).catch(() => {}))
        .catch(() => client.splitVertical().catch(() => {}));
      return;
    }

    if (beamTokenRef.current) {
      beamTokenRef.current.cancelled = true;
      forceHoneybeamResync();
    }
    const token: BeamToken = { cancelled: false };
    beamTokenRef.current = token;
    let tmuxHandledRepaint = false;

    // Race previous chain against a timeout so a stuck chain can't
    // permanently block future splits.
    const prev = Promise.race([
      beamPromiseRef.current ?? Promise.resolve(),
      new Promise<void>((r) => setTimeout(r, 2000)),
    ]);

    beamPromiseRef.current = prev
      .then(() => {
        if (token.cancelled) return;
        const dims = dimsRef.current;
        const sidebarOff = sidebarOpen ? sidebarWidth + 1 : 0;
        const { colOffset, rowOffset } = computeHoneybeamOffsets(dims, sidebarOff);
        const maxCol = computeHoneybeamMaxCol(dims, toolbarOpen, sidebarOff);
        const borderLinesP = client.getPaneBorderLines().catch(() => "single");
        return client
          .getActivePaneScreenshotInfo()
          .then((paneInfo) =>
            borderLinesP.then((borderLines) =>
              runHoneybeamAnimation(
                {
                  accentColor: theme.accent,
                  borderLines: borderLines as PaneBorderLines,
                  colOffset,
                  direction: "vertical",
                  maxCol,
                  paneHeight: paneInfo.height,
                  paneLeft: paneInfo.left,
                  paneTop: paneInfo.top,
                  paneWidth: paneInfo.width,
                  rowOffset,
                },
                token,
              ).then(async () => {
                if (token.cancelled) return;
                const topologyChange = waitForNextHoneybeamTopologyChange(client);
                await client.splitVertical(paneInfo.paneId, paneInfo.cwd);
                tmuxHandledRepaint = true;
                await topologyChange;
                await refreshAttachedTmuxClient({
                  client,
                  dims: dimsRef.current,
                  pty: ptyRef.current,
                });
              }),
            ),
          )
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (!tmuxHandledRepaint) forceHoneybeamResync();
        if (beamTokenRef.current === token) beamTokenRef.current = null;
      });
  }, [
    clientRef,
    config.honeybeamsEnabled,
    dimsRef,
    forceHoneybeamResync,
    ptyRef,
    toolbarOpen,
    sidebarOpen,
    sidebarWidth,
  ]);

  const handleSplitHorizontal = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    if (config.honeybeamsEnabled === false || !terminalRef.current) {
      client
        .getActivePaneCwd()
        .then((cwd) => client.splitHorizontal(undefined, cwd).catch(() => {}))
        .catch(() => client.splitHorizontal().catch(() => {}));
      return;
    }

    if (beamTokenRef.current) {
      beamTokenRef.current.cancelled = true;
      forceHoneybeamResync();
    }
    const token: BeamToken = { cancelled: false };
    beamTokenRef.current = token;
    let tmuxHandledRepaint = false;

    const prev = Promise.race([
      beamPromiseRef.current ?? Promise.resolve(),
      new Promise<void>((r) => setTimeout(r, 2000)),
    ]);

    beamPromiseRef.current = prev
      .then(() => {
        if (token.cancelled) return;
        const dims = dimsRef.current;
        const sidebarOff = sidebarOpen ? sidebarWidth + 1 : 0;
        const { colOffset, rowOffset } = computeHoneybeamOffsets(dims, sidebarOff);
        const maxCol = computeHoneybeamMaxCol(dims, toolbarOpen, sidebarOff);
        const borderLinesP = client.getPaneBorderLines().catch(() => "single");
        return client
          .getActivePaneScreenshotInfo()
          .then((paneInfo) =>
            borderLinesP.then((borderLines) =>
              runHoneybeamAnimation(
                {
                  accentColor: theme.accent,
                  borderLines: borderLines as PaneBorderLines,
                  colOffset,
                  direction: "horizontal",
                  maxCol,
                  paneHeight: paneInfo.height,
                  paneLeft: paneInfo.left,
                  paneTop: paneInfo.top,
                  paneWidth: paneInfo.width,
                  rowOffset,
                },
                token,
              ).then(async () => {
                if (token.cancelled) return;
                const topologyChange = waitForNextHoneybeamTopologyChange(client);
                await client.splitHorizontal(paneInfo.paneId, paneInfo.cwd);
                tmuxHandledRepaint = true;
                await topologyChange;
                await refreshAttachedTmuxClient({
                  client,
                  dims: dimsRef.current,
                  pty: ptyRef.current,
                });
              }),
            ),
          )
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (!tmuxHandledRepaint) forceHoneybeamResync();
        if (beamTokenRef.current === token) beamTokenRef.current = null;
      });
  }, [
    clientRef,
    config.honeybeamsEnabled,
    dimsRef,
    forceHoneybeamResync,
    ptyRef,
    toolbarOpen,
    sidebarOpen,
    sidebarWidth,
  ]);

  const handleClosePane = useCallback(() => {
    clientRef.current?.killPane().catch(() => {});
  }, [clientRef]);

  const handleDetach = useCallback(() => {
    detachingRef.current = true;
    clientRef.current?.detach().catch(() => {});
  }, [clientRef, detachingRef]);

  // Set or clear a session's color (stored as tmux user option @hmx-color)
  const handleSetSessionColor = useCallback(
    async (sessionName: string, color: null | string) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        if (color === null) {
          // "Reset to Default": pick the next auto-assigned color based on what
          // other sessions are using (exclude this session's current color).
          const sessions = await client.listSessions();
          const otherColors = sessions.filter((s) => s.name !== sessionName).map((s) => s.color);
          color = getNextSessionColor(otherColors);
        }
        await client.setSessionColor(sessionName, color);
        // Refresh session list so the UI picks up the change
        const sessionList = await client.listSessions();
        setSessions(sessionList);
      } catch {
        // ignore
      }
    },
    [clientRef, setSessions],
  );

  // Force a full TUI redraw (recovers from Cmd-K / clear screen in iTerm2 etc.)
  const handleRedraw = useCallback(() => {
    // Mark terminal content dirty so ghostty re-renders from its internal buffer
    if (terminalRef.current) {
      (terminalRef.current as unknown as GhosttyTerminalWithDirtyFlag)._ansiDirty = true;
    }

    // Wipe the real terminal in the same breath as the render buffer so the
    // two stay in sync. Without the terminal-side clear, cells that are
    // blank in both the freshly-cleared currentRenderBuffer and the next
    // render (e.g. where a dialog just unmounted and nothing else paints)
    // would diff as "unchanged" and the stale dialog chrome would remain on
    // screen. ESC[0m first so the erase uses default SGR, not whatever was
    // last active. Safe on alt screen; tracks buffer-zoom's sequence.
    writeTerminalOutput("\x1b[0m" + CLEAR_SCREEN_AND_SCROLLBACK);
    renderer.currentRenderBuffer.clear();
    renderer.requestRender();

    void refreshAttachedTmuxClient({
      client: clientRef.current,
      dims: dimsRef.current,
      pty: ptyRef.current,
    });
  }, [clientRef, dimsRef, ptyRef, renderer, terminalRef]);

  return {
    beamPromiseRef,
    beamTokenRef,
    handleClosePane,
    handleCreateSession,
    handleDeleteSession,
    handleDetach,
    handleGetSessionInfo,
    handleNewWindow,
    handleRedraw,
    handleRenameSession,
    handleSessionClick,
    handleSessionNext,
    handleSessionPrev,
    handleSessionSelect,
    handleSetSessionColor,
    handleSplitHorizontal,
    handleSplitVertical,
    handleTextInputActive,
    handleTextInputEscape,
  };
}

export function waitForNextHoneybeamTopologyChange(
  client: HoneybeamTopologyClient,
  timeoutMs = HONEYBEAM_TOPOLOGY_CHANGE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      for (const event of HONEYBEAM_TOPOLOGY_CHANGE_EVENTS) {
        client.off(event, finish);
      }
      resolve();
    };
    const timeoutId = setTimeout(finish, timeoutMs);
    for (const event of HONEYBEAM_TOPOLOGY_CHANGE_EVENTS) {
      client.on(event, finish);
    }
  });
}
