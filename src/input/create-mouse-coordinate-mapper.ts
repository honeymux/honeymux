import type { MutableRefObject } from "react";

import type {
  SetupTmuxRuntimeDialogsContext,
  SetupTmuxRuntimeInputContext,
  SetupTmuxRuntimeMouseContext,
  SetupTmuxRuntimeSessionRuntimeContext,
} from "../app/runtime/runtime-context.ts";

import { TOOLBAR_WIDTH } from "../components/toolbar.tsx";

interface CreateMouseCoordinateMapperOptions {
  clickToMoveRef: MutableRefObject<((ptyX: number, ptyY: number) => boolean) | null>;
  dialogs: SetupTmuxRuntimeDialogsContext;
  input: SetupTmuxRuntimeInputContext;
  mouse: SetupTmuxRuntimeMouseContext;
  paneRectsRef: MutableRefObject<
    Array<{ active?: boolean; height: number; id?: string; left: number; top: number; width: number }>
  >;
  sessionRuntime: SetupTmuxRuntimeSessionRuntimeContext;
}

export function createMouseCoordinateMapper({
  clickToMoveRef,
  dialogs,
  input,
  mouse,
  paneRectsRef,
  sessionRuntime,
}: CreateMouseCoordinateMapperOptions): (
  screenX: number,
  screenY: number,
  button: number,
  suffix: string,
) => "consume" | { x: number; y: number } | null {
  const { agentInstallDialogRef, dropdownInputRef } = dialogs;
  const { dimsRef } = sessionRuntime;
  const {
    handleMuxotronDismissRef,
    handleSidebarCancelRef,
    handleToolbarCancelRef,
    handleZoomEndRef,
    muxotronFocusActiveRef,
    paneTabBorderClickRef,
    sidebarFocusedRef,
    toolbarFocusedIndexRef,
    toolbarOpenRef,
    zoomActionRef,
  } = input;
  const {
    agentsDialogOpenRef,
    dropdownOpenRef,
    ignoreMouseInputRef,
    layoutDropdownOpenRef,
    mainMenuDialogOpenRef,
    mobileModeRef,
    muxotronExpandedRef,
    overflowOpenRef,
    overlayOpenRef,
    paneTabBorderHitTestRef,
    paneTabBorderRightClickRef,
    paneTabDragEndRef,
    paneTabDragMoveRef,
    paneTabDraggingRef,
    ptyDragActiveRef,
    qtResizeDragEndRef,
    qtResizeDragMoveRef,
    qtResizeDraggingRef,
    qtResizeSizeRef,
    sidebarDragEndRef,
    sidebarDragMoveRef,
    sidebarDraggingRef,
    sidebarOpenRef,
    sidebarWidthRef,
    statusBarBottomOffsetRef,
    statusBarClickRef,
    statusBarTopOffsetRef,
    tabDragEndRef,
    tabDragMoveRef,
    tabDraggingRef,
    tabPressOriginRef,
    tabRightClickRef,
    uiModeRef,
  } = mouse;

  // Press ownership: when a press is forwarded to the PTY, all
  // subsequent motion and release for that gesture must also go to
  // the PTY (or be consumed). Letting an orphaned release reach
  // OpenTUI crashes yoga in finishSelection.
  const ptyOwnsPress = { current: false };
  let ptyHintFired = false;
  let pressOnBorder = false;
  let tabSecondaryPressSeen = false;
  let clickToMoveGesture = false;
  let paneTabPressOrigin: {
    paneId: string;
    paneWidth: number;
    screenX: number;
    screenY: number;
    xOffset: number;
  } | null = null;
  let paneTabDragSource: { paneId: string; xOffset: number } | null = null;

  /** Convert screen Y to 0-based PTY Y, accounting for UI mode content offset. */
  function screenToPtyY(screenY: number): number {
    const mode = uiModeRef.current;
    if (mode === "raw") return screenY - 1;
    if (mode === "marquee-top") return screenY - (1 + statusBarTopOffsetRef.current + 3);
    if (mode === "marquee-bottom") return screenY - (1 + statusBarTopOffsetRef.current);
    return screenY - 3 - 1;
  }

  function findPaneTabDragTarget(ptyX: number, ptyY: number): { paneId: string; xOffset: number } | null {
    for (const p of paneRectsRef.current) {
      if (!p.id) continue;
      const withinX = ptyX >= p.left && ptyX < p.left + p.width;
      const withinY = ptyY >= p.top - 1 && ptyY < p.top + p.height;
      if (withinX && withinY) {
        return {
          paneId: p.id,
          xOffset: ptyX - p.left,
        };
      }
    }
    return null;
  }

  /**
   * Check if a press event lands on a pane border row and handle it.
   * ptyX/ptyY are 0-based PTY coordinates. Returns "consume" if handled, null otherwise.
   */
  function handlePaneBorderPress(
    button: number,
    ptyX: number,
    ptyY: number,
    screenX: number,
    screenY: number,
  ): "consume" | null {
    const rects = paneRectsRef.current;
    const baseBtn = button & 3;
    const hasAlt = (button & 8) !== 0;
    const hasCtrl = (button & 16) !== 0;
    const isSecondary = baseBtn === 2 || baseBtn === 3 || (baseBtn === 0 && (hasAlt || hasCtrl));
    if (isSecondary) {
      for (const p of rects) {
        if (p.id && ptyY === p.top - 1 && ptyX >= p.left && ptyX < p.left + p.width) {
          if (paneTabBorderRightClickRef.current?.(p.id, ptyX - p.left, screenX, screenY)) {
            return "consume";
          }
          break;
        }
      }
    }
    if (baseBtn === 0) {
      for (const p of rects) {
        if (p.id && ptyY === p.top - 1 && ptyX >= p.left && ptyX < p.left + p.width) {
          if (paneTabBorderHitTestRef.current?.(p.id, ptyX - p.left)) {
            paneTabPressOrigin = { paneId: p.id, paneWidth: p.width, screenX, screenY, xOffset: ptyX - p.left };
            return "consume";
          }
          if (p.active) {
            paneTabBorderClickRef.current?.(p.id, ptyX - p.left, p.width, screenX, screenY);
            // Always consume left-clicks on the active pane's border row
            // so they don't leak into the PTY gesture tracker (which would
            // activate ptyDragging on subsequent motion, hiding header
            // controls).
            return "consume";
          }
          break;
        }
      }
    }
    return null;
  }

  return (screenX: number, screenY: number, button: number, suffix: string) => {
    // Sidebar X offset: when sidebar is open, PTY coordinates shift left
    const sidebarOff = sidebarOpenRef.current ? sidebarWidthRef.current + 1 : 0;

    // Common event-type flags (used early by drag handlers)
    const isRelease = suffix === "m";
    const isMotion = (button & 32) !== 0;
    const isPress = suffix === "M" && !isMotion;

    // Keyboard-only mode: swallow all mouse events (including OpenTUI)
    if (ignoreMouseInputRef.current) return "consume";
    // Mobile mode: let OpenTUI handle all mouse events for the mobile UI
    if (mobileModeRef.current) return null;
    // Zoom overlay: any click dismisses the full-screen overlay.
    // In-place mux-o-tron zoom keeps clicks flowing to OpenTUI so its
    // button strip can still be used while the modifier is held.
    if (muxotronFocusActiveRef.current) {
      if (!zoomActionRef || zoomActionRef.current === null) return null;
      // Let scroll events reach OpenTUI so overlay trees can scroll
      if ((button & 64) !== 0) return null;
      if (isPress) handleZoomEndRef.current?.();
      return "consume";
    }

    // Sidebar/toolbar focus: any click dismisses keyboard focus.
    // Clicking inside the focused panel switches to mouse interaction,
    // clicking outside dismisses it entirely.
    if (isPress && (sidebarFocusedRef.current || toolbarFocusedIndexRef.current >= 0)) {
      if (sidebarFocusedRef.current) {
        handleSidebarCancelRef.current();
      }
      if (toolbarFocusedIndexRef.current >= 0) {
        handleToolbarCancelRef.current();
      }
    }

    // Muxotron expanded (non-zoom): clicking outside the muxotron area
    // collapses the expansion. The click still falls through to normal
    // handling so the PTY/UI receives it.
    if (isPress && muxotronExpandedRef.current && !muxotronFocusActiveRef.current) {
      const uiMode = uiModeRef.current;
      let outsideMuxotron = false;
      if (uiMode === "marquee-top") {
        const muxEnd = 1 + statusBarTopOffsetRef.current + 3;
        outsideMuxotron = screenY >= muxEnd;
      } else if (uiMode === "marquee-bottom") {
        const { height: h } = dimsRef.current;
        const muxStart = h - 3 + 1;
        outsideMuxotron = screenY < muxStart;
      } else if (uiMode !== "raw") {
        // Full mode: tab bar rows 1-3 contain the muxotron
        outsideMuxotron = screenY > 3;
      }
      if (outsideMuxotron) {
        handleMuxotronDismissRef.current?.();
      }
    }

    if (clickToMoveGesture) {
      if (suffix === "m") clickToMoveGesture = false;
      return "consume";
    }

    // Sidebar resize drag — owns all events until release
    if (sidebarDraggingRef.current) {
      if (suffix === "m") {
        sidebarDraggingRef.current = false;
        sidebarDragEndRef.current?.();
        return "consume";
      }
      if ((button & 32) !== 0) {
        sidebarDragMoveRef.current?.(screenX);
        return "consume";
      }
      return "consume";
    }

    // Pane tab drag mode — owns all events until release
    if (paneTabDraggingRef.current) {
      const sOff = sidebarOpenRef.current ? sidebarWidthRef.current + 1 : 0;
      const ptyX = screenX - sOff - 1;
      const ptyY = screenToPtyY(screenY);
      const target = findPaneTabDragTarget(ptyX, ptyY);
      const targetPaneId = target?.paneId ?? null;
      const targetXOffset = target?.xOffset ?? 0;
      if (isRelease) {
        const src = paneTabDragSource;
        paneTabDragSource = null;
        if (src) paneTabDragEndRef.current?.(src.paneId, src.xOffset, targetPaneId, targetXOffset);
        return "consume";
      }
      if (isPress) {
        const src = paneTabDragSource;
        paneTabDragSource = null;
        if (src) paneTabDragEndRef.current?.(src.paneId, src.xOffset, null, 0);
        return null;
      }
      if (paneTabDragSource) {
        paneTabDragMoveRef.current?.(
          paneTabDragSource.paneId,
          paneTabDragSource.xOffset,
          targetPaneId,
          targetXOffset,
          screenX,
          screenY,
        );
      }
      return "consume";
    }

    // Pane tab press origin tracking — drag initiation
    if (paneTabPressOrigin !== null) {
      if (isRelease) {
        const origin = paneTabPressOrigin;
        paneTabPressOrigin = null;
        // Fire deferred click (no drag happened)
        paneTabBorderClickRef.current?.(
          origin.paneId,
          origin.xOffset,
          origin.paneWidth,
          origin.screenX,
          origin.screenY,
        );
        return "consume";
      }
      if (isMotion) {
        const dx = Math.abs(screenX - paneTabPressOrigin.screenX);
        const dy = Math.abs(screenY - paneTabPressOrigin.screenY);
        if (dx >= 3 || dy >= 2) {
          paneTabDragSource = { paneId: paneTabPressOrigin.paneId, xOffset: paneTabPressOrigin.xOffset };
          paneTabPressOrigin = null;
          paneTabDraggingRef.current = true;
          // Fire initial move
          const sOff = sidebarOpenRef.current ? sidebarWidthRef.current + 1 : 0;
          const ptyX = screenX - sOff - 1;
          const ptyY = screenToPtyY(screenY);
          const target = findPaneTabDragTarget(ptyX, ptyY);
          const targetPaneId = target?.paneId ?? null;
          const targetXOffset = target?.xOffset ?? 0;
          paneTabDragMoveRef.current?.(
            paneTabDragSource.paneId,
            paneTabDragSource.xOffset,
            targetPaneId,
            targetXOffset,
            screenX,
            screenY,
          );
        }
        return "consume";
      }
      if (isPress) {
        paneTabPressOrigin = null;
        // Fall through to handle new press
      }
    }

    // Quick terminal resize drag — owns all events until release
    if (qtResizeDraggingRef.current) {
      if (isRelease) {
        qtResizeDraggingRef.current = false;
        qtResizeDragEndRef.current?.();
        return "consume";
      }
      if (isMotion) {
        qtResizeDragMoveRef.current?.(screenX, screenY);
        return "consume";
      }
      return "consume";
    }

    // When dropdown/overlay is open, let OpenTUI handle all mouse events
    // (but detect press on the QT resize handle corner first)
    if (
      dropdownOpenRef.current ||
      layoutDropdownOpenRef.current ||
      overflowOpenRef.current ||
      agentsDialogOpenRef.current ||
      overlayOpenRef.current ||
      mainMenuDialogOpenRef.current ||
      agentInstallDialogRef.current ||
      dropdownInputRef.current !== null
    ) {
      // Detect press on the quick terminal ↘ resize corner (backup for onMouseDown)
      if (overlayOpenRef.current && isPress && (button & 3) === 0 && qtResizeDragMoveRef.current) {
        const { height, width } = dimsRef.current;
        const pct = qtResizeSizeRef.current / 100;
        const ow = Math.max(20, Math.floor(width * pct));
        const oh = Math.max(8, Math.floor(height * pct));
        const ol = Math.floor((width - ow) / 2);
        const ot = Math.floor((height - oh) / 2);
        // ⤡ sits at the bottom-right corner of the overlay border (1-based SGR coords)
        if (screenX === ol + ow && screenY === ot + oh) {
          qtResizeDraggingRef.current = true;
          return "consume";
        }
      }
      tabPressOriginRef.current = null;
      paneTabPressOrigin = null;
      return null;
    }

    const { height } = dimsRef.current;
    const uiMode = uiModeRef.current;

    // === Raw mode: full-screen content, no tab bar ===
    if (uiMode === "raw") {
      // PTY owns the current gesture
      if (ptyOwnsPress.current) {
        if (isRelease) {
          ptyOwnsPress.current = false;
          if (ptyHintFired) {
            ptyHintFired = false;
            ptyDragActiveRef.current?.(false);
          }
        }
        return { x: screenX - sidebarOff, y: screenY };
      }
      // Sidebar area — let OpenTUI handle clicks inside sidebar
      if (sidebarOpenRef.current && screenX <= sidebarWidthRef.current) {
        if (isPress && screenX >= sidebarWidthRef.current - 1) {
          sidebarDraggingRef.current = true;
          return "consume";
        }
        return null;
      }
      // Toolbar area — let OpenTUI handle button clicks
      const { width: plainWidth } = dimsRef.current;
      if (toolbarOpenRef.current && screenX >= plainWidth - TOOLBAR_WIDTH) {
        return null;
      }
      // Status bar click interception
      if (isPress && (button & 3) === 0) {
        const topOff = statusBarTopOffsetRef.current;
        const botOff = statusBarBottomOffsetRef.current;
        const onStatusTop = topOff > 0 && screenY >= 1 && screenY <= topOff;
        const onStatusBot = botOff > 0 && screenY > height - botOff && screenY <= height;
        if (onStatusTop || onStatusBot) {
          const statusX = screenX - sidebarOff;
          if (statusX >= 1 && statusX <= 20 && statusBarClickRef.current?.()) {
            return "consume";
          }
        }
      }
      if (isPress && (button & 64) === 0) {
        const ptyX = screenX - sidebarOff - 1;
        const ptyY = screenY - 1;
        const borderResult = handlePaneBorderPress(button, ptyX, ptyY, screenX, screenY);
        if (borderResult) return borderResult;
        ptyOwnsPress.current = true;
        if ((button & 8) !== 0 && !ptyHintFired) {
          ptyHintFired = true;
          ptyDragActiveRef.current?.(true);
        }
      }
      return { x: screenX - sidebarOff, y: screenY };
    }

    // === Marquee mode (no borders, full-width content + muxotronEnabled) ===
    if (uiMode === "marquee-top" || uiMode === "marquee-bottom") {
      const offset = statusBarTopOffsetRef.current;
      const muxotronEnabledRows = 3;
      let muxotronEnabledY0: number;
      let muxotronEnabledY1: number;
      let contentY0: number;
      let contentY1: number;

      if (uiMode === "marquee-top") {
        // Muxotron at top, content below
        muxotronEnabledY0 = 1 + offset;
        muxotronEnabledY1 = muxotronEnabledY0 + muxotronEnabledRows;
        contentY0 = muxotronEnabledY1;
        contentY1 = height;
      } else {
        // Content at top, muxotronEnabled at bottom
        contentY0 = 1 + offset;
        contentY1 = height - muxotronEnabledRows;
        muxotronEnabledY0 = contentY1 + 1;
        muxotronEnabledY1 = muxotronEnabledY0 + muxotronEnabledRows;
      }

      // PTY owns gesture tracking
      if (ptyOwnsPress.current) {
        if (isRelease) {
          ptyOwnsPress.current = false;
          if (ptyHintFired) {
            ptyHintFired = false;
            ptyDragActiveRef.current?.(false);
          }
        }
        if (screenY >= contentY0 && screenY <= contentY1) {
          return { x: screenX - sidebarOff, y: screenY - contentY0 + 1 };
        }
        if (isPress) {
          ptyOwnsPress.current = false;
          if (ptyHintFired) {
            ptyHintFired = false;
            ptyDragActiveRef.current?.(false);
          }
          return null;
        }
        return "consume";
      }

      // Muxotron area — let OpenTUI handle muxotronEnabled clicks
      if (screenY >= muxotronEnabledY0 && screenY < muxotronEnabledY1) {
        return null; // OpenTUI handles full-width muxotronEnabled
      }

      // Content area
      if (screenY >= contentY0 && screenY <= contentY1) {
        // Sidebar area — let OpenTUI handle clicks inside sidebar
        if (sidebarOpenRef.current && screenX <= sidebarWidthRef.current) {
          if (isPress && screenX >= sidebarWidthRef.current - 1) {
            sidebarDraggingRef.current = true;
            return "consume";
          }
          return null;
        }
        // Toolbar area — let OpenTUI handle button clicks
        const { width: marqueeWidth } = dimsRef.current;
        if (toolbarOpenRef.current && screenX >= marqueeWidth - TOOLBAR_WIDTH) {
          return null;
        }
        if (isPress && (button & 64) === 0) {
          const ptyX = screenX - sidebarOff - 1;
          const ptyY = screenY - contentY0; // 0-based
          const borderResult = handlePaneBorderPress(button, ptyX, ptyY, screenX, screenY);
          if (borderResult) return borderResult;
          const rects = paneRectsRef.current;
          const pressOnPaneBorder =
            rects.length > 1 &&
            !rects.some(
              (pane) =>
                ptyX >= pane.left && ptyX < pane.left + pane.width && ptyY >= pane.top && ptyY < pane.top + pane.height,
            );
          if ((button & 3) === 0 && !pressOnPaneBorder && clickToMoveRef.current) {
            if (clickToMoveRef.current(screenX - sidebarOff, screenY - contentY0 + 1)) {
              clickToMoveGesture = true;
              return "consume";
            }
          }
          ptyOwnsPress.current = true;
          if ((button & 8) !== 0 && !ptyHintFired && !pressOnPaneBorder) {
            ptyHintFired = true;
            ptyDragActiveRef.current?.(true);
          }
        }
        return { x: screenX - sidebarOff, y: screenY - contentY0 + 1 };
      }

      return "consume";
    }

    // === Full mode (no borders, tab bar rows 1-3, content below) ===

    // During tab drag, handle everything at the raw level
    if (tabDraggingRef.current) {
      if (isRelease) {
        tabDragEndRef.current?.(screenX);
        return "consume";
      }
      if (isPress) {
        tabDragEndRef.current?.(screenX);
        return null;
      }
      if (screenY >= 1 && screenY <= 3) {
        tabDragMoveRef.current?.(screenX);
      }
      return "consume";
    }

    // PTY owns the current gesture
    if (ptyOwnsPress.current) {
      if (isRelease) {
        ptyOwnsPress.current = false;
        pressOnBorder = false;
        if (ptyHintFired) {
          ptyHintFired = false;
          ptyDragActiveRef.current?.(false);
        }
      }
      if (screenY > 3 && screenY <= height) {
        if (isMotion && !ptyHintFired && !pressOnBorder && (button & 3) === 0) {
          ptyHintFired = true;
          ptyDragActiveRef.current?.(true);
        }
        return { x: screenX - sidebarOff, y: screenY - 3 };
      }
      if (isPress) {
        ptyOwnsPress.current = false;
        if (ptyHintFired) {
          ptyHintFired = false;
          ptyDragActiveRef.current?.(false);
        }
        return null;
      }
      return "consume";
    }

    // Tab bar: rows 1-3
    if (screenY >= 1 && screenY <= 3) {
      const baseButton = button & 3;
      const hasAlt = (button & 8) !== 0;
      const hasCtrl = (button & 16) !== 0;
      const isModifierSecondary = baseButton === 0 && (hasAlt || hasCtrl);
      // Some terminals have been observed to report secondary-click press
      // as button code 3 with suffix "M". Treat both 2 and 3 as right-click.
      // Also treat modifier-left variants (e.g. ctrl-click right-click emulation)
      // as secondary-click in the tab bar.
      const isModifierSecondaryPress = isPress && !isMotion && isModifierSecondary;
      const isSecondaryPress =
        isPress && !isMotion && (baseButton === 2 || baseButton === 3 || isModifierSecondaryPress);
      if (isSecondaryPress) {
        const onSecondaryClick = tabRightClickRef.current;
        if (!onSecondaryClick) {
          tabSecondaryPressSeen = false;
          tabPressOriginRef.current = null;
          return null;
        }
        tabSecondaryPressSeen = true;
        tabPressOriginRef.current = null;
        onSecondaryClick(screenX);
        return "consume";
      }
      if (isRelease && (baseButton === 2 || baseButton === 3 || isModifierSecondary)) {
        const hadSecondaryPress = tabSecondaryPressSeen;
        const onSecondaryClick = tabRightClickRef.current;
        // Release-only fallback for terminals that emit only secondary release.
        if (!hadSecondaryPress && onSecondaryClick) {
          onSecondaryClick(screenX);
        }
        tabSecondaryPressSeen = false;
        tabPressOriginRef.current = null;
        if (hadSecondaryPress || onSecondaryClick) {
          return "consume";
        }
        return null;
      }
      if (isMotion) {
        if (tabPressOriginRef.current !== null && tabDragMoveRef.current) {
          const dx = Math.abs(screenX - tabPressOriginRef.current);
          if (dx >= 3) {
            tabPressOriginRef.current = null;
            tabDraggingRef.current = true;
            tabDragMoveRef.current(screenX);
          }
        }
        // Never let tab-bar motion reach OpenTUI; tiny pointer jitter during
        // click can otherwise trigger text-selection side effects.
        return "consume";
      }
      if (isPress && button === 0) {
        tabSecondaryPressSeen = false;
        tabPressOriginRef.current = screenX;
      } else if (isRelease) {
        tabPressOriginRef.current = null;
      }
      return null;
    }

    // Contain tab-press gesture
    if (tabPressOriginRef.current !== null) {
      if (isRelease) {
        tabPressOriginRef.current = null;
      }
      if (!isPress) return "consume";
      tabPressOriginRef.current = null;
    }

    // Content: forward to PTY
    if (screenY > 3 && screenY <= height) {
      // Sidebar area — let OpenTUI handle clicks inside sidebar
      if (sidebarOpenRef.current && screenX <= sidebarWidthRef.current) {
        // Detect press on sidebar's right edge (the border column) for drag resize
        if (isPress && screenX >= sidebarWidthRef.current - 1) {
          sidebarDraggingRef.current = true;
          return "consume";
        }
        return null;
      }
      // Toolbar area — let OpenTUI handle button clicks
      const { width } = dimsRef.current;
      if (toolbarOpenRef.current && screenX >= width - TOOLBAR_WIDTH) {
        return null;
      }
      // Status bar click: intercept left-clicks on the status-left region (first 20 cols)
      if (isPress && (button & 3) === 0) {
        const topOff = statusBarTopOffsetRef.current;
        const botOff = statusBarBottomOffsetRef.current;
        const onStatusTop = topOff > 0 && screenY >= 4 && screenY <= 3 + topOff;
        const onStatusBot = botOff > 0 && screenY > height - botOff && screenY <= height;
        if (onStatusTop || onStatusBot) {
          // status-left-length is 20 by default; check left region
          const statusX = screenX - sidebarOff;
          if (statusX >= 1 && statusX <= 20 && statusBarClickRef.current?.()) {
            return "consume";
          }
        }
      }
      if (isPress && (button & 64) === 0) {
        const ptyX = screenX - sidebarOff - 1; // 0-based
        const ptyY = screenY - 3 - 1; // 0-based
        const borderResult = handlePaneBorderPress(button, ptyX, ptyY, screenX, screenY);
        if (borderResult) return borderResult;
        const rects = paneRectsRef.current;
        pressOnBorder =
          rects.length > 1 &&
          !rects.some((p) => ptyX >= p.left && ptyX < p.left + p.width && ptyY >= p.top && ptyY < p.top + p.height);
        if ((button & 3) === 0 && !pressOnBorder && clickToMoveRef.current) {
          if (clickToMoveRef.current(screenX - sidebarOff, screenY - 3)) {
            clickToMoveGesture = true;
            return "consume";
          }
        }
        ptyOwnsPress.current = true;
        // Alt/Option modifier on press — immediately activate drag hint
        // (skip if on a pane border — user is resizing, not selecting)
        if ((button & 8) !== 0 && !ptyHintFired && !pressOnBorder) {
          ptyHintFired = true;
          ptyDragActiveRef.current?.(true);
        }
      }
      return { x: screenX - sidebarOff, y: screenY - 3 };
    }

    return "consume";
  };
}
