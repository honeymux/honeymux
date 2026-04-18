import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PaneTabsApi } from "../app/pane-tabs/use-pane-tabs.ts";

import { theme } from "../themes/theme.ts";
import { padEndToWidth, stringWidth, stripNonPrintingControlChars } from "../util/text.ts";
import { DropdownFrame, DropdownInputPanel } from "./dropdown-shell.tsx";
import { claimSharedInputHandler, releaseSharedInputHandler } from "./shared-input-handler.ts";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

type MenuItem = "close" | "rename";

interface PaneTabContextMenuProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  onTextInputActive?: (active: boolean) => void;
  paneTabsApi: PaneTabsApi;
  textInputEscapeHandlerRef?: React.MutableRefObject<(() => void) | null>;
  width: number;
}
const MENU_LABELS: Record<MenuItem, string> = {
  close: "Close tab",
  rename: "Rename tab",
};

export function PaneTabContextMenu({
  dropdownInputRef,
  onTextInputActive,
  paneTabsApi,
  textInputEscapeHandlerRef,
  width,
}: PaneTabContextMenuProps) {
  const { closePaneTabContextMenu, paneTabContextMenu, paneTabGroups } = paneTabsApi;
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const renameInputRef = useRef<any>(null);
  const renameDropdownHandlerRef = useRef<((data: string) => boolean) | null>(null);
  const renameEscapeHandlerRef = useRef<(() => void) | null>(null);

  // Reset mode when context menu opens/closes
  useEffect(() => {
    if (paneTabContextMenu) setMode("menu");
  }, [paneTabContextMenu]);

  const group = paneTabContextMenu ? paneTabGroups.get(paneTabContextMenu.slotKey) : undefined;
  const tab = group && paneTabContextMenu ? group.tabs[paneTabContextMenu.tabIndex] : undefined;
  const canClose = (group?.tabs.length ?? 0) > 1;

  // Build visible menu items — "close" is only shown when the group has >1 tab.
  const menuItems: MenuItem[] = canClose ? ["rename", "close"] : ["rename"];
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;

  const close = useCallback(() => {
    releaseSharedInputHandler(dropdownInputRef, renameDropdownHandlerRef);
    releaseSharedInputHandler(textInputEscapeHandlerRef, renameEscapeHandlerRef);
    closePaneTabContextMenu();
    onTextInputActive?.(false);
  }, [closePaneTabContextMenu, dropdownInputRef, onTextInputActive, textInputEscapeHandlerRef]);

  const handleSelect = useCallback(
    (index: number) => {
      const item = menuItemsRef.current[index];
      if (!item || !paneTabContextMenu || !group) return;
      if (item === "rename") {
        setMode("rename");
        onTextInputActive?.(true);
      } else if (item === "close") {
        paneTabsApi.handleClosePaneTabAt(paneTabContextMenu.slotKey, paneTabContextMenu.tabIndex);
        close();
      }
    },
    [paneTabContextMenu, group, paneTabsApi, close, onTextInputActive],
  );

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  const menuDropdownInputRef = useRef<((data: string) => boolean) | null>(null);

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef: menuDropdownInputRef,
    isOpen: !!paneTabContextMenu && mode === "menu",
    itemCount: menuItems.length,
    onClose: handleClose,
    onSelect: handleSelect,
  });

  // Wire menu input through the shared dropdownInputRef
  useEffect(() => {
    if (!paneTabContextMenu || mode !== "menu" || !dropdownInputRef) return;
    const handler = (data: string): boolean => {
      return menuDropdownInputRef.current?.(data) ?? true;
    };
    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [paneTabContextMenu, mode, dropdownInputRef]);

  // In rename mode, keep dropdownInputRef non-null so the mouse coordinate
  // mapper lets OpenTUI handle clicks (needed for click-outside dismissal).
  // The handler itself is a no-op: the keyboard router returns at the
  // isTextInputActive gate before the dropdown handler, and paste routing
  // likewise checks isTextInputActive first.
  useEffect(() => {
    if (!paneTabContextMenu || mode !== "rename" || !dropdownInputRef) return;
    return claimSharedInputHandler(dropdownInputRef, renameDropdownHandlerRef, (_data: string): boolean => false);
  }, [paneTabContextMenu, mode, dropdownInputRef]);

  // Maintain textInputActive during rename mode (matches tab-bar rename pattern).
  useEffect(() => {
    if (!paneTabContextMenu || mode !== "rename") return;
    onTextInputActive?.(true);
    return () => onTextInputActive?.(false);
  }, [paneTabContextMenu, mode, onTextInputActive]);

  // Wire Escape handler so pressing Escape in rename mode properly closes
  // the rename dialog instead of orphaning it with textInputActive=false.
  useEffect(() => {
    if (!textInputEscapeHandlerRef || !paneTabContextMenu || mode !== "rename") return;
    return claimSharedInputHandler(textInputEscapeHandlerRef, renameEscapeHandlerRef, () => close());
  }, [textInputEscapeHandlerRef, paneTabContextMenu, mode, close]);

  const submitRename = useCallback(() => {
    if (!paneTabContextMenu) {
      close();
      return;
    }
    const text = renameInputRef.current?.plainText?.trim() ?? "";
    paneTabsApi.handleRenamePaneTab(paneTabContextMenu.slotKey, paneTabContextMenu.tabIndex, text);
    close();
  }, [paneTabContextMenu, paneTabsApi, close]);

  if (!paneTabContextMenu || !group || !tab) return null;

  const menuItemWidth = 24;
  const menuWidth = menuItemWidth + 2;
  const menuLeft = Math.max(0, Math.min(paneTabContextMenu.screenX - 1, width - menuWidth));
  const menuTop = paneTabContextMenu.screenY;

  if (mode === "rename") {
    const safeLabel = stripNonPrintingControlChars(tab.userLabel ?? tab.label);
    const renameItemWidth = Math.max(30, Math.min(width - 4, Math.max(18, stringWidth(safeLabel) + 4)));
    const renameDropdownWidth = renameItemWidth + 2;
    const renameLeft = Math.max(0, Math.min(paneTabContextMenu.screenX - 1, width - renameDropdownWidth));
    return (
      <DropdownFrame
        height={5}
        left={renameLeft}
        onClickOutside={close}
        top={menuTop}
        width={renameDropdownWidth}
        zIndex={60}
      >
        <DropdownInputPanel
          hint=" Enter ↵ rename · Esc cancel"
          initialValue={safeLabel}
          itemWidth={renameItemWidth}
          onSubmit={submitRename}
          textareaRef={renameInputRef}
          title=" Rename pane tab"
        />
      </DropdownFrame>
    );
  }

  return (
    <DropdownFrame
      height={menuItems.length + 2}
      id="honeyshots:pane-tab-context-menu"
      left={menuLeft}
      onClickOutside={close}
      top={menuTop}
      width={menuWidth}
      zIndex={60}
    >
      {menuItems.map((item, i) => {
        const isFocused = i === focusedIndex;
        const bg = isFocused ? theme.bgFocused : theme.bgSurface;
        const itemFg = isFocused ? theme.textBright : theme.text;
        const prefix = isFocused ? " ▸ " : "   ";
        return (
          <text
            bg={bg}
            content={padEndToWidth(prefix + MENU_LABELS[item], menuItemWidth)}
            fg={itemFg}
            key={item}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) handleSelect(i);
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}
