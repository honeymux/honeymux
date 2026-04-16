import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useMemo, useState } from "react";

import { theme } from "../themes/theme.ts";
import { DropdownFrame } from "./dropdown-shell.tsx";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

export interface PaneBorderMenuState {
  paneId: string;
  screenX: number;
  screenY: number;
}

interface MainMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  hasRemoteServers: boolean;
  isRemotePane: boolean;
  menu: PaneBorderMenuState;
  onAddPaneTab: () => void;
  onClose: () => void;
  onConvertToRemote: () => void;
  onRevertToLocal: () => void;
  paneTabsEnabled: boolean;
}

type MenuMode = "main" | "server-select";

interface PaneBorderMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  menu: PaneBorderMenuState | null;
  onAddPaneTab: (paneId: string) => void;
  onClose: () => void;
  onConvertToRemote: (paneId: string, serverName: string) => void;
  onRevertToLocal: (paneId: string) => void;
  paneTabsEnabled: boolean;
  remotePaneServer: null | string; // non-null if this pane is already remote
  remoteServers: string[];
}

// --- Main Menu ---

interface ServerSelectMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  menu: PaneBorderMenuState;
  onBack: () => void;
  onClose: () => void;
  onSelect: (server: string) => void;
  servers: string[];
}

export function PaneBorderMenu({
  dropdownInputRef,
  menu,
  onAddPaneTab,
  onClose,
  onConvertToRemote,
  onRevertToLocal,
  paneTabsEnabled,
  remotePaneServer,
  remoteServers,
}: PaneBorderMenuProps) {
  const [mode, setMode] = useState<MenuMode>("main");

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
      hasRemoteServers={remoteServers.length > 0}
      isRemotePane={remotePaneServer !== null}
      menu={menu}
      onAddPaneTab={() => {
        onAddPaneTab(menu.paneId);
        onClose();
      }}
      onClose={onClose}
      onConvertToRemote={() => setMode("server-select")}
      onRevertToLocal={() => {
        onRevertToLocal(menu.paneId);
        onClose();
      }}
      paneTabsEnabled={paneTabsEnabled}
    />
  );
}

// --- Server Select Sub-Menu ---

function MainMenu({
  dropdownInputRef,
  hasRemoteServers,
  isRemotePane,
  menu,
  onAddPaneTab,
  onClose,
  onConvertToRemote,
  onRevertToLocal,
  paneTabsEnabled,
}: MainMenuProps) {
  const items: Array<{ action: () => void; disabled: boolean; label: string }> = [];

  items.push({
    action: onAddPaneTab,
    disabled: !paneTabsEnabled || isRemotePane,
    label: "New tab",
  });

  if (isRemotePane) {
    items.push({
      action: onRevertToLocal,
      disabled: false,
      label: "Revert to local",
    });
  } else {
    items.push({
      action: onConvertToRemote,
      disabled: !hasRemoteServers,
      label: "Convert to remote  \u25b8",
    });
  }

  const disabledIndices = useMemo(() => {
    const set = new Set<number>();
    items.forEach((item, i) => {
      if (item.disabled) set.add(i);
    });
    return set.size > 0 ? set : undefined;
  }, [!paneTabsEnabled, !hasRemoteServers, isRemotePane]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = items[index];
      if (item && !item.disabled) item.action();
    },
    [items],
  );

  const { focusedIndex } = useDropdownKeyboard({
    disabledIndices,
    dropdownInputRef: dropdownInputRef!,
    isOpen: true,
    itemCount: items.length,
    onClose,
    onSelect: handleSelect,
  });

  const itemWidth = 24;
  const dropdownWidth = itemWidth + 2;

  return (
    <DropdownFrame
      backgroundColor={theme.bgChrome}
      height={items.length + 2}
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
        const label = (prefix + item.label).padEnd(itemWidth);
        return (
          <text
            bg={bg}
            content={label}
            fg={fg}
            key={i}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0 && !item.disabled) item.action();
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}

function ServerSelectMenu({ dropdownInputRef, menu, onBack, onClose, onSelect, servers }: ServerSelectMenuProps) {
  const handleSelect = useCallback(
    (index: number) => {
      const server = servers[index];
      if (server) onSelect(server);
    },
    [servers, onSelect],
  );

  const handleClose = useCallback(() => {
    onBack();
  }, [onBack]);

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef: dropdownInputRef!,
    isOpen: true,
    itemCount: servers.length,
    onClose: handleClose,
    onSelect: handleSelect,
  });

  const maxLen = Math.max(...servers.map((s) => s.length), 10);
  const itemWidth = maxLen + 5;
  const dropdownWidth = itemWidth + 2;

  return (
    <DropdownFrame
      backgroundColor={theme.bgChrome}
      height={servers.length + 2}
      left={Math.max(0, menu.screenX - dropdownWidth)}
      onClickOutside={onClose}
      top={menu.screenY}
      width={dropdownWidth}
    >
      {servers.map((server, i) => {
        const focused = i === focusedIndex;
        const fg = focused ? theme.textBright : theme.text;
        const bg = focused ? theme.bgFocused : undefined;
        const prefix = focused ? " \u25B8 " : "   ";
        return (
          <text
            bg={bg}
            content={(prefix + server).padEnd(itemWidth)}
            fg={fg}
            key={server}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onSelect(server);
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}
