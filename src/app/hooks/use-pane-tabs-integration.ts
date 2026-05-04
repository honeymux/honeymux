import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PaneBorderMenuState } from "../../components/pane-border-menu.tsx";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";

import { type PaneTabGroup, usePaneTabs } from "../pane-tabs/use-pane-tabs.ts";

interface PaneTabsIntegrationApi {
  closePaneBorderMenu: () => void;
  guardedSetConfigPaneTabsEnabled: (value: boolean) => void;
  handlePaneTabDisableCancel: () => void;
  handlePaneTabDisableConfirm: () => void;
  inactivePaneCount: number;
  openPaneBorderMenu: (paneId: string, screenX: number, screenY: number) => void;
  paneBorderMenu: PaneBorderMenuState | null;
  paneTabDisableConfirmButtonCol: number;
  paneTabDisableConfirmOpen: boolean;
  paneTabsApi: PaneTabsApi;
  setPaneTabDisableConfirmButtonCol: (col: number) => void;
}

interface UsePaneTabsIntegrationOptions {
  activeWindowIdRef: MutableRefObject<null | string>;
  connected: boolean;
  currentSessionName: string;
  enabled: boolean;
  refs: Pick<
    AppRuntimeRefs,
    "activePaneIdRef" | "clientRef" | "handleNewPaneTabRef" | "handleNextPaneTabRef" | "handlePrevPaneTabRef"
  >;
  runtimeKey: number;
  setConfigPaneTabsEnabled: (value: boolean) => void;
}

export function countInactivePaneTabs(groups: Map<string, PaneTabGroup>): number {
  let count = 0;
  for (const group of groups.values()) {
    count += group.tabs.length - 1;
  }
  return count;
}

export function shouldConfirmPaneTabsDisable(nextValue: boolean, inactivePaneCount: number): boolean {
  return !nextValue && inactivePaneCount > 0;
}

export function usePaneTabsIntegration({
  activeWindowIdRef,
  connected,
  currentSessionName,
  enabled,
  refs,
  runtimeKey,
  setConfigPaneTabsEnabled,
}: UsePaneTabsIntegrationOptions): PaneTabsIntegrationApi {
  const { activePaneIdRef, clientRef, handleNewPaneTabRef, handleNextPaneTabRef, handlePrevPaneTabRef } = refs;
  const paneTabsApi = usePaneTabs({
    activePaneIdRef,
    activeWindowIdRef,
    clientRef,
    connected,
    currentSessionName,
    enabled,
    runtimeKey,
  });

  handleNewPaneTabRef.current = paneTabsApi.handleNewPaneTab;
  handlePrevPaneTabRef.current = paneTabsApi.handlePrevPaneTab;
  handleNextPaneTabRef.current = paneTabsApi.handleNextPaneTab;

  const [paneBorderMenu, setPaneBorderMenu] = useState<PaneBorderMenuState | null>(null);
  const openPaneBorderMenu = useCallback((paneId: string, screenX: number, screenY: number) => {
    setPaneBorderMenu({ paneId, screenX, screenY });
  }, []);
  const closePaneBorderMenu = useCallback(() => {
    setPaneBorderMenu(null);
  }, []);
  paneTabsApi.onMenuButtonClickRef.current = openPaneBorderMenu;

  // Highlight the pane's ≡ glyph in accent color while its border menu is open.
  // The pane-border-format consults @hmx-pane-menu-open via a tmux conditional;
  // we toggle that per-pane user option and force a status redraw.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const paneId = paneBorderMenu?.paneId ?? null;
    if (!paneId) return;
    void (async () => {
      try {
        await client.setPaneUserOption(paneId, "@hmx-pane-menu-open", "1");
        await client.runCommand("refresh-client -S");
      } catch {}
    })();
    return () => {
      void (async () => {
        try {
          await client.setPaneUserOption(paneId, "@hmx-pane-menu-open", null);
          await client.runCommand("refresh-client -S");
        } catch {}
      })();
    };
  }, [clientRef, paneBorderMenu]);

  const [paneTabDisableConfirmOpen, setPaneTabDisableConfirmOpen] = useState(false);
  const [paneTabDisableConfirmButtonCol, setPaneTabDisableConfirmButtonCol] = useState(1);

  const inactivePaneCount = countInactivePaneTabs(paneTabsApi.paneTabGroups);

  const guardedSetConfigPaneTabsEnabled = useCallback(
    (value: boolean) => {
      if (shouldConfirmPaneTabsDisable(value, inactivePaneCount)) {
        setPaneTabDisableConfirmButtonCol(1);
        setPaneTabDisableConfirmOpen(true);
        return;
      }
      setConfigPaneTabsEnabled(value);
    },
    [inactivePaneCount, setConfigPaneTabsEnabled],
  );

  const handlePaneTabDisableConfirm = useCallback(() => {
    setPaneTabDisableConfirmOpen(false);
    setConfigPaneTabsEnabled(false);
  }, [setConfigPaneTabsEnabled]);

  const handlePaneTabDisableCancel = useCallback(() => {
    setPaneTabDisableConfirmOpen(false);
  }, []);

  const previousEnabledRef = useRef(enabled);
  useEffect(() => {
    if (!connected) return;
    if (enabled === previousEnabledRef.current) return;
    previousEnabledRef.current = enabled;
    const client = clientRef.current;
    if (!client) return;
    if (enabled) {
      client.enablePaneTabBorders();
    } else {
      client.disablePaneTabBorders();
    }
  }, [clientRef, connected, enabled]);

  return {
    closePaneBorderMenu,
    guardedSetConfigPaneTabsEnabled,
    handlePaneTabDisableCancel,
    handlePaneTabDisableConfirm,
    inactivePaneCount,
    openPaneBorderMenu,
    paneBorderMenu,
    paneTabDisableConfirmButtonCol,
    paneTabDisableConfirmOpen,
    paneTabsApi,
    setPaneTabDisableConfirmButtonCol,
  };
}
