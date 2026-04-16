import type { MouseEvent } from "@opentui/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useCallback, useRef, useState } from "react";

import type { TmuxWindow } from "../../tmux/types.ts";

import { computeDropIndexForDrag } from "./drag.ts";
import { tabIndexFromX } from "./layout.ts";

const LEFT_MOUSE_BUTTON = 0;
const RIGHT_MOUSE_BUTTON = 2;

export type MuxotronClickZone = "agents" | "notifications" | null;

export interface TabBarDragState {
  dragFrom: null | number;
  dragOver: null | number;
  dragX: null | number;
  setDragFrom: Dispatch<SetStateAction<null | number>>;
  setDragOver: Dispatch<SetStateAction<null | number>>;
  setDragX: Dispatch<SetStateAction<null | number>>;
}

interface UseTabBarInteractionsOptions {
  activeIndex: number;
  closeContextMenu: () => void;
  closeRenameEditor: () => void;
  contextMenuIndex: null | number;
  displayNames: string[];
  dragState: TabBarDragState;
  hasOverflow: boolean;
  infoCount?: number;
  muxotronWidth: number;
  onDragChange?: (dragging: boolean) => void;
  onLayoutProfileClick?: () => void;
  onMuxotronClick?: () => void;
  onNewWindow?: () => void;
  onNotificationsClick?: () => void;
  onOverflowOpen?: () => void;
  onSessionClick?: () => void;
  onSidebarToggle?: () => void;
  onTabClick?: (index: number) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onToolbarToggle?: () => void;
  openContextMenu: (index: number) => void;
  overflowIndicatorWidth: number;
  overflowStartX: number;
  plusStartX: number;
  renameWindowId: null | string;
  showId: boolean;
  sidebarReserve: number;
  tabDragEndRef?: MutableRefObject<((x: number) => void) | null>;
  tabDragMoveRef?: MutableRefObject<((x: number) => void) | null>;
  visibleWindows: TmuxWindow[];
  warningCount?: number;
  width: number;
  windowDisplayNames: string[];
  windows: TmuxWindow[];
}

interface UseTabBarInteractionsResult {
  handleBadgeMouseDown: (event: MouseEvent) => void;
  handleLayoutProfileMouseDown: (event: MouseEvent) => void;
  handleSidebarMouseDown: (event: MouseEvent) => void;
  handleTabMouseDown: (event: MouseEvent) => void;
  handleToolbarMouseDown: (event: MouseEvent) => void;
}

export function getMuxotronClickZone(width: number, muxotronWidth: number, x: number): MuxotronClickZone {
  const muxotronLeft = Math.floor((width - muxotronWidth) / 2);
  if (x < muxotronLeft || x >= muxotronLeft + muxotronWidth) return null;
  const mid = muxotronLeft + Math.floor(muxotronWidth / 2);
  return x < mid ? "notifications" : "agents";
}

export function isModifierSecondaryClick(event: Pick<MouseEvent, "button" | "modifiers">): boolean {
  return event.button === LEFT_MOUSE_BUTTON && !!(event.modifiers?.ctrl || event.modifiers?.alt);
}

export function tabIndexFromXWithTolerance(
  windows: TmuxWindow[],
  x: number,
  activeIndex = -1,
  activeWindowIdDisplayEnabled = false,
  leftReserve = 0,
  displayNames?: string[],
): number {
  const probes = [x, x - 1, x + 1, x - 2, x + 2];
  for (const probe of probes) {
    if (probe < 0) continue;
    const idx = tabIndexFromX(windows, probe, leftReserve, activeIndex, activeWindowIdDisplayEnabled, displayNames);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function useTabBarDragState(): TabBarDragState {
  const [dragFrom, setDragFrom] = useState<null | number>(null);
  const [dragOver, setDragOver] = useState<null | number>(null);
  const [dragX, setDragX] = useState<null | number>(null);

  return {
    dragFrom,
    dragOver,
    dragX,
    setDragFrom,
    setDragOver,
    setDragX,
  };
}

export function useTabBarInteractions({
  activeIndex,
  closeContextMenu,
  closeRenameEditor,
  contextMenuIndex,
  displayNames,
  dragState,
  hasOverflow,
  infoCount,
  muxotronWidth,
  onDragChange,
  onLayoutProfileClick,
  onMuxotronClick,
  onNewWindow,
  onNotificationsClick,
  onOverflowOpen,
  onSessionClick,
  onSidebarToggle,
  onTabClick,
  onTabReorder,
  onToolbarToggle,
  openContextMenu,
  overflowIndicatorWidth,
  overflowStartX,
  plusStartX,
  renameWindowId,
  showId,
  sidebarReserve,
  tabDragEndRef,
  tabDragMoveRef,
  visibleWindows,
  warningCount,
  width,
  windowDisplayNames,
  windows,
}: UseTabBarInteractionsOptions): UseTabBarInteractionsResult {
  const { dragFrom, dragOver, setDragFrom, setDragOver, setDragX } = dragState;

  const childHandledRef = useRef(false);
  const dragFromRef = useRef(dragFrom);
  dragFromRef.current = dragFrom;
  const dragOverRef = useRef(dragOver);
  dragOverRef.current = dragOver;

  const updateDragPosition = useCallback(
    (x: number) => {
      setDragX(x);
      const from = dragFromRef.current;
      if (from === null) return;

      const dropIndex = computeDropIndexForDrag(
        windows,
        from,
        x,
        sidebarReserve,
        activeIndex,
        showId,
        windowDisplayNames,
      );
      setDragOver(dropIndex !== from ? dropIndex : null);
    },
    [activeIndex, showId, sidebarReserve, windowDisplayNames, windows],
  );

  const clearDrag = useCallback(() => {
    if (tabDragMoveRef) tabDragMoveRef.current = null;
    if (tabDragEndRef) tabDragEndRef.current = null;
    onDragChange?.(false);
    setDragFrom(null);
    setDragOver(null);
    setDragX(null);
  }, [onDragChange, tabDragMoveRef, tabDragEndRef]);

  const finalizeDrag = useCallback(() => {
    const from = dragFromRef.current;
    const over = dragOverRef.current;
    if (from !== null && over !== null && from !== over && onTabReorder) {
      onTabReorder(from, over);
    }
    clearDrag();
  }, [clearDrag, onTabReorder]);

  const handleTabMouseDown = useCallback(
    (event: MouseEvent) => {
      if (childHandledRef.current) {
        childHandledRef.current = false;
        return;
      }

      if (sidebarReserve > 0 && event.x < sidebarReserve) {
        return;
      }

      const tabWindows = hasOverflow ? visibleWindows : windows;
      const idx = tabIndexFromXWithTolerance(tabWindows, event.x, activeIndex, showId, sidebarReserve, displayNames);
      if (event.button === RIGHT_MOUSE_BUTTON || isModifierSecondaryClick(event)) {
        if (idx >= 0) {
          openContextMenu(idx);
        } else {
          closeContextMenu();
        }
        return;
      }

      if (event.button !== LEFT_MOUSE_BUTTON) return;
      if (renameWindowId) {
        closeRenameEditor();
      }
      if (contextMenuIndex !== null) {
        closeContextMenu();
      }

      if (onNewWindow && plusStartX >= 0 && event.x >= plusStartX - 1 && event.x < plusStartX + 5) {
        onNewWindow();
        return;
      }

      const muxotronZone = getMuxotronClickZone(width, muxotronWidth, event.x);
      if (muxotronZone === "notifications") {
        if ((warningCount && warningCount > 0) || (infoCount && infoCount > 0)) {
          onNotificationsClick?.();
          return;
        }
      } else if (muxotronZone === "agents") {
        onMuxotronClick?.();
        return;
      }

      if (
        hasOverflow &&
        overflowStartX >= 0 &&
        event.x >= overflowStartX &&
        event.x < overflowStartX + overflowIndicatorWidth
      ) {
        onOverflowOpen?.();
        return;
      }

      if (idx >= 0) {
        if (onTabReorder && !hasOverflow) {
          setDragFrom(idx);
          if (tabDragMoveRef) tabDragMoveRef.current = updateDragPosition;
          if (tabDragEndRef) tabDragEndRef.current = () => finalizeDrag();
        }
        if (idx === activeIndex) return;
        onTabClick?.(idx);
      }
    },
    [
      activeIndex,
      closeContextMenu,
      closeRenameEditor,
      contextMenuIndex,
      displayNames,
      finalizeDrag,
      hasOverflow,
      infoCount,
      muxotronWidth,
      onNotificationsClick,
      onMuxotronClick,
      onNewWindow,
      onOverflowOpen,
      onTabClick,
      onTabReorder,
      openContextMenu,
      overflowIndicatorWidth,
      overflowStartX,
      plusStartX,
      renameWindowId,
      showId,
      sidebarReserve,
      tabDragEndRef,
      tabDragMoveRef,
      updateDragPosition,
      visibleWindows,
      warningCount,
      width,
      windows,
    ],
  );

  const handleChildPrimaryClick = useCallback((event: MouseEvent, onClick?: () => void) => {
    if (event.button !== LEFT_MOUSE_BUTTON || !onClick) return;
    childHandledRef.current = true;
    onClick();
  }, []);

  const handleBadgeMouseDown = useCallback(
    (event: MouseEvent) => {
      handleChildPrimaryClick(event, onSessionClick);
    },
    [handleChildPrimaryClick, onSessionClick],
  );

  const handleLayoutProfileMouseDown = useCallback(
    (event: MouseEvent) => {
      handleChildPrimaryClick(event, onLayoutProfileClick);
    },
    [handleChildPrimaryClick, onLayoutProfileClick],
  );

  const handleToolbarMouseDown = useCallback(
    (event: MouseEvent) => {
      handleChildPrimaryClick(event, onToolbarToggle);
    },
    [handleChildPrimaryClick, onToolbarToggle],
  );

  const handleSidebarMouseDown = useCallback(
    (event: MouseEvent) => {
      handleChildPrimaryClick(event, onSidebarToggle);
    },
    [handleChildPrimaryClick, onSidebarToggle],
  );

  return {
    handleBadgeMouseDown,
    handleLayoutProfileMouseDown,
    handleSidebarMouseDown,
    handleTabMouseDown,
    handleToolbarMouseDown,
  };
}
