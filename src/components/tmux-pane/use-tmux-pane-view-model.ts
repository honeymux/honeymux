import { useCallback, useMemo, useState } from "react";

import type { UIMode } from "../../util/config.ts";
import type { TerminalMetrics } from "../../util/pane-layout.ts";
import type { TmuxPaneAgentProps, TmuxPaneCoreProps, TmuxPaneSharedProps, TmuxPaneToolbarProps } from "./types.ts";
import type { TmuxPaneAgentsDialogProps } from "./use-pane-agents-dialog.ts";

import { theme } from "../../themes/theme.ts";
import { computeTerminalMetrics } from "../../util/pane-layout.ts";
import { useHotkeyHint } from "../hotkey-hint.tsx";
import { TOOLBAR_WIDTH } from "../toolbar.tsx";
import { usePaneAgentsDialog } from "./use-pane-agents-dialog.ts";
import { usePaneOverflow } from "./use-pane-overflow.ts";

export { computeTerminalMetrics };
export { buildAgentsDialogProps } from "./use-pane-agents-dialog.ts";
export { closeOverflowDropdown, computeOverflowItemWidth, selectOverflowTab } from "./use-pane-overflow.ts";

export interface TmuxPaneViewModel {
  agentsDialogProps: TmuxPaneAgentsDialogProps | null;
  borderColor: string;
  handleCloseWindowWithHint?: (index: number) => void;
  handleDragChange: (dragging: boolean) => void;
  handleNewWindowWithHint?: () => void;
  handleOverflowClose: () => void;
  handleOverflowSelect: (index: number) => void;
  handleTabClickWithHint: (index: number) => void;
  hasOverflow: boolean;
  hotkeyHint: null | string;
  isFocused: boolean;
  overflowItemWidth: number;
  overflowOpen: boolean;
  overflowStartX: number;
  ptyDragging: boolean;
  tabDragging: boolean;
  termRows: number;
  terminalMetrics: TerminalMetrics;
  tmuxKeyBindingHint: null | string;
  toggleOverflowOpen: () => void;
  uiMode: UIMode;
  visibleCount: number;
}

interface UseTmuxPaneViewModelOptions {
  agent: TmuxPaneAgentProps;
  core: TmuxPaneCoreProps;
  expandedMuxotronWidth?: number;
  shared: TmuxPaneSharedProps;
  toolbar: TmuxPaneToolbarProps;
}

export function emitTmuxKeyBindingHint(
  tmuxKeyBindingHints: boolean | undefined,
  hint: string | undefined,
  showTmuxKeyBindingHint: (hint: string) => void,
): void {
  if (!tmuxKeyBindingHints || !hint) return;
  showTmuxKeyBindingHint(hint);
}

export function resolveAgentsDialogSelectHandler(
  onAgentsDialogSelect: TmuxPaneAgentProps["onAgentsDialogSelect"],
  onTreeAgentSelect: TmuxPaneAgentProps["onTreeAgentSelect"],
): TmuxPaneAgentProps["onAgentsDialogSelect"] | TmuxPaneAgentProps["onTreeAgentSelect"] {
  // The agents dialog must prefer its dedicated selection handler so it can
  // tear down dialog-owned input state before handing off to review preview.
  return onAgentsDialogSelect ?? onTreeAgentSelect;
}

export function useTmuxPaneViewModel({
  agent,
  core,
  expandedMuxotronWidth,
  shared,
  toolbar,
}: UseTmuxPaneViewModelOptions): TmuxPaneViewModel {
  const { activeIndex, focused, height, onCloseWindow, onNewWindow, onTabClick, onTabDragChange, width, windows } =
    core;
  const {
    agentNavNextRef,
    agentNavPrevRef,
    agentSessionsForDialog,
    agentsDialogOpen,
    muxotronEnabled,
    muxotronExpanded,
    onAgentsDialogClose,
    onAgentsDialogSelect,
    onGoToPane,
    onPermissionRespond,
    onTreeAgentSelect,
    registryRef,
  } = agent;
  const {
    activeWindowIdDisplayEnabled,
    dropdownInputRef,
    keyBindings,
    overflowOpenRef,
    ptyDragActiveRef,
    showHintRef,
    uiMode: uiModeProp,
  } = shared;

  const uiMode: UIMode = uiModeProp ?? "adaptive";

  const [tabDragging, setTabDragging] = useState(false);
  const [ptyDragging, setPtyDragging] = useState(false);
  const [hotkeyHint, showHotkeyHint] = useHotkeyHint();
  const [tmuxKeyBindingHint, showTmuxKeyBindingHint] = useHotkeyHint();
  if (showHintRef) showHintRef.current = showHotkeyHint;
  if (ptyDragActiveRef) ptyDragActiveRef.current = setPtyDragging;

  const handleDragChange = useCallback(
    (dragging: boolean) => {
      setTabDragging(dragging);
      onTabDragChange?.(dragging);
    },
    [onTabDragChange],
  );

  const toolbarOpen = toolbar.toolbarOpen;
  const sidebarOpen = toolbar.sidebarOpen;
  const sidebarWidth = toolbar.sidebarWidth;
  const tmuxKeyBindingHints = toolbar.tmuxKeyBindingHints ?? true;
  const terminalMetrics = useMemo(() => {
    const metrics = computeTerminalMetrics({ height, uiMode, width });
    let cols = metrics.cols;
    if (toolbarOpen) {
      cols = Math.max(10, cols - TOOLBAR_WIDTH - 1);
    }
    if (sidebarOpen && sidebarWidth) {
      cols = Math.max(10, cols - sidebarWidth - 1);
    }
    if (cols !== metrics.cols) {
      return { ...metrics, cols };
    }
    return metrics;
  }, [width, height, uiMode, toolbarOpen, sidebarOpen, sidebarWidth]);

  const isFocused = focused ?? true;
  const borderColor = isFocused ? theme.accent : theme.border;

  const handleTabClickWithHint = useCallback(
    (index: number) => {
      emitTmuxKeyBindingHint(tmuxKeyBindingHints, keyBindings?.selectWindow[index], showTmuxKeyBindingHint);
      onTabClick(index);
    },
    [keyBindings, onTabClick, showTmuxKeyBindingHint, tmuxKeyBindingHints],
  );

  const handleCloseWindowWithHint = useMemo(() => {
    if (!onCloseWindow) return undefined;
    return (index: number) => {
      emitTmuxKeyBindingHint(tmuxKeyBindingHints, keyBindings?.killWindow, showTmuxKeyBindingHint);
      onCloseWindow(index);
    };
  }, [keyBindings, onCloseWindow, showTmuxKeyBindingHint, tmuxKeyBindingHints]);

  const handleNewWindowWithHint = useMemo(() => {
    if (!onNewWindow) return undefined;
    return () => {
      emitTmuxKeyBindingHint(tmuxKeyBindingHints, keyBindings?.newWindow, showTmuxKeyBindingHint);
      onNewWindow();
    };
  }, [keyBindings, onNewWindow, showTmuxKeyBindingHint, tmuxKeyBindingHints]);

  const sidebarReserve = toolbar.onSidebarToggle ? 2 : 0;
  const overflow = usePaneOverflow({
    activeIndex,
    activeWindowIdDisplayEnabled,
    dropdownInputRef,
    expandedMuxotronWidth,
    leftReserve: sidebarReserve,
    muxotronEnabled,
    muxotronExpanded,
    onNewWindow,
    onTabClick,
    overflowOpenRef,
    tabDragging,
    uiMode,
    width,
    windows,
  });

  const agentsDialogProps = usePaneAgentsDialog({
    agentNavNextRef,
    agentNavPrevRef,
    agentSessionsForDialog,
    agentsDialogOpen,
    dropdownInputRef,
    height,
    onAgentsDialogClose,
    onAgentsDialogSelect: resolveAgentsDialogSelectHandler(onAgentsDialogSelect, onTreeAgentSelect),
    onGoToPane,
    onPermissionRespond,
    registryRef,
    uiMode,
    width,
  });

  return {
    agentsDialogProps,
    borderColor,
    handleCloseWindowWithHint,
    handleDragChange,
    handleNewWindowWithHint,
    handleOverflowClose: overflow.handleOverflowClose,
    handleOverflowSelect: overflow.handleOverflowSelect,
    handleTabClickWithHint,
    hasOverflow: overflow.hasOverflow,
    hotkeyHint,
    isFocused,
    overflowItemWidth: overflow.overflowItemWidth,
    overflowOpen: overflow.overflowOpen,
    overflowStartX: overflow.overflowStartX,
    ptyDragging,
    tabDragging,
    termRows: terminalMetrics.rows,
    terminalMetrics,
    tmuxKeyBindingHint,
    toggleOverflowOpen: overflow.toggleOverflowOpen,
    uiMode,
    visibleCount: overflow.visibleCount,
  };
}
