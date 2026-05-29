import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useMemo, useState } from "react";

import { theme } from "../themes/theme.ts";
import { padEndToWidth, stringWidth, stripNonPrintingControlChars } from "../util/text.ts";
import { DropdownFrame } from "./dropdown-shell.tsx";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

export interface PaneBorderMenuState {
  paneId: string;
  screenX: number;
  screenY: number;
}

interface BuildPaneBorderMainMenuItemsOptions {
  hasReadyRemoteServers: boolean;
  hasRemoteServers: boolean;
  paneInMultiTabGroup: boolean;
  paneTabsEnabled: boolean;
}

interface MainMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  hasReadyRemoteServers: boolean;
  hasRemoteServers: boolean;
  menu: PaneBorderMenuState;
  onAddPaneTab: () => void;
  onClose: () => void;
  onConvertToRemote: () => void;
  paneInMultiTabGroup: boolean;
  paneTabsEnabled: boolean;
}

type MenuMode = "main" | "server-select";

interface PaneBorderMainMenuItem {
  disabled: boolean;
  key: "convert-to-remote" | "new-tab";
  label: string;
}

interface PaneBorderMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  menu: PaneBorderMenuState | null;
  onAddPaneTab: (paneId: string) => void;
  onClose: () => void;
  onConvertToRemote: (paneId: string, serverName: string) => void;
  paneInMultiTabGroup: boolean;
  paneTabsEnabled: boolean;
  remoteServers: PaneBorderRemoteServer[];
}

interface PaneBorderRemoteServer {
  availability: PaneBorderRemoteServerAvailability;
  name: string;
}

type PaneBorderRemoteServerAvailability = "ready" | "unavailable" | "waiting";

// --- Main Menu ---

interface PaneBorderServerMenuItem {
  disabled: boolean;
  label: string;
  serverName: string;
}

interface ServerSelectMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  menu: PaneBorderMenuState;
  onBack: () => void;
  onClose: () => void;
  onSelect: (server: string) => void;
  servers: PaneBorderRemoteServer[];
}

export function PaneBorderMenu({
  dropdownInputRef,
  menu,
  onAddPaneTab,
  onClose,
  onConvertToRemote,
  paneInMultiTabGroup,
  paneTabsEnabled,
  remoteServers,
}: PaneBorderMenuProps) {
  const [mode, setMode] = useState<MenuMode>("main");
  const hasReadyRemoteServers = remoteServers.some((server) => server.availability === "ready");

  useEffect(() => {
    if (menu) setMode("main");
  }, [menu]);

  if (!menu) return null;

  if (mode === "server-select") {
    return (
      <ServerSelectMenu
        dropdownInputRef={dropdownInputRef}
        menu={menu}
        onBack={() => setMode("main")}
        onClose={onClose}
        onSelect={(server) => {
          onConvertToRemote(menu.paneId, server);
          onClose();
        }}
        servers={remoteServers}
      />
    );
  }

  return (
    <MainMenu
      dropdownInputRef={dropdownInputRef}
      hasReadyRemoteServers={hasReadyRemoteServers}
      hasRemoteServers={remoteServers.length > 0}
      menu={menu}
      onAddPaneTab={() => {
        onAddPaneTab(menu.paneId);
        onClose();
      }}
      onClose={onClose}
      onConvertToRemote={() => setMode("server-select")}
      paneInMultiTabGroup={paneInMultiTabGroup}
      paneTabsEnabled={paneTabsEnabled}
    />
  );
}

export function buildPaneBorderMainMenuItems({
  hasReadyRemoteServers,
  hasRemoteServers,
  paneInMultiTabGroup,
  paneTabsEnabled,
}: BuildPaneBorderMainMenuItemsOptions): PaneBorderMainMenuItem[] {
  // A multi-tab pane can't be safely converted: pane-tabs switches tabs with a
  // cross-window swap-pane, which moves the pane between windows; the
  // window-scoped mirror reconciles that move by killing and re-splitting the
  // remote peer, silently destroying the converted tab's remote shell. Require
  // the user to untab the pane first.
  const convertLabel = paneInMultiTabGroup
    ? "Convert to remote (untab first) "
    : hasRemoteServers && !hasReadyRemoteServers
      ? "Convert to remote (please wait) "
      : "Convert to remote  \u25b8";
  return [
    {
      disabled: !paneTabsEnabled,
      key: "new-tab",
      label: "New tab",
    },
    {
      disabled: paneInMultiTabGroup || !hasReadyRemoteServers,
      key: "convert-to-remote",
      label: convertLabel,
    },
  ];
}

export function buildPaneBorderServerMenuItems(servers: PaneBorderRemoteServer[]): PaneBorderServerMenuItem[] {
  return servers.map((server) => {
    const safeName = stripNonPrintingControlChars(server.name);
    return {
      disabled: server.availability !== "ready",
      label: server.availability === "waiting" ? `${safeName} (please wait)` : safeName,
      serverName: server.name,
    };
  });
}

export function getPaneBorderMenuItemWidth(labels: string[]): number {
  return Math.max(24, ...labels.map((label) => stringWidth(label) + 3));
}

// --- Server Select Sub-Menu ---

function MainMenu({
  dropdownInputRef,
  hasReadyRemoteServers,
  hasRemoteServers,
  menu,
  onAddPaneTab,
  onClose,
  onConvertToRemote,
  paneInMultiTabGroup,
  paneTabsEnabled,
}: MainMenuProps) {
  const items = buildPaneBorderMainMenuItems({
    hasReadyRemoteServers,
    hasRemoteServers,
    paneInMultiTabGroup,
    paneTabsEnabled,
  });

  const disabledIndices = useMemo(() => {
    const set = new Set<number>();
    items.forEach((item, i) => {
      if (item.disabled) set.add(i);
    });
    return set.size > 0 ? set : undefined;
  }, [items]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || item.disabled) return;

      switch (item.key) {
        case "convert-to-remote":
          onConvertToRemote();
          return;
        case "new-tab":
          onAddPaneTab();
          return;
      }
    },
    [items, onAddPaneTab, onConvertToRemote],
  );

  const { focusedIndex } = useDropdownKeyboard({
    disabledIndices,
    dropdownInputRef: dropdownInputRef!,
    isOpen: true,
    itemCount: items.length,
    onClose,
    onSelect: handleSelect,
  });

  const itemWidth = getPaneBorderMenuItemWidth(items.map((item) => item.label));
  const dropdownWidth = itemWidth + 2;

  return (
    <DropdownFrame
      backgroundColor={theme.bgChrome}
      height={items.length + 2}
      id="honeyshots:pane-border-menu"
      left={Math.max(0, menu.screenX - dropdownWidth)}
      onClickOutside={onClose}
      top={menu.screenY}
      width={dropdownWidth}
    >
      {items.map((item, i) => {
        const focused = i === focusedIndex;
        const fg = item.disabled ? theme.textDim : focused ? theme.textBright : theme.text;
        const bg = focused && !item.disabled ? theme.bgFocused : undefined;
        const prefix = focused ? " \u25B8 " : "   ";
        return (
          <text
            bg={bg}
            content={padEndToWidth(prefix + item.label, itemWidth)}
            fg={fg}
            key={item.key}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0 && !item.disabled) handleSelect(i);
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}

function ServerSelectMenu({ dropdownInputRef, menu, onBack, onClose, onSelect, servers }: ServerSelectMenuProps) {
  const items = buildPaneBorderServerMenuItems(servers);
  const disabledIndices = useMemo(() => {
    const set = new Set<number>();
    items.forEach((item, i) => {
      if (item.disabled) set.add(i);
    });
    return set.size > 0 ? set : undefined;
  }, [items]);
  const handleSelect = useCallback(
    (index: number) => {
      const item = items[index];
      if (item && !item.disabled) onSelect(item.serverName);
    },
    [items, onSelect],
  );

  const handleClose = useCallback(() => {
    onBack();
  }, [onBack]);

  const { focusedIndex } = useDropdownKeyboard({
    disabledIndices,
    dropdownInputRef: dropdownInputRef!,
    isOpen: true,
    itemCount: items.length,
    onClose: handleClose,
    onSelect: handleSelect,
  });

  const itemWidth = getPaneBorderMenuItemWidth(items.map((item) => item.label));
  const dropdownWidth = itemWidth + 2;

  return (
    <DropdownFrame
      backgroundColor={theme.bgChrome}
      height={items.length + 2}
      id="honeyshots:pane-border-server-menu"
      left={Math.max(0, menu.screenX - dropdownWidth)}
      onClickOutside={onClose}
      top={menu.screenY}
      width={dropdownWidth}
    >
      {items.map((item, i) => {
        const focused = i === focusedIndex;
        const fg = item.disabled ? theme.textDim : focused ? theme.textBright : theme.text;
        const bg = focused && !item.disabled ? theme.bgFocused : undefined;
        const prefix = focused ? " \u25B8 " : "   ";
        return (
          <text
            bg={bg}
            content={padEndToWidth(prefix + item.label, itemWidth)}
            fg={fg}
            key={item.serverName}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0 && !item.disabled) onSelect(item.serverName);
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}
