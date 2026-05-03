import type { MutableRefObject } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { SidebarView, UiChromeState } from "./use-app-state-groups.ts";

import { SIDEBAR_MIN_WIDTH, sidebarMaxWidth } from "../../components/sidebar.tsx";

export const SIDEBAR_VIEWS: SidebarView[] = ["agents", "server", "hook-sniffer"];

interface AppChromeFocusApi {
  handleSidebarViewChange: (view: SidebarView) => void;
  sidebarFocused: boolean;
  sidebarFocusedIndex: number;
  sidebarViewActivateRef: MutableRefObject<((index: number) => void) | null>;
  sidebarViewZoomRef: MutableRefObject<((index: number) => void) | null>;
  toolbarActivateRef: MutableRefObject<((index: number) => void) | null>;
  toolbarFocusedIndex: number;
}

interface UseAppChromeFocusOptions {
  refs: AppRuntimeRefs;
  uiChromeState: Pick<
    UiChromeState,
    | "setSidebarOpen"
    | "setSidebarView"
    | "setSidebarWidth"
    | "setToolbarOpen"
    | "sidebarOpen"
    | "sidebarView"
    | "sidebarWidth"
    | "toolbarOpen"
  >;
  width: number;
}

export function clampSidebarWidth(requestedWidth: number, terminalWidth: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(sidebarMaxWidth(terminalWidth), requestedWidth));
}

export function cycleSidebarView(view: SidebarView, direction: -1 | 1): SidebarView {
  const index = SIDEBAR_VIEWS.indexOf(view);
  const nextIndex = (index + direction + SIDEBAR_VIEWS.length) % SIDEBAR_VIEWS.length;
  return SIDEBAR_VIEWS[nextIndex]!;
}

export function getSidebarMinFocusIndex(view: SidebarView): number {
  return view === "hook-sniffer" ? 0 : 1;
}

export function useAppChromeFocus({ refs, uiChromeState, width }: UseAppChromeFocusOptions): AppChromeFocusApi {
  const {
    agentNavNextRef,
    agentNavPrevRef,
    agentPreviewRef,
    handleAgentNextRef,
    handleAgentPrevRef,
    handleSidebarActivateRef,
    handleSidebarCancelRef,
    handleSidebarDownRef,
    handleSidebarFocusRef,
    handleSidebarLeftRef,
    handleSidebarRightRef,
    handleSidebarToggleRef,
    handleSidebarUpRef,
    handleSidebarZoomRef,
    handleToolbarActivateRef,
    handleToolbarCancelRef,
    handleToolbarDismissRef,
    handleToolbarDownRef,
    handleToolbarFocusRef,
    handleToolbarToggleRef,
    handleToolbarUpRef,
    sidebarDragEndRef,
    sidebarDragMoveRef,
    sidebarFocusedIndexRef,
    sidebarFocusedRef,
    sidebarItemCountRef,
    sidebarOpenRef,
    sidebarWidthRef,
    toolbarFocusedIndexRef,
    toolbarItemCountRef,
    toolbarOpenRef,
  } = refs;
  const {
    setSidebarOpen,
    setSidebarView,
    setSidebarWidth,
    setToolbarOpen,
    sidebarOpen,
    sidebarView,
    sidebarWidth,
    toolbarOpen,
  } = uiChromeState;

  const [toolbarFocusedIndex, setToolbarFocusedIndex] = useState(-1);
  const toolbarLastIndexRef = useRef(0);
  const toolbarActivateRef = useRef<((index: number) => void) | null>(null);

  const [sidebarFocused, setSidebarFocused] = useState(false);
  const [sidebarFocusedIndex, setSidebarFocusedIndex] = useState(-1);
  const sidebarViewActivateRef = useRef<((index: number) => void) | null>(null);
  const sidebarViewZoomRef = useRef<((index: number) => void) | null>(null);

  const focusToolbar = useCallback(
    (index: number) => {
      toolbarFocusedIndexRef.current = index;
      toolbarLastIndexRef.current = index;
      setToolbarFocusedIndex(index);
    },
    [toolbarFocusedIndexRef],
  );

  const unfocusToolbar = useCallback(() => {
    toolbarFocusedIndexRef.current = -1;
    setToolbarFocusedIndex(-1);
  }, [toolbarFocusedIndexRef]);

  const focusSidebar = useCallback(
    (index: number) => {
      sidebarFocusedRef.current = true;
      sidebarFocusedIndexRef.current = index;
      setSidebarFocused(true);
      setSidebarFocusedIndex(index);
    },
    [sidebarFocusedIndexRef, sidebarFocusedRef],
  );

  const unfocusSidebar = useCallback(() => {
    sidebarFocusedRef.current = false;
    sidebarFocusedIndexRef.current = -1;
    setSidebarFocused(false);
    setSidebarFocusedIndex(-1);
  }, [sidebarFocusedIndexRef, sidebarFocusedRef]);

  const handleSidebarViewChange = useCallback(
    (view: SidebarView) => {
      setSidebarView(view);
    },
    [setSidebarView],
  );

  toolbarOpenRef.current = toolbarOpen;
  sidebarOpenRef.current = sidebarOpen;
  sidebarWidthRef.current = sidebarWidth;

  handleToolbarToggleRef.current = () => {
    setToolbarOpen(!toolbarOpen);
  };
  handleSidebarToggleRef.current = () => {
    setSidebarOpen(!sidebarOpen);
  };

  sidebarDragMoveRef.current = (x: number) => {
    setSidebarWidth(clampSidebarWidth(x, width));
  };
  sidebarDragEndRef.current = () => {
    // Optionally persist width to config here.
  };

  handleToolbarFocusRef.current = () => {
    if (toolbarFocusedIndexRef.current >= 0) {
      unfocusToolbar();
      return;
    }
    unfocusSidebar();
    if (!toolbarOpenRef.current) {
      setToolbarOpen(true);
    }
    focusToolbar(toolbarLastIndexRef.current);
  };
  handleToolbarUpRef.current = () => {
    unfocusSidebar();
    if (!toolbarOpenRef.current) {
      setToolbarOpen(true);
      focusToolbar(toolbarLastIndexRef.current);
      return;
    }
    const count = toolbarItemCountRef.current;
    if (count === 0) return;
    const currentIndex = toolbarFocusedIndexRef.current;
    focusToolbar(currentIndex <= 0 ? count - 1 : currentIndex - 1);
  };
  handleToolbarDownRef.current = () => {
    unfocusSidebar();
    if (!toolbarOpenRef.current) {
      setToolbarOpen(true);
      focusToolbar(toolbarLastIndexRef.current);
      return;
    }
    const count = toolbarItemCountRef.current;
    if (count === 0) return;
    const currentIndex = toolbarFocusedIndexRef.current;
    focusToolbar(currentIndex < 0 ? 0 : (currentIndex + 1) % count);
  };
  handleToolbarActivateRef.current = () => {
    const index = toolbarFocusedIndexRef.current;
    if (index >= 0) {
      toolbarActivateRef.current?.(index);
    }
  };
  handleToolbarCancelRef.current = unfocusToolbar;
  handleToolbarDismissRef.current = unfocusToolbar;

  handleSidebarFocusRef.current = () => {
    if (sidebarFocusedRef.current) {
      unfocusSidebar();
      return;
    }
    unfocusToolbar();
    if (!sidebarOpenRef.current) {
      setSidebarOpen(true);
    }
    focusSidebar(0);
  };
  // While the review preview is open, moving the sidebar focus should
  // also re-point the preview at the newly focused row so the muxotron view
  // follows along.
  const syncPreviewToFocus = () => {
    if (!agentPreviewRef.current) return;
    const idx = sidebarFocusedIndexRef.current;
    if (idx >= 0) sidebarViewZoomRef.current?.(idx);
  };

  handleSidebarUpRef.current = () => {
    const minFocusIndex = getSidebarMinFocusIndex(sidebarView);
    unfocusToolbar();
    if (!sidebarOpenRef.current) {
      setSidebarOpen(true);
      focusSidebar(minFocusIndex);
      syncPreviewToFocus();
      return;
    }
    const count = sidebarItemCountRef.current;
    if (count <= minFocusIndex) {
      focusSidebar(minFocusIndex);
      syncPreviewToFocus();
      return;
    }
    const currentIndex = sidebarFocusedIndexRef.current;
    focusSidebar(currentIndex <= minFocusIndex ? count - 1 : currentIndex - 1);
    syncPreviewToFocus();
  };
  handleSidebarDownRef.current = () => {
    const minFocusIndex = getSidebarMinFocusIndex(sidebarView);
    unfocusToolbar();
    if (!sidebarOpenRef.current) {
      setSidebarOpen(true);
      focusSidebar(minFocusIndex);
      syncPreviewToFocus();
      return;
    }
    const count = sidebarItemCountRef.current;
    if (count <= minFocusIndex) {
      focusSidebar(minFocusIndex);
      syncPreviewToFocus();
      return;
    }
    const currentIndex = sidebarFocusedIndexRef.current;
    focusSidebar(
      currentIndex < minFocusIndex ? minFocusIndex : currentIndex >= count - 1 ? minFocusIndex : currentIndex + 1,
    );
    syncPreviewToFocus();
  };
  handleSidebarLeftRef.current = () => {
    const minFocusIndex = getSidebarMinFocusIndex(sidebarView);
    unfocusToolbar();
    if (!sidebarOpenRef.current) {
      setSidebarOpen(true);
      focusSidebar(minFocusIndex);
      return;
    }
    const nextView = cycleSidebarView(sidebarView, -1);
    setSidebarView(nextView);
    focusSidebar(getSidebarMinFocusIndex(nextView));
  };
  handleSidebarRightRef.current = () => {
    const minFocusIndex = getSidebarMinFocusIndex(sidebarView);
    unfocusToolbar();
    if (!sidebarOpenRef.current) {
      setSidebarOpen(true);
      focusSidebar(minFocusIndex);
      return;
    }
    const nextView = cycleSidebarView(sidebarView, 1);
    setSidebarView(nextView);
    focusSidebar(getSidebarMinFocusIndex(nextView));
  };
  handleSidebarActivateRef.current = () => {
    const index = sidebarFocusedIndexRef.current;
    if (index >= 0) {
      sidebarViewActivateRef.current?.(index);
    }
    unfocusSidebar();
  };
  handleSidebarZoomRef.current = () => {
    const index = sidebarFocusedIndexRef.current;
    if (index >= 0) {
      sidebarViewZoomRef.current?.(index);
    }
  };
  handleSidebarCancelRef.current = unfocusSidebar;

  handleAgentNextRef.current = () => {
    if (agentNavNextRef.current) {
      agentNavNextRef.current();
      return;
    }
    handleSidebarDownRef.current();
    const index = sidebarFocusedIndexRef.current;
    if (index >= 0) {
      sidebarViewActivateRef.current?.(index);
    }
  };
  handleAgentPrevRef.current = () => {
    if (agentNavPrevRef.current) {
      agentNavPrevRef.current();
      return;
    }
    handleSidebarUpRef.current();
    const index = sidebarFocusedIndexRef.current;
    if (index >= 0) {
      sidebarViewActivateRef.current?.(index);
    }
  };

  useEffect(() => {
    if (!toolbarOpen) {
      unfocusToolbar();
    }
  }, [toolbarOpen, unfocusToolbar]);

  useEffect(() => {
    if (!sidebarOpen) {
      unfocusSidebar();
    }
  }, [sidebarOpen, unfocusSidebar]);

  useEffect(() => {
    if (sidebarFocusedRef.current) {
      focusSidebar(getSidebarMinFocusIndex(sidebarView));
    }
  }, [focusSidebar, sidebarFocusedRef, sidebarView]);

  return {
    handleSidebarViewChange,
    sidebarFocused,
    sidebarFocusedIndex,
    sidebarViewActivateRef,
    sidebarViewZoomRef,
    toolbarActivateRef,
    toolbarFocusedIndex,
  };
}
