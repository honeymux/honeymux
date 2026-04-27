import type { MutableRefObject } from "react";

import { useCallback, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabGroup } from "./types.ts";

import {
  BORDER_PREFIX,
  MENU_BUTTON_WIDTH,
  borderMaxWidth,
  buildBorderFormat,
  buildDragBorderFormat,
  computePaneTabDropIndex,
  computePaneTabInsertIndex,
  computePaneTabVisible,
  hitTestPaneTab,
} from "./layout.ts";

export interface PaneTabContextMenuState {
  screenX: number;
  screenY: number;
  slotKey: string;
  tabIndex: number;
}

export interface PaneTabDragFloatState {
  label: string;
  screenX: number;
  screenY: number;
}

export interface PaneTabInteractionsApi {
  closePaneTabContextMenu: () => void;
  closePaneTabOverflow: () => void;
  /** Callback for when the ≡ menu button is clicked. Set by the app to open the pane border menu. */
  onMenuButtonClickRef: MutableRefObject<((paneId: string, screenX: number, screenY: number) => void) | null>;
  /** Handle click on a pane border row. Args: (paneId, xOffset, screenX, screenY). Returns true if consumed. */
  paneTabBorderClickRef: MutableRefObject<
    ((paneId: string, xOffset: number, paneWidth: number, screenX: number, screenY: number) => boolean) | null
  >;
  /** Pure hit-test: returns true if (paneId, xOffset) is on a draggable tab. No side effects. */
  paneTabBorderHitTestRef: MutableRefObject<((paneId: string, xOffset: number) => boolean) | null>;
  /** Right-click on a pane border tab. Args: (paneId, xOffset, screenX, screenY). Returns true if consumed. */
  paneTabBorderRightClickRef: MutableRefObject<
    ((paneId: string, xOffset: number, screenX: number, screenY: number) => boolean) | null
  >;
  /** Pane tab context menu state. */
  paneTabContextMenu: PaneTabContextMenuState | null;
  /** Drag-end callback: receives source + target coordinates on release. */
  paneTabDragEndRef: MutableRefObject<
    ((sourcePaneId: string, sourceXOffset: number, targetPaneId: null | string, targetXOffset: number) => void) | null
  >;
  /** Floating tab visual state for rendering during drag. */
  paneTabDragFloat: PaneTabDragFloatState | null;
  /** Drag-move callback: receives source + target coordinates each motion tick. */
  paneTabDragMoveRef: MutableRefObject<
    | ((
        sourcePaneId: string,
        sourceXOffset: number,
        targetPaneId: null | string,
        targetXOffset: number,
        screenX: number,
        screenY: number,
      ) => void)
    | null
  >;
  /** True while the user is dragging a pane tab. */
  paneTabDraggingRef: MutableRefObject<boolean>;
  /** Pane tab overflow dropdown state. */
  paneTabOverflow: PaneTabOverflowState | null;
}

export interface PaneTabOverflowState {
  screenX: number;
  screenY: number;
  slotKey: string;
  visibleCount: number;
}

interface DragTarget {
  slotKey: string;
  tabIndex: number;
}

interface UsePaneTabInteractionsOptions {
  borderLinesRef: MutableRefObject<string>;
  clientRef: MutableRefObject<TmuxControlClient | null>;
  enabled: boolean;
  getPaneTabGroup: (paneId: string) => PaneTabGroup | undefined;
  groupsRef: MutableRefObject<Map<string, PaneTabGroup>>;
  movePaneTab: (fromSlotKey: string, fromTabIndex: number, toSlotKey: string, toInsertIndex: number) => void;
  moveToUngroupedPane: (fromSlotKey: string, fromTabIndex: number, targetPaneId: string, insertIndex: number) => void;
  reorderPaneTab: (slotKey: string, fromIndex: number, toIndex: number) => void;
  switchPaneTab: (slotKey: string, tabIndex: number) => void;
}

export function usePaneTabInteractions({
  borderLinesRef,
  clientRef,
  enabled,
  getPaneTabGroup,
  groupsRef,
  movePaneTab,
  moveToUngroupedPane,
  reorderPaneTab,
  switchPaneTab,
}: UsePaneTabInteractionsOptions): PaneTabInteractionsApi {
  const paneTabDraggingRef = useRef(false);
  const paneTabDragSourceRef = useRef<DragTarget | null>(null);
  const paneTabDragOverRef = useRef<DragTarget | null>(null);
  const paneTabDragMoveRef = useRef<
    | ((
        sourcePaneId: string,
        sourceXOffset: number,
        targetPaneId: null | string,
        targetXOffset: number,
        screenX: number,
        screenY: number,
      ) => void)
    | null
  >(null);
  const paneTabDragEndRef = useRef<
    ((sourcePaneId: string, sourceXOffset: number, targetPaneId: null | string, targetXOffset: number) => void) | null
  >(null);
  const [paneTabDragFloat, setPaneTabDragFloat] = useState<PaneTabDragFloatState | null>(null);

  const [paneTabContextMenu, setPaneTabContextMenu] = useState<PaneTabContextMenuState | null>(null);
  const closePaneTabContextMenu = useCallback(() => {
    setPaneTabContextMenu(null);
  }, []);

  const [paneTabOverflow, setPaneTabOverflow] = useState<PaneTabOverflowState | null>(null);
  const closePaneTabOverflow = useCallback(() => {
    setPaneTabOverflow(null);
  }, []);

  const paneTabBorderRightClickRef = useRef<
    ((paneId: string, xOffset: number, screenX: number, screenY: number) => boolean) | null
  >(null);
  paneTabBorderRightClickRef.current = !enabled
    ? null
    : (paneId: string, xOffset: number, screenX: number, screenY: number): boolean => {
        const group = getPaneTabGroup(paneId);
        if (!group) return false;
        const maxWidth = borderMaxWidth(group.slotWidth);
        const hit = group.tabs.length <= 1 ? 0 : hitTestPaneTab(group.tabs, xOffset, maxWidth, group.activeIndex);
        if (hit === -2) {
          const visibleCount = computePaneTabVisible(group.tabs, maxWidth);
          setPaneTabOverflow({ screenX, screenY, slotKey: group.slotKey, visibleCount });
          return true;
        }
        if (hit < 0 || hit === -3) return false;
        setPaneTabContextMenu({ screenX, screenY, slotKey: group.slotKey, tabIndex: hit });
        return true;
      };

  const onMenuButtonClickRef = useRef<((paneId: string, screenX: number, screenY: number) => void) | null>(null);
  const paneTabBorderClickRef = useRef<
    ((paneId: string, xOffset: number, paneWidth: number, screenX: number, screenY: number) => boolean) | null
  >(null);
  paneTabBorderClickRef.current = (
    paneId: string,
    xOffset: number,
    paneWidth: number,
    screenX: number,
    screenY: number,
  ): boolean => {
    const group = enabled ? getPaneTabGroup(paneId) : undefined;

    if (!group || group.tabs.length <= 1) {
      // Widen the zone to cover tmux < 3.6 where a 2-column right border
      // suffix shifts #[align=right] content left (see BORDER_SUFFIX_COMPAT).
      if (xOffset >= paneWidth - MENU_BUTTON_WIDTH - BORDER_PREFIX && xOffset <= paneWidth - 1) {
        onMenuButtonClickRef.current?.(paneId, screenX, screenY);
        return true;
      }
      return false;
    }

    const maxWidth = borderMaxWidth(group.slotWidth);
    const hit = hitTestPaneTab(group.tabs, xOffset, maxWidth, group.activeIndex);
    if (hit === -3) {
      onMenuButtonClickRef.current?.(paneId, screenX, screenY);
      return true;
    }
    if (hit === -2) {
      const visibleCount = computePaneTabVisible(group.tabs, maxWidth);
      setPaneTabOverflow({ screenX, screenY, slotKey: group.slotKey, visibleCount });
      return true;
    }
    if (hit >= 0 && hit !== group.activeIndex) {
      switchPaneTab(group.slotKey, hit);
    }
    return true;
  };

  const paneTabBorderHitTestRef = useRef<((paneId: string, xOffset: number) => boolean) | null>(null);
  paneTabBorderHitTestRef.current = !enabled
    ? null
    : (paneId: string, xOffset: number): boolean => {
        const group = getPaneTabGroup(paneId);
        if (!group || group.tabs.length <= 1) return false;
        const maxWidth = borderMaxWidth(group.slotWidth);
        const hit = hitTestPaneTab(group.tabs, xOffset, maxWidth, group.activeIndex);
        return hit >= 0 || hit === -2;
      };

  function resolveDragTarget(paneId: null | string, xOffset: number): DragTarget | null {
    if (!paneId) return null;
    const group = getPaneTabGroup(paneId);
    if (group) {
      return {
        slotKey: group.slotKey,
        tabIndex: computePaneTabInsertIndex(group.tabs, xOffset),
      };
    }
    return { slotKey: paneId, tabIndex: 1 };
  }

  function resolveDragSource(paneId: string, xOffset: number): DragTarget | null {
    const group = getPaneTabGroup(paneId);
    if (!group || group.tabs.length <= 1) return null;
    const tabIndex = hitTestPaneTab(group.tabs, xOffset, borderMaxWidth(group.slotWidth), group.activeIndex);
    if (tabIndex < 0) return null;
    return { slotKey: group.slotKey, tabIndex };
  }

  function updateDragVisual(source: DragTarget, target: DragTarget | null, previousTarget: DragTarget | null) {
    const client = clientRef.current;
    if (!client) return;

    // If the previous drag-over target was in a group that is neither the
    // source nor the new target, its border is still showing the inverse drag
    // indicator — restore it before rebuilding the other formats.
    if (previousTarget && previousTarget.slotKey !== source.slotKey && previousTarget.slotKey !== target?.slotKey) {
      const previousGroup = groupsRef.current.get(previousTarget.slotKey);
      if (previousGroup && previousGroup.tabs.length > 0) {
        const activePaneId = previousGroup.tabs[previousGroup.activeIndex]!.paneId;
        client
          .setPaneBorderFormat(
            activePaneId,
            buildBorderFormat(
              previousGroup.tabs,
              previousGroup.activeIndex,
              borderLinesRef.current,
              borderMaxWidth(previousGroup.slotWidth),
            ),
          )
          .catch(() => {});
      }
    }

    const sourceGroup = groupsRef.current.get(source.slotKey);
    if (!sourceGroup) return;

    if (!target || target.slotKey === source.slotKey) {
      const reordered = [...sourceGroup.tabs];
      const [movedTab] = reordered.splice(source.tabIndex, 1);
      const insertIndex = Math.min(target ? target.tabIndex : source.tabIndex, reordered.length);
      reordered.splice(insertIndex, 0, movedTab!);

      let activeIndex = sourceGroup.activeIndex;
      if (sourceGroup.activeIndex === source.tabIndex) {
        activeIndex = insertIndex;
      } else if (source.tabIndex < sourceGroup.activeIndex && insertIndex >= sourceGroup.activeIndex) {
        activeIndex--;
      } else if (source.tabIndex > sourceGroup.activeIndex && insertIndex <= sourceGroup.activeIndex) {
        activeIndex++;
      }

      const activePaneId = reordered[activeIndex]!.paneId;
      client
        .setPaneBorderFormat(
          activePaneId,
          buildDragBorderFormat(
            reordered,
            activeIndex,
            insertIndex,
            borderLinesRef.current,
            borderMaxWidth(sourceGroup.slotWidth),
          ),
        )
        .catch(() => {});
      return;
    }

    const targetGroup = groupsRef.current.get(target.slotKey);

    const sourceTabs = sourceGroup.tabs.filter((_, index) => index !== source.tabIndex);
    let sourceActiveIndex = sourceGroup.activeIndex;
    if (source.tabIndex < sourceActiveIndex) sourceActiveIndex--;
    else if (source.tabIndex === sourceActiveIndex)
      sourceActiveIndex = Math.min(sourceActiveIndex, sourceTabs.length - 1);

    if (sourceTabs.length > 0) {
      const activePaneId = sourceTabs[sourceActiveIndex]!.paneId;
      client
        .setPaneBorderFormat(
          activePaneId,
          buildBorderFormat(
            sourceTabs,
            sourceActiveIndex,
            borderLinesRef.current,
            borderMaxWidth(sourceGroup.slotWidth),
          ),
        )
        .catch(() => {});
    }

    if (!targetGroup) return;

    const movingTab = sourceGroup.tabs[source.tabIndex]!;
    const targetTabs = [...targetGroup.tabs];
    const insertIndex = Math.min(target.tabIndex, targetTabs.length);
    targetTabs.splice(insertIndex, 0, movingTab);

    let activeIndex = targetGroup.activeIndex;
    if (insertIndex <= activeIndex) activeIndex++;

    const activePaneId = targetTabs[activeIndex]!.paneId;
    client
      .setPaneBorderFormat(
        activePaneId,
        buildDragBorderFormat(
          targetTabs,
          activeIndex,
          insertIndex,
          borderLinesRef.current,
          borderMaxWidth(targetGroup.slotWidth),
        ),
      )
      .catch(() => {});
  }

  function restoreBorderFormats() {
    const client = clientRef.current;
    if (!client) return;

    for (const [, group] of groupsRef.current) {
      const activePaneId = group.tabs[group.activeIndex]!.paneId;
      client
        .setPaneBorderFormat(
          activePaneId,
          buildBorderFormat(group.tabs, group.activeIndex, borderLinesRef.current, borderMaxWidth(group.slotWidth)),
        )
        .catch(() => {});
    }
  }

  paneTabDragMoveRef.current = !enabled
    ? null
    : (
        sourcePaneId: string,
        sourceXOffset: number,
        targetPaneId: null | string,
        targetXOffset: number,
        screenX: number,
        screenY: number,
      ) => {
        if (!paneTabDragSourceRef.current) {
          paneTabDragSourceRef.current = resolveDragSource(sourcePaneId, sourceXOffset);
          if (!paneTabDragSourceRef.current) {
            paneTabDraggingRef.current = false;
            setPaneTabDragFloat(null);
            return;
          }
        }

        const source = paneTabDragSourceRef.current;
        const sourceGroup = groupsRef.current.get(source.slotKey);
        const sourceTab = sourceGroup?.tabs[source.tabIndex];
        if (sourceTab) {
          setPaneTabDragFloat({ label: sourceTab.label, screenX, screenY });
        }

        let target = resolveDragTarget(targetPaneId, targetXOffset);
        if (target && target.slotKey === source.slotKey && sourceGroup) {
          target = {
            ...target,
            tabIndex: computePaneTabDropIndex(sourceGroup.tabs, source.tabIndex, targetXOffset),
          };
        }

        const previousTarget = paneTabDragOverRef.current;
        const changed = previousTarget?.slotKey !== target?.slotKey || previousTarget?.tabIndex !== target?.tabIndex;
        if (changed) {
          paneTabDragOverRef.current = target;
          updateDragVisual(source, target, previousTarget);
        }
      };

  paneTabDragEndRef.current = !enabled
    ? null
    : (_sourcePaneId: string, _sourceXOffset: number, targetPaneId: null | string, targetXOffset: number) => {
        const source = paneTabDragSourceRef.current;
        paneTabDraggingRef.current = false;
        paneTabDragSourceRef.current = null;
        paneTabDragOverRef.current = null;
        setPaneTabDragFloat(null);

        if (!source) {
          restoreBorderFormats();
          return;
        }

        const target = resolveDragTarget(targetPaneId, targetXOffset);

        if (target && target.slotKey === source.slotKey) {
          const sourceGroup = groupsRef.current.get(source.slotKey);
          if (!sourceGroup) {
            restoreBorderFormats();
            return;
          }

          const dropIndex = computePaneTabDropIndex(sourceGroup.tabs, source.tabIndex, targetXOffset);
          if (dropIndex !== source.tabIndex) {
            reorderPaneTab(source.slotKey, source.tabIndex, dropIndex);
          } else {
            restoreBorderFormats();
          }
          return;
        }

        if (target && target.slotKey !== source.slotKey) {
          const targetGroup = groupsRef.current.get(target.slotKey);
          if (targetGroup && targetGroup.tabs.length > 1) {
            movePaneTab(source.slotKey, source.tabIndex, target.slotKey, target.tabIndex);
          } else {
            moveToUngroupedPane(source.slotKey, source.tabIndex, target.slotKey, target.tabIndex);
          }
          return;
        }

        restoreBorderFormats();
      };

  return {
    closePaneTabContextMenu,
    closePaneTabOverflow,
    onMenuButtonClickRef,
    paneTabBorderClickRef,
    paneTabBorderHitTestRef,
    paneTabBorderRightClickRef,
    paneTabContextMenu,
    paneTabDragEndRef,
    paneTabDragFloat,
    paneTabDragMoveRef,
    paneTabDraggingRef,
    paneTabOverflow,
  };
}
