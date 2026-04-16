import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { ReactNode } from "react";

import { useEffect } from "react";

import type { AgentSession } from "../../agents/types.ts";
import type { LayoutProfile } from "../../tmux/types.ts";
import type { HoneymuxConfig, UIMode, WatermarkShape } from "../../util/config.ts";
import type { KeyAction } from "../../util/keybindings.ts";
import type { PaneTabDragFloatState } from "../pane-tabs/interactions.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { DimPaneRect } from "./use-dim-inactive-panes.ts";
import type { RootPaneRect } from "./use-root-detection.ts";

import { MainRootOverlays } from "../../components/main-root-overlays.tsx";
import { setCursorAlertActive } from "../../util/cursor-alert.ts";
import { isAgentWatermarkPreviewFocused, isQuickTerminalSizePreviewFocused } from "../options/preview-selectors.ts";

export interface AppOptionsPreviewState {
  quickSizePreview: boolean;
  quickTerminalSize: number;
  unansweredCount: number;
  watermarkEnabled: boolean;
  watermarkPreviewFocused: boolean;
  watermarkShape: WatermarkShape;
}

export interface AppOverlayModel {
  hasFavoriteProfile: boolean;
  mainRootOverlayNode: ReactNode;
  optionsPreview: AppOptionsPreviewState;
  overlayZoomState: AppOverlayZoomState;
}

export interface AppOverlayZoomState {
  action: KeyAction | null;
  active: boolean;
  agentsStickyKey: boolean;
  effectiveUIMode: UIMode;
  onToggleSticky: (action: "zoomAgentsView" | "zoomServerView") => void;
  onTreeNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  panesStickyKey: boolean;
}

interface TerminalCursorVisibilityOptions {
  dialogOpen: boolean;
  interactiveAgent: AgentSession | null;
  muxotronFocusActive: boolean;
  tooSmallForUse: boolean;
}

interface UseAppOverlayModelOptions {
  activePaneId: null | string;
  agentInstallDialogOpen: boolean;
  agentSessions: AgentSession[];
  config: HoneymuxConfig;
  configAgentAlertWatermark: WatermarkShape;
  configQuickTerminalSize: number;
  dimEnabled: boolean;
  effectiveUIMode: UIMode;
  height: number;
  inactivePaneRects: DimPaneRect[];
  interactiveAgent: AgentSession | null;
  layoutProfiles: LayoutProfile[];
  muxotronFocusActive: boolean;
  onToggleZoomSticky: (action: "zoomAgentsView" | "zoomServerView") => void;
  onTreeNavigate: (sessionName: string, windowId: string, paneId: string) => void;
  optionsDialogOpen: boolean;
  optionsDialogRow: Parameters<typeof isQuickTerminalSizePreviewFocused>[2];
  optionsDialogTab: Parameters<typeof isQuickTerminalSizePreviewFocused>[1];
  paneTabDragFloat: PaneTabDragFloatState | null;
  privilegedPaneDetectionEnabled: boolean;
  refs: Pick<AppRuntimeRefs, "terminalRef">;
  rootPanes: RootPaneRect[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  termCols: number;
  termRows: number;
  tooSmallForUse: boolean;
  width: number;
  zoomAction: KeyAction | null;
}

export function applyTerminalCursorVisibility(
  terminal: Pick<GhosttyTerminalRenderable, "showCursor">,
  options: TerminalCursorVisibilityOptions,
): void {
  terminal.showCursor = shouldShowTerminalCursor(options);
}

export function getUnansweredCount(agentSessions: AgentSession[], activePaneId: null | string): number {
  return agentSessions.filter((session) => session.status === "unanswered" && session.paneId !== activePaneId).length;
}

export function getWatermarkState({
  config,
  configAgentAlertWatermark,
  optionsDialogOpen,
  optionsDialogRow,
  optionsDialogTab,
  unansweredCount,
}: {
  config: HoneymuxConfig;
  configAgentAlertWatermark: WatermarkShape;
  optionsDialogOpen: boolean;
  optionsDialogRow: Parameters<typeof isAgentWatermarkPreviewFocused>[2];
  optionsDialogTab: Parameters<typeof isAgentWatermarkPreviewFocused>[1];
  unansweredCount: number;
}): { enabled: boolean; previewFocused: boolean; shape: WatermarkShape; showInRootOverlay: boolean } {
  const previewFocused = isAgentWatermarkPreviewFocused(optionsDialogOpen, optionsDialogTab, optionsDialogRow);
  const shape = optionsDialogOpen ? configAgentAlertWatermark : (config.agentAlertWatermark ?? "off");
  const enabled = shape !== "off";
  const showInRootOverlay = enabled && (unansweredCount > 0 || previewFocused);
  return { enabled, previewFocused, shape, showInRootOverlay };
}

export function hasFavoriteLayoutProfile(layoutProfiles: LayoutProfile[]): boolean {
  return layoutProfiles.some((profile) => profile.favorite);
}

export function shouldShowTerminalCursor({
  dialogOpen,
  interactiveAgent,
  muxotronFocusActive,
  tooSmallForUse,
}: TerminalCursorVisibilityOptions): boolean {
  return !tooSmallForUse && !dialogOpen && !interactiveAgent && !muxotronFocusActive;
}

export function useAppOverlayModel({
  activePaneId,
  agentInstallDialogOpen,
  agentSessions,
  config,
  configAgentAlertWatermark,
  configQuickTerminalSize,
  dimEnabled,
  effectiveUIMode,
  height,
  inactivePaneRects,
  interactiveAgent,
  layoutProfiles,
  muxotronFocusActive,
  onToggleZoomSticky,
  onTreeNavigate,
  optionsDialogOpen,
  optionsDialogRow,
  optionsDialogTab,
  paneTabDragFloat,
  privilegedPaneDetectionEnabled,
  refs,
  rootPanes,
  sidebarOpen,
  sidebarWidth,
  termCols,
  termRows,
  tooSmallForUse,
  width,
  zoomAction,
}: UseAppOverlayModelOptions): AppOverlayModel {
  useEffect(() => {
    const terminal = refs.terminalRef.current;
    if (!terminal) return;
    applyTerminalCursorVisibility(terminal, {
      dialogOpen: agentInstallDialogOpen,
      interactiveAgent,
      muxotronFocusActive,
      tooSmallForUse,
    });
  }, [agentInstallDialogOpen, interactiveAgent, refs.terminalRef, tooSmallForUse, muxotronFocusActive]);

  const unansweredCount = getUnansweredCount(agentSessions, activePaneId);
  const watermarkState = getWatermarkState({
    config,
    configAgentAlertWatermark,
    optionsDialogOpen,
    optionsDialogRow,
    optionsDialogTab,
    unansweredCount,
  });

  const cursorAlertEnabled = config.agentAlertCursorAlert ?? false;
  const cursorShape = config.agentAlertCursorShape ?? "underline";
  const cursorBlink = config.agentAlertCursorBlink ?? true;
  const cursorColor = config.agentAlertCursorColor ?? "#ff0000";
  useEffect(() => {
    setCursorAlertActive(cursorAlertEnabled && unansweredCount > 0, cursorShape, cursorBlink, cursorColor);
    return () => {
      setCursorAlertActive(false);
    };
  }, [cursorAlertEnabled, cursorBlink, cursorColor, cursorShape, unansweredCount]);

  return {
    hasFavoriteProfile: hasFavoriteLayoutProfile(layoutProfiles),
    mainRootOverlayNode: (
      <MainRootOverlays
        dimEnabled={dimEnabled}
        dimInactivePanesOpacity={config.dimInactivePanesOpacity ?? 40}
        height={height}
        inactivePaneRects={inactivePaneRects}
        optionsWatermarkFocused={watermarkState.previewFocused}
        paneTabDragFloat={paneTabDragFloat}
        privilegedPaneDetectionEnabled={privilegedPaneDetectionEnabled}
        privilegedPaneDetectionOpacity={config.privilegedPaneDetectionOpacity ?? 15}
        rootPanes={rootPanes}
        showWatermark={watermarkState.showInRootOverlay}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        termCols={termCols}
        termRows={termRows}
        uiMode={effectiveUIMode}
        unansweredCount={unansweredCount}
        watermarkShape={watermarkState.shape}
        width={width}
      />
    ),
    optionsPreview: {
      quickSizePreview: isQuickTerminalSizePreviewFocused(optionsDialogOpen, optionsDialogTab, optionsDialogRow),
      quickTerminalSize: configQuickTerminalSize ?? 90,
      unansweredCount,
      watermarkEnabled: watermarkState.enabled,
      watermarkPreviewFocused: watermarkState.previewFocused,
      watermarkShape: watermarkState.shape,
    },
    overlayZoomState: {
      action: zoomAction,
      active: muxotronFocusActive,
      agentsStickyKey: config.zoomAgentsViewStickyKey ?? true,
      effectiveUIMode,
      onToggleSticky: onToggleZoomSticky,
      onTreeNavigate,
      panesStickyKey: config.zoomServerViewStickyKey ?? true,
    },
  };
}
