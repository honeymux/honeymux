import type { MouseEvent } from "@opentui/core";
import type { RefObject } from "react";

import type { TmuxSession, TmuxWindow } from "../../tmux/types.ts";
import type { TabBarContextMenuEntry, TabBarContextMenuMode } from "./use-tab-bar-menus.ts";

import { theme } from "../../themes/theme.ts";
import { padEndToWidth, stringWidth, stripNonPrintingControlChars, truncateToWidth } from "../../util/text.ts";
import { DropdownFrame, DropdownInputPanel } from "../dropdown-shell.tsx";
import { tabBoundsFromIndex } from "./layout.ts";

interface TabBarMenusProps {
  activeIndex: number;
  closeContextMenu: () => void;
  closeRenameEditor: () => void;
  contextMenuFocused: number;
  contextMenuIndex: null | number;
  contextMenuItems: TabBarContextMenuEntry[];
  contextMenuMode: TabBarContextMenuMode;
  displayNames: string[];
  handleContextMenuSelect: (index: number) => void;
  handleMoveSessionSelect: (index: number) => void;
  moveMenuFocused: number;
  otherSessions: TmuxSession[];
  renameDropdownWidth: number;
  renameIndex: number;
  renameInitialName: string;
  renameInputRef: RefObject<any>;
  renameItemWidth: number;
  renameWindowId: null | string;
  showId: boolean;
  sidebarReserve: number;
  submitRename: () => void;
  width: number;
  windows: TmuxWindow[];
}

interface TabBarMoveMenuLayout {
  moveItemWidth: number;
  moveLeft: number;
  moveWidth: number;
}

export function TabBarMenus({
  activeIndex,
  closeContextMenu,
  closeRenameEditor,
  contextMenuFocused,
  contextMenuIndex,
  contextMenuItems,
  contextMenuMode,
  displayNames,
  handleContextMenuSelect,
  handleMoveSessionSelect,
  moveMenuFocused,
  otherSessions,
  renameDropdownWidth,
  renameIndex,
  renameInitialName,
  renameInputRef,
  renameItemWidth,
  renameWindowId,
  showId,
  sidebarReserve,
  submitRename,
  width,
  windows,
}: TabBarMenusProps) {
  if (renameWindowId) {
    const tabBounds = tabBoundsFromIndex(windows, renameIndex, sidebarReserve, activeIndex, showId, displayNames);
    const renameLeft = Math.max(0, Math.min(tabBounds?.left ?? 0, width - renameDropdownWidth));
    return (
      <DropdownFrame
        height={5}
        left={renameLeft}
        onClickOutside={closeRenameEditor}
        width={renameDropdownWidth}
        zIndex={60}
      >
        <DropdownInputPanel
          hint=" Enter ↵ rename · Esc cancel"
          initialValue={renameInitialName}
          itemWidth={renameItemWidth}
          onSubmit={submitRename}
          textareaRef={renameInputRef}
          title=" Rename tmux window"
        />
      </DropdownFrame>
    );
  }

  if (contextMenuIndex === null || (contextMenuMode !== "menu" && contextMenuMode !== "move")) {
    return null;
  }

  const tabBounds = tabBoundsFromIndex(windows, contextMenuIndex, sidebarReserve, activeIndex, showId, displayNames);
  const menuItemWidth = 24;
  const menuWidth = menuItemWidth + 2;
  const menuLeft = Math.max(0, Math.min(tabBounds?.left ?? 0, width - menuWidth));
  const inMoveMode = contextMenuMode === "move";
  const contextWindow = windows[contextMenuIndex];
  const moveItemIdx = contextMenuItems.findIndex((item) => item.key === "move");
  const { moveItemWidth, moveLeft, moveWidth } = getTabBarMoveMenuLayout(width, menuLeft, menuWidth, otherSessions);

  return (
    <>
      <DropdownFrame
        height={contextMenuItems.length + 2}
        left={menuLeft}
        onClickOutside={closeContextMenu}
        width={menuWidth}
        zIndex={60}
      >
        {contextWindow && (
          <text
            bg={theme.bgSurface}
            bottom={-1}
            content={` ${contextWindow.id} `}
            fg={theme.textDim}
            left={menuItemWidth - stringWidth(contextWindow.id) - 2}
            position="absolute"
            selectable={false}
            zIndex={1}
          />
        )}
        {contextMenuItems.map((item, i) => {
          const isFocused = inMoveMode ? i === moveItemIdx : i === contextMenuFocused;
          const bg = isFocused && !item.disabled ? theme.bgFocused : theme.bgSurface;
          const itemFg = item.disabled ? theme.textDim : isFocused ? theme.textBright : theme.text;
          const prefix = isFocused ? " ▸ " : "   ";
          return (
            <text
              bg={bg}
              content={padEndToWidth(prefix + item.label, menuItemWidth)}
              fg={itemFg}
              key={item.key}
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0 && !item.disabled) {
                  handleContextMenuSelect(i);
                }
              }}
            />
          );
        })}
      </DropdownFrame>
      {inMoveMode && (
        <DropdownFrame
          height={otherSessions.length + 2}
          left={moveLeft}
          onClickOutside={closeContextMenu}
          width={moveWidth}
          zIndex={62}
        >
          {otherSessions.map((session, i) => {
            const isFocused = i === moveMenuFocused;
            const bg = isFocused ? theme.bgFocused : theme.bgSurface;
            const itemFg = isFocused ? theme.textBright : theme.text;
            const prefix = isFocused ? " ▸ " : "   ";
            const safeName = stripNonPrintingControlChars(session.name);
            const displayName = truncateToWidth(safeName, moveItemWidth - 4);
            return (
              <text
                bg={bg}
                content={padEndToWidth(prefix + displayName, moveItemWidth)}
                fg={itemFg}
                key={session.id}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) {
                    handleMoveSessionSelect(i);
                  }
                }}
              />
            );
          })}
        </DropdownFrame>
      )}
    </>
  );
}

export function getTabBarMoveMenuLayout(
  width: number,
  menuLeft: number,
  menuWidth: number,
  otherSessions: TmuxSession[],
): TabBarMoveMenuLayout {
  const maxNameLen = Math.max(
    ...otherSessions.map((session) => stringWidth(stripNonPrintingControlChars(session.name))),
    0,
  );
  const moveItemWidth = Math.max(Math.min(maxNameLen + 4, 40), 20);
  const moveWidth = moveItemWidth + 2;
  const subMenuRight = menuLeft + menuWidth;
  const moveLeft = subMenuRight + moveWidth <= width ? subMenuRight : Math.max(0, menuLeft - moveWidth);
  return { moveItemWidth, moveLeft, moveWidth };
}
