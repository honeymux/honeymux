import { describe, expect, test } from "bun:test";

import { createMouseCoordinateMapper } from "./create-mouse-coordinate-mapper.ts";

function createMapperHarness(
  uiMode: "adaptive" | "marquee-bottom" | "marquee-top" | "raw" = "adaptive",
  withRightClickHandler = true,
  paneRects: Array<{ height: number; left: number; top: number; width: number }> = [],
  clickToMove: ((ptyX: number, ptyY: number) => boolean) | null = null,
  muxotronFocusActive = false,
  zoomAction: "zoomAgentsView" | "zoomServerView" | null = null,
) {
  const rightClickCalls: number[] = [];
  const zoomEndCalls: number[] = [];
  const tabRightClickRef: { current: ((x: number) => void) | null } = {
    current: withRightClickHandler
      ? (x: number) => {
          rightClickCalls.push(x);
        }
      : null,
  };

  const mapper = createMouseCoordinateMapper({
    clickToMoveRef: { current: clickToMove },
    dialogs: {
      agentInstallDialogRef: { current: false },
      dropdownInputRef: { current: null },
    } as any,
    input: {
      handleSidebarCancelRef: { current: () => {} },
      handleToolbarCancelRef: { current: () => {} },
      handleZoomEndRef: {
        current: () => {
          zoomEndCalls.push(1);
        },
      },
      muxotronFocusActiveRef: { current: muxotronFocusActive },
      paneTabBorderClickRef: { current: null },
      sidebarFocusedRef: { current: false },
      toolbarFocusedIndexRef: { current: -1 },
      toolbarOpenRef: { current: false },
      zoomActionRef: { current: zoomAction },
    } as any,
    mouse: {
      agentsDialogOpenRef: { current: false },
      dropdownOpenRef: { current: false },
      ignoreMouseInputRef: { current: false },
      layoutDropdownOpenRef: { current: false },
      mainMenuDialogOpenRef: { current: false },
      mobileModeRef: { current: false },
      muxotronExpandedRef: { current: false },
      overflowOpenRef: { current: false },
      overlayOpenRef: { current: false },
      paneTabBorderClickRef: { current: null },
      paneTabBorderHitTestRef: { current: null },
      paneTabBorderRightClickRef: { current: null },
      paneTabDragEndRef: { current: null },
      paneTabDragMoveRef: { current: null },
      paneTabDraggingRef: { current: false },
      qtResizeDragEndRef: { current: null },
      qtResizeDragMoveRef: { current: null },
      qtResizeDraggingRef: { current: false },
      qtResizeSizeRef: { current: 90 },
      quickTerminalMenuOpenRef: { current: false },
      sidebarDragEndRef: { current: null },
      sidebarDragMoveRef: { current: null },
      sidebarDraggingRef: { current: false },
      sidebarOpenRef: { current: false },
      sidebarWidthRef: { current: 32 },
      statusBarBottomOffsetRef: { current: 0 },
      statusBarClickRef: { current: null },
      statusBarTopOffsetRef: { current: 0 },
      tabDragEndRef: { current: null },
      tabDragMoveRef: { current: null },
      tabDraggingRef: { current: false },
      tabPressOriginRef: { current: null },
      tabRightClickRef,
      toolbarOpenRef: { current: false },
      uiModeRef: { current: uiMode },
    } as any,
    paneRectsRef: { current: paneRects },
    sessionRuntime: {
      dimsRef: { current: { height: 40, width: 120 } },
    } as any,
  });

  return { mapper, rightClickCalls, zoomEndCalls };
}

describe("createMouseCoordinateMapper", () => {
  test("consumes right-click in tab bar and routes it to tab handler", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive");

    const result = mapper(22, 2, 2, "M");
    expect(result).toBe("consume");
    expect(rightClickCalls).toEqual([22]);
  });

  test("treats button-code 3 press as secondary click in tab bar", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive");

    const result = mapper(18, 2, 3, "M");
    expect(result).toBe("consume");
    expect(rightClickCalls).toEqual([18]);
  });

  test("treats ctrl-left press as secondary click in tab bar", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive");

    const result = mapper(15, 2, 16, "M");
    expect(result).toBe("consume");
    expect(rightClickCalls).toEqual([15]);
  });

  test("consumes ctrl-left release in tab bar and does not double-trigger", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive");

    expect(mapper(15, 2, 16, "M")).toBe("consume");
    expect(mapper(15, 2, 16, "m")).toBe("consume");
    expect(rightClickCalls).toEqual([15]);
  });

  test("consumes tab-bar motion during ctrl-left secondary-click gesture", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive");

    expect(mapper(15, 2, 16, "M")).toBe("consume");
    expect(mapper(16, 2, 48, "M")).toBe("consume");
    expect(mapper(16, 2, 16, "m")).toBe("consume");
    expect(rightClickCalls).toEqual([15]);
  });

  test("consumes plain tab-bar motion to prevent OpenTUI selection artifacts", () => {
    const { mapper } = createMapperHarness("adaptive");

    const result = mapper(20, 2, 32, "M");
    expect(result).toBe("consume");
  });

  test("falls back to OpenTUI for ctrl-left press when raw secondary handler is absent", () => {
    const { mapper, rightClickCalls } = createMapperHarness("adaptive", false);

    expect(mapper(15, 2, 16, "M")).toBeNull();
    expect(mapper(15, 2, 16, "m")).toBeNull();
    expect(rightClickCalls).toEqual([]);
  });

  test("fires click-to-move on release for a bare click in full mode", () => {
    const calls: Array<[number, number]> = [];
    const { mapper } = createMapperHarness("adaptive", true, [], (ptyX, ptyY) => {
      calls.push([ptyX, ptyY]);
      return true;
    });

    // Press and release without motion → click-to-move fires on release.
    expect(mapper(10, 6, 0, "M")).toEqual({ x: 10, y: 3 });
    expect(calls).toEqual([]);
    expect(mapper(10, 6, 0, "m")).toEqual({ x: 10, y: 3 });
    expect(calls).toEqual([[10, 3]]);
  });

  test("cancels pending click-to-move on motion so drag selection reaches tmux", () => {
    const calls: Array<[number, number]> = [];
    const { mapper } = createMapperHarness("adaptive", true, [], (ptyX, ptyY) => {
      calls.push([ptyX, ptyY]);
      return true;
    });

    // Press, motion, release: click-to-move must NOT fire — tmux gets the drag.
    expect(mapper(10, 6, 0, "M")).toEqual({ x: 10, y: 3 });
    expect(mapper(11, 6, 32, "M")).toEqual({ x: 11, y: 3 });
    expect(mapper(15, 6, 0, "m")).toEqual({ x: 15, y: 3 });
    expect(calls).toEqual([]);
  });

  test("fires click-to-move on release for a bare click in marquee-top mode", () => {
    const calls: Array<[number, number]> = [];
    const { mapper } = createMapperHarness("marquee-top", true, [], (ptyX, ptyY) => {
      calls.push([ptyX, ptyY]);
      return true;
    });

    expect(mapper(12, 7, 0, "M")).toEqual({ x: 12, y: 4 });
    expect(calls).toEqual([]);
    expect(mapper(12, 7, 0, "m")).toEqual({ x: 12, y: 4 });
    expect(calls).toEqual([[12, 4]]);
  });

  test("forwards shift+scroll wheel events to tmux coordinates", () => {
    const { mapper } = createMapperHarness("adaptive");

    expect(mapper(12, 7, 68, "M")).toEqual({ x: 12, y: 4 });
  });

  test("allows dropping a pane tab anywhere inside the target pane", () => {
    const dragMoves: Array<{ targetPaneId: null | string; targetXOffset: number }> = [];
    const dragEnds: Array<{ targetPaneId: null | string; targetXOffset: number }> = [];
    const paneTabDraggingRef = { current: false };
    const mapper = createMouseCoordinateMapper({
      clickToMoveRef: { current: null },
      dialogs: {
        agentInstallDialogRef: { current: false },
        dropdownInputRef: { current: null },
      } as any,
      input: {
        handleSidebarCancelRef: { current: () => {} },
        handleToolbarCancelRef: { current: () => {} },
        handleZoomEndRef: { current: null },
        muxotronFocusActiveRef: { current: false },
        paneTabBorderClickRef: { current: null },
        sidebarFocusedRef: { current: false },
        toolbarFocusedIndexRef: { current: -1 },
        toolbarOpenRef: { current: false },
        zoomActionRef: { current: null },
      } as any,
      mouse: {
        agentsDialogOpenRef: { current: false },
        dropdownOpenRef: { current: false },
        ignoreMouseInputRef: { current: false },
        layoutDropdownOpenRef: { current: false },
        mainMenuDialogOpenRef: { current: false },
        mobileModeRef: { current: false },
        muxotronExpandedRef: { current: false },
        overflowOpenRef: { current: false },
        overlayOpenRef: { current: false },
        paneTabBorderHitTestRef: {
          current: (paneId: string) => paneId === "%1",
        },
        paneTabBorderRightClickRef: { current: null },
        paneTabDragEndRef: {
          current: (
            _sourcePaneId: string,
            _sourceXOffset: number,
            targetPaneId: null | string,
            targetXOffset: number,
          ) => {
            dragEnds.push({ targetPaneId, targetXOffset });
          },
        },
        paneTabDragMoveRef: {
          current: (
            _sourcePaneId: string,
            _sourceXOffset: number,
            targetPaneId: null | string,
            targetXOffset: number,
          ) => {
            dragMoves.push({ targetPaneId, targetXOffset });
          },
        },
        paneTabDraggingRef,
        qtResizeDragEndRef: { current: null },
        qtResizeDragMoveRef: { current: null },
        qtResizeDraggingRef: { current: false },
        qtResizeSizeRef: { current: 90 },
        quickTerminalMenuOpenRef: { current: false },
        sidebarDragEndRef: { current: null },
        sidebarDragMoveRef: { current: null },
        sidebarDraggingRef: { current: false },
        sidebarOpenRef: { current: false },
        sidebarWidthRef: { current: 32 },
        statusBarBottomOffsetRef: { current: 0 },
        statusBarClickRef: { current: null },
        statusBarTopOffsetRef: { current: 0 },
        tabDragEndRef: { current: null },
        tabDragMoveRef: { current: null },
        tabDraggingRef: { current: false },
        tabPressOriginRef: { current: null },
        tabRightClickRef: { current: null },
        toolbarOpenRef: { current: false },
        uiModeRef: { current: "adaptive" },
      } as any,
      paneRectsRef: {
        current: [
          { active: true, height: 36, id: "%1", left: 0, top: 1, width: 60 },
          { active: false, height: 36, id: "%2", left: 61, top: 1, width: 59 },
        ],
      },
      sessionRuntime: {
        dimsRef: { current: { height: 40, width: 120 } },
      } as any,
    });

    expect(mapper(10, 4, 0, "M")).toBe("consume");
    expect(mapper(80, 8, 32, "M")).toBe("consume");
    expect(dragMoves).toEqual([{ targetPaneId: "%2", targetXOffset: 18 }]);
    expect(paneTabDraggingRef.current).toBe(true);

    expect(mapper(80, 8, 0, "m")).toBe("consume");
    expect(dragEnds).toEqual([{ targetPaneId: "%2", targetXOffset: 18 }]);
  });

  test("dismisses full-screen zoom overlays on click", () => {
    const { mapper, zoomEndCalls } = createMapperHarness("adaptive", true, [], null, true, "zoomAgentsView");

    expect(mapper(10, 6, 0, "M")).toBe("consume");
    expect(zoomEndCalls).toEqual([1]);
  });

  test("passes scroll events to OpenTUI in full-screen zoom overlay", () => {
    const { mapper, zoomEndCalls } = createMapperHarness("adaptive", true, [], null, true, "zoomServerView");

    // Scroll up (button 64) and scroll down (button 65) should reach OpenTUI
    expect(mapper(10, 6, 64, "M")).toBeNull();
    expect(mapper(10, 6, 65, "M")).toBeNull();
    // Zoom should not be dismissed by scrolling
    expect(zoomEndCalls).toEqual([]);
  });

  test("lets in-place mux-o-tron zoom clicks pass through", () => {
    const { mapper, zoomEndCalls } = createMapperHarness("adaptive", true, [], null, true, null);

    expect(mapper(10, 6, 0, "M")).toBeNull();
    expect(zoomEndCalls).toEqual([]);
  });

  test("tolerates missing zoomActionRef wiring at runtime", () => {
    const mapper = createMouseCoordinateMapper({
      clickToMoveRef: { current: null },
      dialogs: {
        agentInstallDialogRef: { current: false },
        dropdownInputRef: { current: null },
      } as any,
      input: {
        handleSidebarCancelRef: { current: () => {} },
        handleToolbarCancelRef: { current: () => {} },
        handleZoomEndRef: { current: null },
        muxotronFocusActiveRef: { current: true },
        paneTabBorderClickRef: { current: null },
        sidebarFocusedRef: { current: false },
        toolbarFocusedIndexRef: { current: -1 },
        toolbarOpenRef: { current: false },
      } as any,
      mouse: {
        agentsDialogOpenRef: { current: false },
        dropdownOpenRef: { current: false },
        ignoreMouseInputRef: { current: false },
        layoutDropdownOpenRef: { current: false },
        mainMenuDialogOpenRef: { current: false },
        mobileModeRef: { current: false },
        muxotronExpandedRef: { current: false },
        overflowOpenRef: { current: false },
        overlayOpenRef: { current: false },
        paneTabBorderClickRef: { current: null },
        paneTabBorderHitTestRef: { current: null },
        paneTabBorderRightClickRef: { current: null },
        paneTabDragEndRef: { current: null },
        paneTabDragMoveRef: { current: null },
        paneTabDraggingRef: { current: false },
        qtResizeDragEndRef: { current: null },
        qtResizeDragMoveRef: { current: null },
        qtResizeDraggingRef: { current: false },
        qtResizeSizeRef: { current: 90 },
        quickTerminalMenuOpenRef: { current: false },
        sidebarDragEndRef: { current: null },
        sidebarDragMoveRef: { current: null },
        sidebarDraggingRef: { current: false },
        sidebarOpenRef: { current: false },
        sidebarWidthRef: { current: 32 },
        statusBarBottomOffsetRef: { current: 0 },
        statusBarClickRef: { current: null },
        statusBarTopOffsetRef: { current: 0 },
        tabDragEndRef: { current: null },
        tabDragMoveRef: { current: null },
        tabDraggingRef: { current: false },
        tabPressOriginRef: { current: null },
        tabRightClickRef: { current: null },
        toolbarOpenRef: { current: false },
        uiModeRef: { current: "adaptive" },
      } as any,
      paneRectsRef: { current: [] },
      sessionRuntime: {
        dimsRef: { current: { height: 40, width: 120 } },
      } as any,
    } as any);

    expect(mapper(10, 6, 0, "M")).toBeNull();
  });

  describe("quick terminal overlay", () => {
    // width=120, height=40, qtResizeSize=90 → ow=108, oh=36, ol=6, ot=2
    // Outer 1-based: x∈[7..114], y∈[3..38]. Body: x∈[8..113], y∈[4..37]. Resize corner: (114, 38)
    function createQtHarness() {
      const qtResizeDraggingRef = { current: false };
      const quickTerminalMenuOpenRef = { current: false };
      const mapper = createMouseCoordinateMapper({
        clickToMoveRef: { current: null },
        dialogs: {
          agentInstallDialogRef: { current: false },
          dropdownInputRef: { current: null },
        } as any,
        input: {
          handleSidebarCancelRef: { current: () => {} },
          handleToolbarCancelRef: { current: () => {} },
          handleZoomEndRef: { current: () => {} },
          muxotronFocusActiveRef: { current: false },
          paneTabBorderClickRef: { current: null },
          sidebarFocusedRef: { current: false },
          toolbarFocusedIndexRef: { current: -1 },
          toolbarOpenRef: { current: false },
          zoomActionRef: { current: null },
        } as any,
        mouse: {
          agentsDialogOpenRef: { current: false },
          dropdownOpenRef: { current: false },
          ignoreMouseInputRef: { current: false },
          layoutDropdownOpenRef: { current: false },
          mainMenuDialogOpenRef: { current: false },
          mobileModeRef: { current: false },
          muxotronExpandedRef: { current: false },
          overflowOpenRef: { current: false },
          overlayOpenRef: { current: true },
          paneTabBorderHitTestRef: { current: null },
          paneTabBorderRightClickRef: { current: null },
          paneTabDragEndRef: { current: null },
          paneTabDragMoveRef: { current: null },
          paneTabDraggingRef: { current: false },
          qtResizeDragEndRef: { current: () => {} },
          qtResizeDragMoveRef: { current: () => {} },
          qtResizeDraggingRef,
          qtResizeSizeRef: { current: 90 },
          quickTerminalMenuOpenRef,
          sidebarDragEndRef: { current: null },
          sidebarDragMoveRef: { current: null },
          sidebarDraggingRef: { current: false },
          sidebarOpenRef: { current: false },
          sidebarWidthRef: { current: 32 },
          statusBarBottomOffsetRef: { current: 0 },
          statusBarClickRef: { current: null },
          statusBarTopOffsetRef: { current: 0 },
          tabDragEndRef: { current: null },
          tabDragMoveRef: { current: null },
          tabDraggingRef: { current: false },
          tabPressOriginRef: { current: null },
          tabRightClickRef: { current: null },
          toolbarOpenRef: { current: false },
          uiModeRef: { current: "adaptive" },
        } as any,
        paneRectsRef: { current: [] },
        sessionRuntime: {
          dimsRef: { current: { height: 40, width: 120 } },
        } as any,
      });
      return { mapper, qtResizeDraggingRef, quickTerminalMenuOpenRef };
    }

    test("forwards body-interior press to QT PTY with local coordinates", () => {
      const { mapper } = createQtHarness();
      // Screen (20, 10) → local (20-7, 10-3) = (13, 7)
      expect(mapper(20, 10, 0, "M")).toEqual({ x: 13, y: 7 });
    });

    test("grabs press on resize corner and arms the drag", () => {
      const { mapper, qtResizeDraggingRef } = createQtHarness();
      expect(mapper(114, 38, 0, "M")).toBe("consume");
      expect(qtResizeDraggingRef.current).toBe(true);
    });

    test("returns null for presses on the top border (lets OpenTUI dispatch hamburger, etc.)", () => {
      const { mapper } = createQtHarness();
      // y=3 is the top border row — outside body
      expect(mapper(20, 3, 0, "M")).toBeNull();
    });

    test("returns null for backdrop clicks outside the overlay", () => {
      const { mapper } = createQtHarness();
      expect(mapper(2, 2, 0, "M")).toBeNull();
    });

    test("drags that started inside keep routing to QT even when motion leaves the body", () => {
      const { mapper } = createQtHarness();
      expect(mapper(20, 10, 0, "M")).toEqual({ x: 13, y: 7 });
      // motion well outside the overlay body — clamp to ow-2 = 106 on x
      const motion = mapper(200, 10, 32, "M");
      expect(motion).toEqual({ x: 106, y: 7 });
      // release also clamped and clears ownership
      const release = mapper(200, 10, 0, "m");
      expect(release).toEqual({ x: 106, y: 7 });
      // subsequent click outside the body no longer owned — returns null
      expect(mapper(2, 2, 0, "M")).toBeNull();
    });

    test("scroll wheel inside body forwards without taking press ownership", () => {
      const { mapper } = createQtHarness();
      // button 64 = scroll up (no press)
      expect(mapper(20, 10, 64, "M")).toEqual({ x: 13, y: 7 });
      // next backdrop click must still return null (scroll didn't claim ownership)
      expect(mapper(2, 2, 0, "M")).toBeNull();
    });

    test("hamburger menu open → all events pass through to OpenTUI", () => {
      const { mapper, quickTerminalMenuOpenRef } = createQtHarness();
      quickTerminalMenuOpenRef.current = true;
      // Even an in-body press goes to OpenTUI so menu item clicks fire
      expect(mapper(20, 10, 0, "M")).toBeNull();
    });
  });
});
