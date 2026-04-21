import type { TmuxWindow } from "../../tmux/types.ts";
import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

import { type TmuxControlClient, isTmuxServerReachable, listSessionNames } from "../../tmux/control-client.ts";
import { disableInputModesBeforeShutdown, shutdownRenderer } from "../../util/shutdown-renderer.ts";
import { syncActivePaneRef } from "./active-pane-sync.ts";
import { reportFatalError } from "./fatal-error-handler.ts";

export interface SessionEventHandlers {
  applyPendingRenames: (windows: TmuxWindow[]) => void;
}

export function registerSessionEventHandlers(
  client: TmuxControlClient,
  ctx: SetupTmuxRuntimeContext,
): SessionEventHandlers {
  const {
    agentRuntime: { activePaneIdRef },
    input: { validateTabGroups },
    sessionRuntime: { detachingRef, initTargetRef, ptyRef, renderer, switchingRef, tooNarrowRef },
    sessionState: { setActiveIndex, setCurrentSessionName, setSessionKey, setSessions, setWindows },
  } = ctx;

  /** Filter out internal staging windows (e.g. _hmx_staging) from window lists. */
  const filterStagingWindows = (windows: TmuxWindow[]): TmuxWindow[] =>
    windows.filter((w) => !w.name.startsWith("_hmx_"));

  // Buffer renames that arrive for windows not yet in state.
  const pendingRenames = new Map<string, string>();

  const applyPendingRenames = (windows: TmuxWindow[]) => {
    for (const [id, name] of pendingRenames) {
      const win = windows.find((w) => w.id === id);
      if (win) win.name = name;
    }
    pendingRenames.clear();
  };

  const refreshSessions = async () => {
    try {
      setSessions(await client.listSessions());
    } catch {
      // ignore — session state may be mid-transition
    }
  };

  // Window added — query full list to get all details.
  client.on("window-add", async (_windowId: string) => {
    try {
      const updated = await client.listWindows();
      applyPendingRenames(updated);
      const visible = filterStagingWindows(updated);
      // Guard: during rapid pane-tab operations the snapshot may transiently
      // contain only staging windows.  Don't clear the tab bar — a later
      // event will correct the state.
      if (visible.length === 0) return;
      setWindows(visible);
    } catch {
      // ignore — session may have been destroyed
    }
  });

  client.on("window-close", async (_windowId: string) => {
    // A closed window may have hosted a tab group's active pane —
    // validate tab groups so a surviving staging pane can be promoted.
    validateTabGroups();
    try {
      const updated = filterStagingWindows(await client.listWindows());
      if (updated.length === 0) {
        // Last window closed — session is ending, tmux will send %exit
        return;
      }
      setWindows(() => {
        setActiveIndex((prevIdx: number) => Math.min(prevIdx, updated.length - 1));
        return updated;
      });
    } catch {
      // Session likely destroyed — %exit will handle cleanup
    }
  });

  client.on("window-renamed", (_windowId: string, name: string) => {
    if (name.startsWith("_hmx_")) {
      // Window transitioned to staging — remove it from state so the tab bar
      // doesn't show a stale entry.  Preserve prev if removal would empty the
      // list (a subsequent session-window-changed will correct the state).
      setWindows((prev: TmuxWindow[]) => {
        const filtered = prev.filter((w) => w.id !== _windowId);
        return filtered.length > 0 ? filtered : prev;
      });
      return;
    }
    setWindows((prev: TmuxWindow[]) => {
      const found = prev.some((w) => w.id === _windowId);
      if (!found) {
        pendingRenames.set(_windowId, name);
        return prev;
      }
      return prev.map((w) => (w.id === _windowId ? { ...w, name } : w));
    });
  });

  // Active window changed in tmux — sync our tab index and force redraw.
  client.on("session-window-changed", async () => {
    try {
      const updated = filterStagingWindows(await client.listWindows());
      // Guard: don't clear the tab bar if the snapshot is transiently empty
      // (all windows are staging during a pane-tab switch).
      if (updated.length === 0) return;
      setWindows(updated);
      const activeWin = updated.find((w) => w.active);
      if (activeWin) {
        setActiveIndex(updated.indexOf(activeWin));
      }
      await syncActivePaneRef({
        activePaneIdRef,
        client,
        fallbackPaneId: activeWin?.paneId ?? null,
        windowId: activeWin?.id,
      });
      // Ask tmux to repaint the PTY client directly — avoids the
      // pane-layout drift that resize toggling causes.
      await client.refreshPtyClient();
    } catch {
      // ignore
    }
  });

  // Pane death (shell exit) triggers a layout-change — validate tab groups
  // so dead tabs are cleaned up and stale groups dissolved.
  client.on("layout-change", () => {
    validateTabGroups();
  });

  // If tmux switches our client to a different session, either handle
  // it (intentional switch) or exit (unexpected switch).
  let attachedSession: null | string = null;
  let attachedSessionId: null | string = null;
  // Session renamed — update local tracking so we don't lose the
  // current-session name when tmux renames the attached session.
  client.on("session-renamed", async (sessionId: string, newName: string) => {
    await refreshSessions();
    if (attachedSession !== null && attachedSessionId === sessionId) {
      attachedSession = newName;
      setCurrentSessionName(newName);
    }
  });

  client.on("session-changed", async (sessionId: string, name: string) => {
    if (attachedSession === null) {
      attachedSession = name; // initial attach
      attachedSessionId = sessionId;
      setCurrentSessionName(name);
      await refreshSessions();
    } else if (switchingRef.current.has(name)) {
      // Intentional session switch — update state
      attachedSession = name;
      attachedSessionId = sessionId;
      switchingRef.current.delete(name);
      setCurrentSessionName(name);
      await refreshSessions();
      try {
        const updated = filterStagingWindows(await client.listWindows());
        if (updated.length > 0) {
          setWindows(updated);
          const activeWin = updated.find((w) => w.active);
          if (activeWin) {
            setActiveIndex(updated.indexOf(activeWin));
          }
          await syncActivePaneRef({
            activePaneIdRef,
            client,
            fallbackPaneId: activeWin?.paneId ?? null,
            windowId: activeWin?.id,
          });
        }
      } catch {
        // ignore
      }
    } else if (name !== attachedSession && !tooNarrowRef.current) {
      const handled = reportFatalError({
        error: new Error(
          `tmux switched our client to session "${name}" without our request (expected "${attachedSession}")`,
        ),
        kind: "unexpected session switch",
        sessionName: attachedSession ?? undefined,
      });
      if (handled) return;
      await disableInputModesBeforeShutdown(renderer);
      await shutdownRenderer(renderer);

      process.exit(0);
    }
  });

  client.on("exit", async () => {
    // Null out ptyRef so the PTY stream-end handler returns early
    const oldPty = ptyRef.current;
    ptyRef.current = null;
    try {
      oldPty?.kill();
    } catch {
      // ignore
    }

    // If user explicitly detached, exit immediately
    if (detachingRef.current) {
      // Brief delay to let pending terminal responses (window geometry
      // reports etc.) drain through the input handler before we tear
      // down — prevents them echoing as garbage on the normal screen.
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      await disableInputModesBeforeShutdown(renderer);
      await shutdownRenderer(renderer);
      process.exit(0);
    }

    // Don't exit when too narrow — will reconnect when widened
    if (tooNarrowRef.current) return;

    // Check for remaining sessions on this server (all belong to this instance)
    let others: string[] = [];
    let listError: unknown = null;
    try {
      others = await listSessionNames();
      if (others.length > 0) {
        // Switch to first remaining session — triggers useEffect re-init.
        // Do not update currentSessionName here: hooks bound to the old runtime
        // may observe the new name and issue tmux commands before the new
        // control client has connected, which turns orderly session exit into a
        // late "Client closed" rejection.
        const candidate = others[0]!;
        initTargetRef.current = candidate;
        setSessionKey((k: number) => k + 1);
        return;
      }
    } catch (error) {
      listError = error;
    }

    // Distinguish "server died" from "user killed last session". Both reach
    // here with no remaining sessions, but `listSessionNames` swallows command
    // failures and returns [] when the server is gone, so an empty list alone
    // is ambiguous. Probe reachability directly — this only runs on the exit
    // path (never during steady-state operation), so it adds one extra tmux
    // spawn to a shutdown that was about to happen anyway.
    let fatalReason: null | string = null;
    if (listError !== null) {
      fatalReason = `listSessionNames failed: ${listError instanceof Error ? listError.message : String(listError)}`;
    } else if (others.length === 0 && !(await isTmuxServerReachable())) {
      fatalReason = "tmux server no longer responds (crashed or killed)";
    }

    if (fatalReason !== null) {
      const handled = reportFatalError({
        error: new Error(fatalReason),
        kind: "tmux server unreachable",
        sessionName: attachedSession ?? undefined,
      });
      if (handled) return;
    }

    // No other sessions — exit normally
    await disableInputModesBeforeShutdown(renderer);
    await shutdownRenderer(renderer);

    process.exit(0);
  });

  return { applyPendingRenames };
}
