import { useCallback } from "react";

import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { TmuxSessionState, UiChromeState } from "./use-app-state-groups.ts";

export interface TabActionsApi {
  handleCloseWindow: (index: number) => void;
  handleMoveWindowToSession: (index: number, targetSession: string) => void;
  handleTabClick: (index: number) => void;
  handleTabNext: () => void;
  handleTabPrev: () => void;
  handleTabRename: (index: number, newName: string) => void;
  handleTabReorder: (fromIndex: number, toIndex: number) => void;
}

interface UseTabActionsOptions {
  paneTabsApi: PaneTabsApi;
  refs: AppRuntimeRefs;
  tmuxSessionState: TmuxSessionState;
  uiChromeState: UiChromeState;
}

export function useTabActions({
  paneTabsApi,
  refs,
  tmuxSessionState,
  uiChromeState,
}: UseTabActionsOptions): TabActionsApi {
  const { clientRef } = refs;
  const { setActiveIndex, setWindows } = tmuxSessionState;
  const { setDropdownOpen } = uiChromeState;
  const handleTabNext = useCallback(() => {
    setWindows((wins) => {
      setActiveIndex((prev) => {
        const next = prev + 1 >= wins.length ? 0 : prev + 1;
        const win = wins[next];
        if (win && clientRef.current) {
          clientRef.current.selectWindow(win.id).catch(() => {});
        }
        return next;
      });
      return wins;
    });
  }, [clientRef, setActiveIndex, setWindows]);

  const handleTabPrev = useCallback(() => {
    setWindows((wins) => {
      setActiveIndex((prev) => {
        const next = prev - 1 < 0 ? wins.length - 1 : prev - 1;
        const win = wins[next];
        if (win && clientRef.current) {
          clientRef.current.selectWindow(win.id).catch(() => {});
        }
        return next;
      });
      return wins;
    });
  }, [clientRef, setActiveIndex, setWindows]);

  const handleTabReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setWindows((wins) => {
        if (!wins[fromIndex] || !clientRef.current) return wins;
        const windowIds = wins.map((w) => w.id);
        clientRef.current
          .moveWindow(windowIds, fromIndex, toIndex)
          .then(() => {
            clientRef.current?.selectWindow(windowIds[fromIndex]!).catch(() => {});
          })
          .catch(() => {});

        // Optimistically update local state with move semantics.
        const updated = [...wins];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved!);
        setActiveIndex(toIndex);
        return updated;
      });
    },
    [clientRef, setActiveIndex, setWindows],
  );

  const handleTabClick = useCallback(
    (index: number) => {
      setDropdownOpen(false);
      setWindows((wins) => {
        setActiveIndex((prev) => {
          if (prev === index) return prev;
          const win = wins[index];
          if (win && clientRef.current) {
            clientRef.current.selectWindow(win.id).catch(() => {});
          }
          return index;
        });
        return wins;
      });
    },
    [clientRef, setActiveIndex, setDropdownOpen, setWindows],
  );

  const handleTabRename = useCallback(
    (index: number, newName: string) => {
      setWindows((wins) => {
        const win = wins[index];
        const trimmed = newName.trim();
        if (!win || !clientRef.current || trimmed === win.name) {
          return wins;
        }
        const paneTabGroup = paneTabsApi.getPaneTabGroupForWindow(win.id);
        if (paneTabGroup && (paneTabGroup.explicitWindowName != null || paneTabGroup.restoreAutomaticRename != null)) {
          void paneTabsApi.handleRenameManagedWindow(win.id, trimmed).catch(() => {});
          const activeTabLabel = paneTabGroup.tabs[paneTabGroup.activeIndex]?.label ?? win.name;
          const nextName = trimmed.length > 0 ? trimmed : activeTabLabel;
          return wins.map((w, i) => (i === index ? { ...w, name: nextName } : w));
        }
        if (trimmed.length === 0) {
          // Clear the custom name and let tmux auto-detect
          clientRef.current.enableAutomaticRename(win.id).catch(() => {});
          return wins;
        }
        clientRef.current.renameWindow(win.id, trimmed).catch(() => {});
        return wins.map((w, i) => (i === index ? { ...w, name: trimmed } : w));
      });
    },
    [clientRef, paneTabsApi, setWindows],
  );

  const handleCloseWindow = useCallback(
    (index: number) => {
      setWindows((wins) => {
        const win = wins[index];
        if (!win || !clientRef.current) return wins;
        clientRef.current.killWindow(win.id).catch(() => {});
        // Don't optimistically update — the window-close event will refresh the list
        return wins;
      });
    },
    [clientRef, setWindows],
  );

  const handleMoveWindowToSession = useCallback(
    (index: number, targetSession: string) => {
      setWindows((wins) => {
        const win = wins[index];
        if (!win || !clientRef.current) return wins;
        clientRef.current.moveWindowToSession(win.id, targetSession).catch(() => {});
        return wins;
      });
    },
    [clientRef, setWindows],
  );

  return {
    handleCloseWindow,
    handleMoveWindowToSession,
    handleTabClick,
    handleTabNext,
    handleTabPrev,
    handleTabRename,
    handleTabReorder,
  };
}
