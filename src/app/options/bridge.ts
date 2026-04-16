import type { OptionsWorkflowApi } from "../hooks/use-options-workflow.ts";
import type { OptionsDialogState } from "./model.ts";

export interface OptionsDialogStateSource {
  configActiveWindowIdDisplayEnabled: OptionsWorkflowApi["configActiveWindowIdDisplayEnabled"];
  configAgentAlertAnimConfusables: OptionsWorkflowApi["configAgentAlertAnimConfusables"];
  configAgentAlertAnimCycleCount: OptionsWorkflowApi["configAgentAlertAnimCycleCount"];
  configAgentAlertAnimDelay: OptionsWorkflowApi["configAgentAlertAnimDelay"];
  configAgentAlertAnimEqualizer: OptionsWorkflowApi["configAgentAlertAnimEqualizer"];
  configAgentAlertAnimGlow: OptionsWorkflowApi["configAgentAlertAnimGlow"];
  configAgentAlertAnimScribble: OptionsWorkflowApi["configAgentAlertAnimScribble"];
  configAgentAlertCursorAlert: OptionsWorkflowApi["configAgentAlertCursorAlert"];
  configAgentAlertCursorBlink: OptionsWorkflowApi["configAgentAlertCursorBlink"];
  configAgentAlertCursorColor: OptionsWorkflowApi["configAgentAlertCursorColor"];
  configAgentAlertCursorShape: OptionsWorkflowApi["configAgentAlertCursorShape"];
  configAgentAlertWatermark: OptionsWorkflowApi["configAgentAlertWatermark"];
  configAnimationCycleCountCursor: OptionsWorkflowApi["configAnimationCycleCountCursor"];
  configAnimationCycleCountEditing: OptionsWorkflowApi["configAnimationCycleCountEditing"];
  configAnimationCycleCountText: OptionsWorkflowApi["configAnimationCycleCountText"];
  configAnimationDelayCursor: OptionsWorkflowApi["configAnimationDelayCursor"];
  configAnimationDelayEditing: OptionsWorkflowApi["configAnimationDelayEditing"];
  configAnimationDelayText: OptionsWorkflowApi["configAnimationDelayText"];
  configBufferZoomFade: OptionsWorkflowApi["configBufferZoomFade"];
  configCursorColorPickerOpen: OptionsWorkflowApi["configCursorColorPickerOpen"];
  configDimInactivePanes: OptionsWorkflowApi["configDimInactivePanes"];
  configDimInactivePanesOpacity: OptionsWorkflowApi["configDimInactivePanesOpacity"];
  configHoneybeamsEnabled: OptionsWorkflowApi["configHoneybeamsEnabled"];
  configIgnoreMouseInput: OptionsWorkflowApi["configIgnoreMouseInput"];
  configMultiSelectEditing: OptionsWorkflowApi["configMultiSelectEditing"];
  configMuxotronEnabled: OptionsWorkflowApi["configMuxotronEnabled"];
  configPaneTabsEnabled: OptionsWorkflowApi["configPaneTabsEnabled"];
  configPrivilegedPaneDetection: OptionsWorkflowApi["configPrivilegedPaneDetection"];
  configPrivilegedPaneDetectionOpacity: OptionsWorkflowApi["configPrivilegedPaneDetectionOpacity"];
  configQuickTerminalSize: OptionsWorkflowApi["configQuickTerminalSize"];
  configRemoteSelectedIndex: OptionsWorkflowApi["configRemoteSelectedIndex"];
  configRemoteServers: OptionsWorkflowApi["configRemoteServers"];
  configRemoteTesting: OptionsWorkflowApi["configRemoteTesting"];
  configScreenshotFlash: OptionsWorkflowApi["configScreenshotFlash"];
  configThemeBuiltin: OptionsWorkflowApi["configThemeBuiltin"];
  configThemeMode: OptionsWorkflowApi["configThemeMode"];
  configTmuxKeyBindingHints: OptionsWorkflowApi["configTmuxKeyBindingHints"];
  configTmuxPrefixKeyAlias: OptionsWorkflowApi["configTmuxPrefixKeyAlias"];
  configTmuxPrefixKeyAliasCaptureError: OptionsWorkflowApi["configTmuxPrefixKeyAliasCaptureError"];
  configTmuxPrefixKeyAliasCapturing: OptionsWorkflowApi["configTmuxPrefixKeyAliasCapturing"];
  configUIMode: OptionsWorkflowApi["configUIMode"];
  optionsDialogRow: OptionsWorkflowApi["optionsDialogRow"];
  optionsDialogTab: OptionsWorkflowApi["optionsDialogTab"];
  remoteEditRef: OptionsWorkflowApi["remoteEditRef"];
  screenshotDirEditRef: OptionsWorkflowApi["screenshotDirEditRef"];
}

export function applyOptionsDialogState(workflow: OptionsWorkflowApi, next: OptionsDialogState): void {
  const current = buildOptionsDialogState(workflow);
  if (
    current.ignoreMouseInput !== next.ignoreMouseInput ||
    current.themeBuiltin !== next.themeBuiltin ||
    current.themeMode !== next.themeMode ||
    current.uiMode !== next.uiMode
  ) {
    workflow.previewConfigChange(next.ignoreMouseInput, next.themeMode, next.themeBuiltin, next.uiMode);
  }

  if (current.themeBuiltin !== next.themeBuiltin) workflow.setConfigThemeBuiltin(next.themeBuiltin);
  if (current.themeMode !== next.themeMode) workflow.setConfigThemeMode(next.themeMode);
  if (current.ignoreMouseInput !== next.ignoreMouseInput) workflow.setConfigIgnoreMouseInput(next.ignoreMouseInput);
  if (current.tmuxPrefixKeyAlias !== next.tmuxPrefixKeyAlias)
    workflow.setConfigTmuxPrefixKeyAlias(next.tmuxPrefixKeyAlias);
  if (current.tmuxPrefixKeyAliasCapturing !== next.tmuxPrefixKeyAliasCapturing) {
    workflow.setConfigTmuxPrefixKeyAliasCapturing(next.tmuxPrefixKeyAliasCapturing);
  }
  if (current.tmuxPrefixKeyAliasCaptureError !== next.tmuxPrefixKeyAliasCaptureError) {
    workflow.setConfigTmuxPrefixKeyAliasCaptureError(next.tmuxPrefixKeyAliasCaptureError);
  }
  if (current.uiMode !== next.uiMode) workflow.setConfigUIMode(next.uiMode);
  if (current.honeybeamsEnabled !== next.honeybeamsEnabled) workflow.setConfigHoneybeamsEnabled(next.honeybeamsEnabled);
  if (current.screenshotFlash !== next.screenshotFlash) workflow.setConfigScreenshotFlash(next.screenshotFlash);
  if (current.screenshotDir !== next.screenshotDir) workflow.setConfigScreenshotDir(next.screenshotDir);
  if (current.screenshotDirEditing !== next.screenshotDirEditing) {
    workflow.setConfigScreenshotDirEditing(next.screenshotDirEditing);
  }
  if (current.screenshotDirCursor !== next.screenshotDirCursor) {
    workflow.setConfigScreenshotDirCursor(next.screenshotDirCursor);
  }
  if (current.privilegedPaneDetection !== next.privilegedPaneDetection) {
    workflow.setConfigPrivilegedPaneDetection(next.privilegedPaneDetection);
  }
  if (current.privilegedPaneDetectionOpacity !== next.privilegedPaneDetectionOpacity) {
    workflow.setConfigPrivilegedPaneDetectionOpacity(next.privilegedPaneDetectionOpacity);
  }
  if (current.dimInactivePanes !== next.dimInactivePanes) workflow.setConfigDimInactivePanes(next.dimInactivePanes);
  if (current.dimInactivePanesOpacity !== next.dimInactivePanesOpacity) {
    workflow.setConfigDimInactivePanesOpacity(next.dimInactivePanesOpacity);
  }
  if (current.quickTerminalSize !== next.quickTerminalSize) workflow.setConfigQuickTerminalSize(next.quickTerminalSize);
  if (current.muxotronEnabled !== next.muxotronEnabled) workflow.setConfigMuxotronEnabled(next.muxotronEnabled);
  if (current.agentAlertAnimGlow !== next.agentAlertAnimGlow) {
    workflow.setConfigAgentAlertAnimGlow(next.agentAlertAnimGlow);
  }
  if (current.agentAlertAnimConfusables !== next.agentAlertAnimConfusables) {
    workflow.setConfigAgentAlertAnimConfusables(next.agentAlertAnimConfusables);
  }
  if (current.agentAlertAnimScribble !== next.agentAlertAnimScribble) {
    workflow.setConfigAgentAlertAnimScribble(next.agentAlertAnimScribble);
  }
  if (current.agentAlertAnimEqualizer !== next.agentAlertAnimEqualizer) {
    workflow.setConfigAgentAlertAnimEqualizer(next.agentAlertAnimEqualizer);
  }
  if (current.agentAlertAnimDelay !== next.agentAlertAnimDelay) {
    workflow.setConfigAgentAlertAnimDelay(next.agentAlertAnimDelay);
  }
  if (current.animationDelayEditing !== next.animationDelayEditing) {
    workflow.setConfigAnimationDelayEditing(next.animationDelayEditing);
  }
  if (current.animationDelayText !== next.animationDelayText) {
    workflow.setConfigAnimationDelayText(next.animationDelayText);
  }
  if (current.animationDelayCursor !== next.animationDelayCursor) {
    workflow.setConfigAnimationDelayCursor(next.animationDelayCursor);
  }
  if (current.agentAlertAnimCycleCount !== next.agentAlertAnimCycleCount) {
    workflow.setConfigAgentAlertAnimCycleCount(next.agentAlertAnimCycleCount);
  }
  if (current.animationCycleCountEditing !== next.animationCycleCountEditing) {
    workflow.setConfigAnimationCycleCountEditing(next.animationCycleCountEditing);
  }
  if (current.animationCycleCountText !== next.animationCycleCountText) {
    workflow.setConfigAnimationCycleCountText(next.animationCycleCountText);
  }
  if (current.animationCycleCountCursor !== next.animationCycleCountCursor) {
    workflow.setConfigAnimationCycleCountCursor(next.animationCycleCountCursor);
  }
  if (current.agentAlertCursorAlert !== next.agentAlertCursorAlert) {
    workflow.setConfigAgentAlertCursorAlert(next.agentAlertCursorAlert);
  }
  if (current.agentAlertCursorShape !== next.agentAlertCursorShape) {
    workflow.setConfigAgentAlertCursorShape(next.agentAlertCursorShape);
  }
  if (current.agentAlertCursorBlink !== next.agentAlertCursorBlink) {
    workflow.setConfigAgentAlertCursorBlink(next.agentAlertCursorBlink);
  }
  if (current.agentAlertCursorColor !== next.agentAlertCursorColor) {
    workflow.setConfigAgentAlertCursorColor(next.agentAlertCursorColor);
  }
  if (current.cursorColorPickerOpen !== next.cursorColorPickerOpen) {
    workflow.setConfigCursorColorPickerOpen(next.cursorColorPickerOpen);
  }
  if (current.agentAlertWatermark !== next.agentAlertWatermark) {
    workflow.setConfigAgentAlertWatermark(next.agentAlertWatermark);
  }
  if (current.paneTabsEnabled !== next.paneTabsEnabled) workflow.setConfigPaneTabsEnabled(next.paneTabsEnabled);
  if (current.activeWindowIdDisplayEnabled !== next.activeWindowIdDisplayEnabled) {
    workflow.setConfigActiveWindowIdDisplayEnabled(next.activeWindowIdDisplayEnabled);
  }
  if (current.tmuxKeyBindingHints !== next.tmuxKeyBindingHints) {
    workflow.setConfigTmuxKeyBindingHints(next.tmuxKeyBindingHints);
  }
  if (current.bufferZoomFade !== next.bufferZoomFade) workflow.setConfigBufferZoomFade(next.bufferZoomFade);
  if (current.multiSelectEditing !== next.multiSelectEditing) {
    workflow.setConfigMultiSelectEditing(next.multiSelectEditing);
  }
  if (current.remoteServers !== next.remoteServers) workflow.setConfigRemoteServers(next.remoteServers);
  if (current.remoteSelectedIndex !== next.remoteSelectedIndex) {
    workflow.setConfigRemoteSelectedIndex(next.remoteSelectedIndex);
  }
  if (current.remoteEditing !== next.remoteEditing) workflow.setConfigRemoteEditing(next.remoteEditing);
  if (current.remoteAdding !== next.remoteAdding) workflow.setConfigRemoteAdding(next.remoteAdding);
  if (current.remoteTesting !== next.remoteTesting) workflow.setConfigRemoteTesting(next.remoteTesting);
  if (current.tab !== next.tab) workflow.setOptionsDialogTab(next.tab);
  if (current.row !== next.row) workflow.setOptionsDialogRow(next.row);
}

export function buildOptionsDialogState(source: OptionsDialogStateSource): OptionsDialogState {
  return {
    activeWindowIdDisplayEnabled: source.configActiveWindowIdDisplayEnabled,
    agentAlertAnimConfusables: source.configAgentAlertAnimConfusables,
    agentAlertAnimCycleCount: source.configAgentAlertAnimCycleCount,
    agentAlertAnimDelay: source.configAgentAlertAnimDelay,
    agentAlertAnimEqualizer: source.configAgentAlertAnimEqualizer,
    agentAlertAnimGlow: source.configAgentAlertAnimGlow,
    agentAlertAnimScribble: source.configAgentAlertAnimScribble,
    agentAlertCursorAlert: source.configAgentAlertCursorAlert,
    agentAlertCursorBlink: source.configAgentAlertCursorBlink,
    agentAlertCursorColor: source.configAgentAlertCursorColor,
    agentAlertCursorShape: source.configAgentAlertCursorShape,
    agentAlertWatermark: source.configAgentAlertWatermark,
    animationCycleCountCursor: source.configAnimationCycleCountCursor,
    animationCycleCountEditing: source.configAnimationCycleCountEditing,
    animationCycleCountText: source.configAnimationCycleCountText,
    animationDelayCursor: source.configAnimationDelayCursor,
    animationDelayEditing: source.configAnimationDelayEditing,
    animationDelayText: source.configAnimationDelayText,
    bufferZoomFade: source.configBufferZoomFade,
    cursorColorPickerOpen: source.configCursorColorPickerOpen,
    dimInactivePanes: source.configDimInactivePanes,
    dimInactivePanesOpacity: source.configDimInactivePanesOpacity,
    honeybeamsEnabled: source.configHoneybeamsEnabled,
    ignoreMouseInput: source.configIgnoreMouseInput,
    multiSelectEditing: source.configMultiSelectEditing,
    muxotronEnabled: source.configMuxotronEnabled,
    paneTabsEnabled: source.configPaneTabsEnabled,
    privilegedPaneDetection: source.configPrivilegedPaneDetection,
    privilegedPaneDetectionOpacity: source.configPrivilegedPaneDetectionOpacity,
    quickTerminalSize: source.configQuickTerminalSize,
    remoteAdding: source.remoteEditRef.current.adding,
    remoteEditing: source.remoteEditRef.current.editing,
    remoteSelectedIndex: source.configRemoteSelectedIndex,
    remoteServers: source.configRemoteServers,
    remoteTesting: source.configRemoteTesting,
    row: source.optionsDialogRow,
    screenshotDir: source.screenshotDirEditRef.current.dir,
    screenshotDirCursor: source.screenshotDirEditRef.current.cursor,
    screenshotDirEditing: source.screenshotDirEditRef.current.editing,
    screenshotFlash: source.configScreenshotFlash,
    tab: source.optionsDialogTab,
    themeBuiltin: source.configThemeBuiltin,
    themeMode: source.configThemeMode,
    tmuxKeyBindingHints: source.configTmuxKeyBindingHints,
    tmuxPrefixKeyAlias: source.configTmuxPrefixKeyAlias,
    tmuxPrefixKeyAliasCaptureError: source.configTmuxPrefixKeyAliasCaptureError,
    tmuxPrefixKeyAliasCapturing: source.configTmuxPrefixKeyAliasCapturing,
    uiMode: source.configUIMode,
  };
}

export function confirmOptionsDialog(workflow: OptionsWorkflowApi, draft: OptionsDialogState): Promise<void> {
  return workflow.handleOptionsConfirm(
    draft.ignoreMouseInput,
    draft.tmuxPrefixKeyAlias,
    draft.uiMode,
    draft.honeybeamsEnabled,
    draft.privilegedPaneDetection,
    draft.muxotronEnabled,
    draft.agentAlertAnimGlow,
    draft.agentAlertAnimConfusables,
    draft.agentAlertAnimScribble,
    draft.agentAlertWatermark,
    draft.agentAlertAnimEqualizer,
    draft.agentAlertCursorAlert,
    draft.agentAlertCursorShape,
    draft.agentAlertCursorBlink,
    draft.agentAlertCursorColor,
    draft.remoteServers,
  );
}
