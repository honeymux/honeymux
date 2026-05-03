import type { MutableRefObject, RefObject } from "react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TmuxSession, TmuxWindow } from "../../tmux/types.ts";

import { stringWidth, stripNonPrintingControlChars } from "../../util/text.ts";
import { claimSharedInputHandler, releaseSharedInputHandler } from "../shared-input-handler.ts";
import { useDropdownKeyboard } from "../use-dropdown-keyboard.ts";

export interface TabBarContextMenuEntry {
  disabled: boolean;
  key: TabBarContextMenuItem;
  label: string;
}
export type TabBarContextMenuMode = "menu" | "move";

type TabBarContextMenuItem = "close" | "move" | "rename";

interface UseTabBarMenusOptions {
  dropdownInputRef?: MutableRefObject<((data: string) => boolean) | null>;
  hasOverflow: boolean;
  onCloseWindow?: (index: number) => void;
  onMoveWindowToSession?: (index: number, targetSession: string) => void;
  onTabRename?: (index: number, newName: string) => void;
  onTextInputActive?: (active: boolean) => void;
  resolveTabIndexFromX?: (x: number) => number;
  sessionName?: string;
  sessions?: TmuxSession[];
  tabRightClickRef?: MutableRefObject<((x: number) => void) | null>;
  textInputEscapeHandlerRef?: MutableRefObject<(() => void) | null>;
  visibleCount: number;
  width: number;
  windows: TmuxWindow[];
}

interface UseTabBarMenusResult {
  canMoveToSession: boolean;
  closeContextMenu: () => void;
  closeRenameEditor: () => void;
  contextMenuFocused: number;
  contextMenuIndex: null | number;
  contextMenuItems: TabBarContextMenuEntry[];
  contextMenuMode: TabBarContextMenuMode;
  handleContextMenuSelect: (index: number) => void;
  handleMoveSessionSelect: (index: number) => void;
  moveMenuFocused: number;
  openContextMenu: (index: number) => void;
  openRenameEditor: (index: number) => void;
  otherSessions: TmuxSession[];
  renameDropdownWidth: number;
  renameIndex: number;
  renameInitialName: string;
  renameInputRef: RefObject<any>;
  renameItemWidth: number;
  renameWindowId: null | string;
  submitRename: () => void;
}

const CONTEXT_MENU_ORDER: TabBarContextMenuItem[] = ["move", "rename", "close"];
const CONTEXT_MENU_LABELS: Record<TabBarContextMenuItem, string> = {
  close: "Close window",
  move: "Move to session  ▸",
  rename: "Rename window",
};

export function buildTabBarContextMenuItems(canMoveToSession: boolean): TabBarContextMenuEntry[] {
  return CONTEXT_MENU_ORDER.map((key) => ({
    disabled: key === "move" ? !canMoveToSession : false,
    key,
    label: CONTEXT_MENU_LABELS[key],
  }));
}

export function useTabBarMenus({
  dropdownInputRef,
  hasOverflow,
  onCloseWindow,
  onMoveWindowToSession,
  onTabRename,
  onTextInputActive,
  resolveTabIndexFromX,
  sessionName,
  sessions,
  tabRightClickRef,
  textInputEscapeHandlerRef,
  visibleCount,
  width,
  windows,
}: UseTabBarMenusOptions): UseTabBarMenusResult {
  const [renameWindowId, setRenameWindowId] = useState<null | string>(null);
  const [renameInitialName, setRenameInitialName] = useState("");
  const renameInputRef = useRef<any>(null);
  const renameDropdownHandlerRef = useRef<((data: string) => boolean) | null>(null);
  const renameEscapeHandlerRef = useRef<(() => void) | null>(null);
  const [contextMenuIndex, setContextMenuIndex] = useState<null | number>(null);
  const [contextMenuMode, setContextMenuMode] = useState<TabBarContextMenuMode>("menu");

  const otherSessions = useMemo(
    () => (sessions ?? []).filter((session) => session.name !== sessionName),
    [sessions, sessionName],
  );
  const canMoveToSession = otherSessions.length > 0 && !!onMoveWindowToSession;
  const contextMenuItems = useMemo(() => buildTabBarContextMenuItems(canMoveToSession), [canMoveToSession]);
  const contextMenuItemsRef = useRef(contextMenuItems);
  contextMenuItemsRef.current = contextMenuItems;

  const renameIndex = renameWindowId ? windows.findIndex((window) => window.id === renameWindowId) : -1;
  const renameItemWidth = Math.max(30, Math.min(width - 4, Math.max(18, stringWidth(renameInitialName) + 4)));
  const renameDropdownWidth = renameItemWidth + 2;

  const closeRenameEditor = useCallback(() => {
    releaseSharedInputHandler(dropdownInputRef, renameDropdownHandlerRef);
    releaseSharedInputHandler(textInputEscapeHandlerRef, renameEscapeHandlerRef);
    onTextInputActive?.(false);
    setRenameWindowId(null);
    setRenameInitialName("");
  }, [dropdownInputRef, onTextInputActive, textInputEscapeHandlerRef]);

  const openRenameEditor = useCallback(
    (index: number) => {
      if (!onTabRename) return;
      const window = windows[index];
      if (!window) return;
      onTextInputActive?.(true);
      setRenameWindowId(window.id);
      setRenameInitialName(stripNonPrintingControlChars(window.name));
    },
    [onTabRename, onTextInputActive, windows],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuIndex(null);
    setContextMenuMode("menu");
  }, []);

  const openContextMenu = useCallback(
    (index: number) => {
      const window = windows[index];
      if (!window) return;
      setContextMenuIndex(index);
      setContextMenuMode("menu");
    },
    [windows],
  );

  const submitRename = useCallback(() => {
    if (!renameWindowId || !onTabRename) {
      closeRenameEditor();
      return;
    }
    const index = windows.findIndex((window) => window.id === renameWindowId);
    const text = renameInputRef.current?.plainText?.trim() ?? "";
    if (index >= 0 && (text.length === 0 || text !== renameInitialName)) {
      onTabRename(index, text);
    }
    closeRenameEditor();
  }, [closeRenameEditor, onTabRename, renameInitialName, renameWindowId, windows]);

  useEffect(() => {
    if (!renameWindowId) return;
    if (renameIndex < 0 || (hasOverflow && renameIndex >= visibleCount)) {
      closeRenameEditor();
    }
  }, [closeRenameEditor, hasOverflow, renameIndex, renameWindowId, visibleCount]);

  useEffect(() => {
    if (!renameWindowId) return;
    onTextInputActive?.(true);
    return () => onTextInputActive?.(false);
  }, [renameWindowId, onTextInputActive]);

  useEffect(() => {
    if (!renameWindowId || !dropdownInputRef) return;
    return claimSharedInputHandler(dropdownInputRef, renameDropdownHandlerRef, (_data: string): boolean => false);
  }, [renameWindowId, dropdownInputRef]);

  useEffect(() => {
    if (!textInputEscapeHandlerRef || !renameWindowId) return;
    return claimSharedInputHandler(textInputEscapeHandlerRef, renameEscapeHandlerRef, () => closeRenameEditor());
  }, [closeRenameEditor, renameWindowId, textInputEscapeHandlerRef]);

  const handleContextMenuSelect = useCallback(
    (index: number) => {
      const item = contextMenuItemsRef.current[index];
      if (!item || contextMenuIndex === null || item.disabled) return;
      if (item.key === "rename") {
        openRenameEditor(contextMenuIndex);
        closeContextMenu();
        return;
      }
      if (item.key === "close") {
        onCloseWindow?.(contextMenuIndex);
        closeContextMenu();
        return;
      }
      if (item.key === "move") {
        setContextMenuMode("move");
      }
    },
    [contextMenuIndex, openRenameEditor, closeContextMenu, onCloseWindow],
  );

  const handleContextMenuClose = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  const handleContextMenuRight = useCallback((index: number) => {
    const item = contextMenuItemsRef.current[index];
    if (item?.key === "move" && !item.disabled) {
      setContextMenuMode("move");
    }
  }, []);

  const contextMenuDropdownInputRef = useRef<((data: string) => boolean) | null>(null);

  const { focusedIndex: contextMenuFocused } = useDropdownKeyboard({
    dropdownInputRef: contextMenuDropdownInputRef,
    isOpen: contextMenuIndex !== null && contextMenuMode === "menu",
    itemCount: contextMenuItems.length,
    onClose: handleContextMenuClose,
    onRight: handleContextMenuRight,
    onSelect: handleContextMenuSelect,
  });

  useEffect(() => {
    if (contextMenuIndex === null || contextMenuMode !== "menu" || !dropdownInputRef) return;
    const handler = (data: string): boolean => contextMenuDropdownInputRef.current?.(data) ?? true;
    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [contextMenuIndex, contextMenuMode, dropdownInputRef]);

  const handleMoveSessionSelect = useCallback(
    (index: number) => {
      if (contextMenuIndex === null || index >= otherSessions.length) return;
      onMoveWindowToSession?.(contextMenuIndex, otherSessions[index]!.name);
      closeContextMenu();
    },
    [contextMenuIndex, otherSessions, onMoveWindowToSession, closeContextMenu],
  );

  const handleMoveSessionClose = useCallback(() => {
    setContextMenuMode("menu");
  }, []);

  const handleMoveSessionLeft = useCallback(() => {
    setContextMenuMode("menu");
  }, []);

  const moveMenuDropdownInputRef = useRef<((data: string) => boolean) | null>(null);

  const { focusedIndex: moveMenuFocused } = useDropdownKeyboard({
    dropdownInputRef: moveMenuDropdownInputRef,
    isOpen: contextMenuIndex !== null && contextMenuMode === "move",
    itemCount: otherSessions.length,
    onClose: handleMoveSessionClose,
    onLeft: handleMoveSessionLeft,
    onSelect: handleMoveSessionSelect,
  });

  useEffect(() => {
    if (contextMenuIndex === null || contextMenuMode !== "move" || !dropdownInputRef) return;
    const handler = (data: string): boolean => moveMenuDropdownInputRef.current?.(data) ?? true;
    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [contextMenuIndex, contextMenuMode, dropdownInputRef]);

  useEffect(() => {
    if (!tabRightClickRef || !resolveTabIndexFromX) return;
    const handler = (x: number) => {
      const idx = resolveTabIndexFromX(x);
      if (idx >= 0) {
        openContextMenu(idx);
      } else {
        closeContextMenu();
      }
    };
    tabRightClickRef.current = handler;
    return () => {
      if (tabRightClickRef.current === handler) {
        tabRightClickRef.current = null;
      }
    };
  }, [tabRightClickRef, resolveTabIndexFromX, openContextMenu, closeContextMenu]);

  return {
    canMoveToSession,
    closeContextMenu,
    closeRenameEditor,
    contextMenuFocused,
    contextMenuIndex,
    contextMenuItems,
    contextMenuMode,
    handleContextMenuSelect,
    handleMoveSessionSelect,
    moveMenuFocused,
    openContextMenu,
    openRenameEditor,
    otherSessions,
    renameDropdownWidth,
    renameIndex,
    renameInitialName,
    renameInputRef,
    renameItemWidth,
    renameWindowId,
    submitRename,
  };
}
