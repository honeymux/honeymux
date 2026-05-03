import type { MutableRefObject } from "react";

import { useCallback, useRef, useState } from "react";

import type { Base16SchemeName, ThemeMode } from "../../themes/theme.ts";
import type { CursorAlertBlink, CursorAlertShape, HoneymuxConfig, UIMode, WatermarkShape } from "../../util/config.ts";
import type { OptionsTab, RemoteAddingState, RemoteEditingState, RemoteServer, RemoteTestingState } from "./model.ts";

import { DEFAULT_SCHEME } from "../../themes/theme.ts";
import { configRemoteServersToDraft } from "./config-helpers.ts";

export interface OptionsDialogSessionApi {
  configActiveWindowIdDisplayEnabled: boolean;
  configAgentAlertAnimConfusables: boolean;
  configAgentAlertAnimCycleCount: number;
  configAgentAlertAnimDelay: number;
  configAgentAlertAnimEqualizer: boolean;
  configAgentAlertAnimGlow: boolean;
  configAgentAlertAnimScribble: boolean;
  configAgentAlertCursorAlert: boolean;
  configAgentAlertCursorBlink: CursorAlertBlink;
  configAgentAlertCursorColor: string;
  configAgentAlertCursorShape: CursorAlertShape;
  configAgentAlertWatermark: WatermarkShape;
  configAnimationCycleCountCursor: number;
  configAnimationCycleCountEditing: boolean;
  configAnimationCycleCountText: string;
  configAnimationDelayCursor: number;
  configAnimationDelayEditing: boolean;
  configAnimationDelayText: string;
  configBufferZoomFade: boolean;
  configCursorColorPickerOpen: boolean;
  configDimInactivePanes: boolean;
  configDimInactivePanesOpacity: number;
  configHoneybeamsEnabled: boolean;
  configIgnoreMouseInput: boolean;
  configMultiSelectEditing: boolean;
  configMuxotronEnabled: boolean;
  configPaneTabsEnabled: boolean;
  configPrivilegedPaneDetection: boolean;
  configPrivilegedPaneDetectionOpacity: number;
  configQuickTerminalSize: number;
  configRemoteAdding: RemoteAddingState;
  configRemoteEditing: RemoteEditingState;
  configRemoteSelectedIndex: number;
  configRemoteServers: RemoteServer[];
  configRemoteTesting: RemoteTestingState;
  configScreenshotDir: string;
  configScreenshotDirCursor: number;
  configScreenshotDirEditing: boolean;
  configScreenshotFlash: boolean;
  configThemeBuiltin: Base16SchemeName;
  configThemeMode: ThemeMode;
  configTmuxKeyBindingHints: boolean;
  configTmuxPrefixKeyAlias: null | string;
  configTmuxPrefixKeyAliasCaptureError: string;
  configTmuxPrefixKeyAliasCapturing: boolean;
  configUIMode: UIMode;
  loadFromConfig: (config: HoneymuxConfig) => void;
  openedFromMainMenuRef: MutableRefObject<boolean>;
  optionsDialogOpen: boolean;
  optionsDialogRow: number;
  optionsDialogTab: OptionsTab;
  remoteEditRef: MutableRefObject<{
    adding: RemoteAddingState;
    editing: RemoteEditingState;
  }>;
  screenshotDirEditRef: MutableRefObject<{ cursor: number; dir: string; editing: boolean }>;
  setConfigActiveWindowIdDisplayEnabled: (value: boolean) => void;
  setConfigAgentAlertAnimConfusables: (value: boolean) => void;
  setConfigAgentAlertAnimCycleCount: (value: number) => void;
  setConfigAgentAlertAnimDelay: (value: number) => void;
  setConfigAgentAlertAnimEqualizer: (value: boolean) => void;
  setConfigAgentAlertAnimGlow: (value: boolean) => void;
  setConfigAgentAlertAnimScribble: (value: boolean) => void;
  setConfigAgentAlertCursorAlert: (value: boolean) => void;
  setConfigAgentAlertCursorBlink: (value: CursorAlertBlink) => void;
  setConfigAgentAlertCursorColor: (value: string) => void;
  setConfigAgentAlertCursorShape: (value: CursorAlertShape) => void;
  setConfigAgentAlertWatermark: (value: WatermarkShape) => void;
  setConfigAnimationCycleCountCursor: (value: number) => void;
  setConfigAnimationCycleCountEditing: (value: boolean) => void;
  setConfigAnimationCycleCountText: (value: string) => void;
  setConfigAnimationDelayCursor: (value: number) => void;
  setConfigAnimationDelayEditing: (value: boolean) => void;
  setConfigAnimationDelayText: (value: string) => void;
  setConfigBufferZoomFade: (value: boolean) => void;
  setConfigCursorColorPickerOpen: (value: boolean) => void;
  setConfigDimInactivePanes: (value: boolean) => void;
  setConfigDimInactivePanesOpacity: (value: number) => void;
  setConfigHoneybeamsEnabled: (value: boolean) => void;
  setConfigIgnoreMouseInput: (value: boolean) => void;
  setConfigMultiSelectEditing: (value: boolean) => void;
  setConfigMuxotronEnabled: (value: boolean) => void;
  setConfigPaneTabsEnabled: (value: boolean) => void;
  setConfigPrivilegedPaneDetection: (value: boolean) => void;
  setConfigPrivilegedPaneDetectionOpacity: (value: number) => void;
  setConfigQuickTerminalSize: (value: number) => void;
  setConfigRemoteAdding: (adding: RemoteAddingState) => void;
  setConfigRemoteEditing: (editing: RemoteEditingState) => void;
  setConfigRemoteSelectedIndex: (index: number) => void;
  setConfigRemoteServers: (servers: RemoteServer[]) => void;
  setConfigRemoteTesting: (testing: RemoteTestingState) => void;
  setConfigScreenshotDir: (value: string) => void;
  setConfigScreenshotDirCursor: (value: number) => void;
  setConfigScreenshotDirEditing: (value: boolean) => void;
  setConfigScreenshotFlash: (value: boolean) => void;
  setConfigThemeBuiltin: (value: Base16SchemeName) => void;
  setConfigThemeMode: (value: ThemeMode) => void;
  setConfigTmuxKeyBindingHints: (value: boolean) => void;
  setConfigTmuxPrefixKeyAlias: (value: null | string) => void;
  setConfigTmuxPrefixKeyAliasCaptureError: (value: string) => void;
  setConfigTmuxPrefixKeyAliasCapturing: (value: boolean) => void;
  setConfigUIMode: (value: UIMode) => void;
  setOptionsDialogOpen: (value: boolean) => void;
  setOptionsDialogRow: (value: number) => void;
  setOptionsDialogTab: (value: OptionsTab) => void;
}

interface UseOptionsDialogSessionOptions {
  onQuickTerminalSizeChange?: (value: number) => void;
}

export function useOptionsDialogSession(
  initialConfig: HoneymuxConfig,
  { onQuickTerminalSizeChange }: UseOptionsDialogSessionOptions = {},
): OptionsDialogSessionApi {
  const [optionsDialogOpen, setOptionsDialogOpenState] = useState(false);
  const [optionsDialogTab, setOptionsDialogTabState] = useState<OptionsTab>("general");
  const [optionsDialogRow, setOptionsDialogRowState] = useState(0);
  const [configThemeBuiltin, setConfigThemeBuiltinState] = useState<Base16SchemeName>(
    () => initialConfig.themeBuiltin ?? DEFAULT_SCHEME,
  );
  const [configThemeMode, setConfigThemeModeState] = useState<ThemeMode>(() => initialConfig.themeMode ?? "built-in");
  const [configIgnoreMouseInput, setConfigIgnoreMouseInputState] = useState(false);
  const [configTmuxPrefixKeyAlias, setConfigTmuxPrefixKeyAliasState] = useState<null | string>(null);
  const [configTmuxPrefixKeyAliasCapturing, setConfigTmuxPrefixKeyAliasCapturingState] = useState(false);
  const [configTmuxPrefixKeyAliasCaptureError, setConfigTmuxPrefixKeyAliasCaptureErrorState] = useState("");
  const [configUIMode, setConfigUIModeState] = useState<UIMode>(() => initialConfig.uiMode);
  const [configHoneybeamsEnabled, setConfigHoneybeamsEnabledState] = useState(
    () => initialConfig.honeybeamsEnabled ?? false,
  );
  const [configBufferZoomFade, setConfigBufferZoomFadeState] = useState(() => initialConfig.bufferZoomFade ?? true);
  const [configScreenshotFlash, setConfigScreenshotFlashState] = useState(() => initialConfig.screenshotFlash ?? true);
  const [configScreenshotDir, setConfigScreenshotDirState] = useState(() => initialConfig.screenshotDir ?? "");
  const [configScreenshotDirEditing, setConfigScreenshotDirEditingState] = useState(false);
  const [configScreenshotDirCursor, setConfigScreenshotDirCursorState] = useState(0);
  const screenshotDirEditRef = useRef({
    cursor: 0,
    dir: initialConfig.screenshotDir ?? "",
    editing: false,
  });
  const [configPrivilegedPaneDetection, setConfigPrivilegedPaneDetectionState] = useState(
    () => initialConfig.privilegedPaneDetection,
  );
  const [configPrivilegedPaneDetectionOpacity, setConfigPrivilegedPaneDetectionOpacityState] = useState(
    () => initialConfig.privilegedPaneDetectionOpacity ?? 10,
  );
  const [configDimInactivePanes, setConfigDimInactivePanesState] = useState(
    () => initialConfig.dimInactivePanes ?? false,
  );
  const [configDimInactivePanesOpacity, setConfigDimInactivePanesOpacityState] = useState(
    () => initialConfig.dimInactivePanesOpacity ?? 40,
  );
  const [configQuickTerminalSize, setConfigQuickTerminalSizeState] = useState(
    () => initialConfig.quickTerminalSize ?? 90,
  );
  const [configMuxotronEnabled, setConfigMuxotronEnabledState] = useState(() => initialConfig.muxotronEnabled ?? true);
  const [configAgentAlertAnimGlow, setConfigAgentAlertAnimGlowState] = useState(
    () => initialConfig.agentAlertAnimGlow ?? false,
  );
  const [configAgentAlertAnimConfusables, setConfigAgentAlertAnimConfusablesState] = useState(
    () => initialConfig.agentAlertAnimConfusables ?? true,
  );
  const [configAgentAlertAnimScribble, setConfigAgentAlertAnimScribbleState] = useState(
    () => initialConfig.agentAlertAnimScribble ?? false,
  );
  const [configAgentAlertWatermark, setConfigAgentAlertWatermarkState] = useState<WatermarkShape>(
    () => initialConfig.agentAlertWatermark ?? "off",
  );
  const [configAgentAlertAnimEqualizer, setConfigAgentAlertAnimEqualizerState] = useState(
    () => initialConfig.agentAlertAnimEqualizer ?? false,
  );
  const [configAgentAlertAnimDelay, setConfigAgentAlertAnimDelayState] = useState(
    () => initialConfig.agentAlertAnimDelay ?? 60,
  );
  const [configAnimationDelayEditing, setConfigAnimationDelayEditingState] = useState(false);
  const [configAnimationDelayText, setConfigAnimationDelayTextState] = useState(() =>
    String(initialConfig.agentAlertAnimDelay ?? 60),
  );
  const [configAnimationDelayCursor, setConfigAnimationDelayCursorState] = useState(0);
  const [configAgentAlertAnimCycleCount, setConfigAgentAlertAnimCycleCountState] = useState(
    () => initialConfig.agentAlertAnimCycleCount ?? 1,
  );
  const [configAnimationCycleCountEditing, setConfigAnimationCycleCountEditingState] = useState(false);
  const [configAnimationCycleCountText, setConfigAnimationCycleCountTextState] = useState(() =>
    String(initialConfig.agentAlertAnimCycleCount ?? 1),
  );
  const [configAnimationCycleCountCursor, setConfigAnimationCycleCountCursorState] = useState(0);
  const [configAgentAlertCursorAlert, setConfigAgentAlertCursorAlertState] = useState(
    () => initialConfig.agentAlertCursorAlert ?? true,
  );
  const [configAgentAlertCursorShape, setConfigAgentAlertCursorShapeState] = useState<CursorAlertShape>(
    () => initialConfig.agentAlertCursorShape ?? "default",
  );
  const [configAgentAlertCursorBlink, setConfigAgentAlertCursorBlinkState] = useState<CursorAlertBlink>(
    () => initialConfig.agentAlertCursorBlink ?? "default",
  );
  const [configAgentAlertCursorColor, setConfigAgentAlertCursorColorState] = useState(
    () => initialConfig.agentAlertCursorColor ?? "#ff0000",
  );
  const [configCursorColorPickerOpen, setConfigCursorColorPickerOpenState] = useState(false);
  const [configPaneTabsEnabled, setConfigPaneTabsEnabledState] = useState(() => initialConfig.paneTabsEnabled ?? false);
  const [configActiveWindowIdDisplayEnabled, setConfigActiveWindowIdDisplayEnabledState] = useState(
    () => initialConfig.activeWindowIdDisplayEnabled ?? false,
  );
  const [configTmuxKeyBindingHints, setConfigTmuxKeyBindingHintsState] = useState(
    () => initialConfig.tmuxKeyBindingHints ?? true,
  );
  const [configRemoteServers, setConfigRemoteServersState] = useState<RemoteServer[]>(() =>
    configRemoteServersToDraft(initialConfig),
  );
  const [configRemoteSelectedIndex, setConfigRemoteSelectedIndexState] = useState(0);
  const [configRemoteEditing, setConfigRemoteEditingState] = useState<RemoteEditingState>(null);
  const [configRemoteAdding, setConfigRemoteAddingState] = useState<RemoteAddingState>(null);
  const remoteEditRef = useRef<{ adding: RemoteAddingState; editing: RemoteEditingState }>({
    adding: null,
    editing: null,
  });
  const [configRemoteTesting, setConfigRemoteTestingState] = useState<RemoteTestingState>(null);
  const [configMultiSelectEditing, setConfigMultiSelectEditingState] = useState(false);
  const openedFromMainMenuRef = useRef(false);

  const setConfigScreenshotDir = useCallback((value: string) => {
    screenshotDirEditRef.current.dir = value;
    setConfigScreenshotDirState(value);
  }, []);

  const setConfigScreenshotDirEditing = useCallback((value: boolean) => {
    screenshotDirEditRef.current.editing = value;
    setConfigScreenshotDirEditingState(value);
  }, []);

  const setConfigScreenshotDirCursor = useCallback((value: number) => {
    screenshotDirEditRef.current.cursor = value;
    setConfigScreenshotDirCursorState(value);
  }, []);

  const setConfigQuickTerminalSize = useCallback(
    (value: number) => {
      setConfigQuickTerminalSizeState(value);
      onQuickTerminalSizeChange?.(value);
    },
    [onQuickTerminalSizeChange],
  );

  const setConfigRemoteEditing = useCallback((value: RemoteEditingState) => {
    remoteEditRef.current.editing = value;
    setConfigRemoteEditingState(value);
  }, []);

  const setConfigRemoteAdding = useCallback((value: RemoteAddingState) => {
    remoteEditRef.current.adding = value;
    setConfigRemoteAddingState(value);
  }, []);

  const loadFromConfig = useCallback((config: HoneymuxConfig) => {
    setOptionsDialogRowState(0);
    setConfigThemeBuiltinState(config.themeBuiltin ?? DEFAULT_SCHEME);
    setConfigThemeModeState(config.themeMode ?? "built-in");
    setConfigIgnoreMouseInputState(config.ignoreMouseInput ?? false);
    setConfigTmuxPrefixKeyAliasState(config.tmuxPrefixKeyAlias ?? null);
    setConfigTmuxPrefixKeyAliasCapturingState(false);
    setConfigTmuxPrefixKeyAliasCaptureErrorState("");
    setConfigUIModeState(config.uiMode ?? "adaptive");
    setConfigHoneybeamsEnabledState(config.honeybeamsEnabled ?? false);
    setConfigBufferZoomFadeState(config.bufferZoomFade ?? true);
    setConfigScreenshotFlashState(config.screenshotFlash ?? true);
    setConfigScreenshotDirState(config.screenshotDir ?? "");
    setConfigScreenshotDirEditingState(false);
    setConfigScreenshotDirCursorState(0);
    screenshotDirEditRef.current = { cursor: 0, dir: config.screenshotDir ?? "", editing: false };
    setConfigPrivilegedPaneDetectionState(config.privilegedPaneDetection ?? true);
    setConfigPrivilegedPaneDetectionOpacityState(config.privilegedPaneDetectionOpacity ?? 10);
    setConfigDimInactivePanesState(config.dimInactivePanes ?? false);
    setConfigDimInactivePanesOpacityState(config.dimInactivePanesOpacity ?? 40);
    setConfigQuickTerminalSizeState(config.quickTerminalSize ?? 90);
    setConfigMuxotronEnabledState(config.muxotronEnabled ?? true);
    setConfigAgentAlertAnimGlowState(config.agentAlertAnimGlow ?? false);
    setConfigAgentAlertAnimConfusablesState(config.agentAlertAnimConfusables ?? true);
    setConfigAgentAlertAnimScribbleState(config.agentAlertAnimScribble ?? false);
    setConfigAgentAlertWatermarkState(config.agentAlertWatermark ?? "off");
    setConfigAgentAlertAnimEqualizerState(config.agentAlertAnimEqualizer ?? false);
    setConfigAgentAlertAnimDelayState(config.agentAlertAnimDelay ?? 60);
    setConfigAnimationDelayEditingState(false);
    setConfigAnimationDelayTextState(String(config.agentAlertAnimDelay ?? 60));
    setConfigAnimationDelayCursorState(0);
    setConfigAgentAlertAnimCycleCountState(config.agentAlertAnimCycleCount ?? 1);
    setConfigAnimationCycleCountEditingState(false);
    setConfigAnimationCycleCountTextState(String(config.agentAlertAnimCycleCount ?? 1));
    setConfigAnimationCycleCountCursorState(0);
    setConfigAgentAlertCursorAlertState(config.agentAlertCursorAlert ?? true);
    setConfigAgentAlertCursorShapeState(config.agentAlertCursorShape ?? "default");
    setConfigAgentAlertCursorBlinkState(config.agentAlertCursorBlink ?? "default");
    setConfigAgentAlertCursorColorState(config.agentAlertCursorColor ?? "#ff0000");
    setConfigCursorColorPickerOpenState(false);
    setConfigPaneTabsEnabledState(config.paneTabsEnabled ?? false);
    setConfigActiveWindowIdDisplayEnabledState(config.activeWindowIdDisplayEnabled ?? false);
    setConfigTmuxKeyBindingHintsState(config.tmuxKeyBindingHints ?? true);
    setConfigRemoteServersState(configRemoteServersToDraft(config));
    setConfigRemoteSelectedIndexState(0);
    setConfigRemoteEditingState(null);
    setConfigRemoteAddingState(null);
    remoteEditRef.current = { adding: null, editing: null };
    setConfigRemoteTestingState(null);
    setConfigMultiSelectEditingState(false);
    setOptionsDialogOpenState(true);
  }, []);

  return {
    configActiveWindowIdDisplayEnabled,
    configAgentAlertAnimConfusables,
    configAgentAlertAnimCycleCount,
    configAgentAlertAnimDelay,
    configAgentAlertAnimEqualizer,
    configAgentAlertAnimGlow,
    configAgentAlertAnimScribble,
    configAgentAlertCursorAlert,
    configAgentAlertCursorBlink,
    configAgentAlertCursorColor,
    configAgentAlertCursorShape,
    configAgentAlertWatermark,
    configAnimationCycleCountCursor,
    configAnimationCycleCountEditing,
    configAnimationCycleCountText,
    configAnimationDelayCursor,
    configAnimationDelayEditing,
    configAnimationDelayText,
    configBufferZoomFade,
    configCursorColorPickerOpen,
    configDimInactivePanes,
    configDimInactivePanesOpacity,
    configHoneybeamsEnabled,
    configIgnoreMouseInput,
    configMultiSelectEditing,
    configMuxotronEnabled,
    configPaneTabsEnabled,
    configPrivilegedPaneDetection,
    configPrivilegedPaneDetectionOpacity,
    configQuickTerminalSize,
    configRemoteAdding,
    configRemoteEditing,
    configRemoteSelectedIndex,
    configRemoteServers,
    configRemoteTesting,
    configScreenshotDir,
    configScreenshotDirCursor,
    configScreenshotDirEditing,
    configScreenshotFlash,
    configThemeBuiltin,
    configThemeMode,
    configTmuxKeyBindingHints,
    configTmuxPrefixKeyAlias,
    configTmuxPrefixKeyAliasCaptureError,
    configTmuxPrefixKeyAliasCapturing,
    configUIMode,
    loadFromConfig,
    openedFromMainMenuRef,
    optionsDialogOpen,
    optionsDialogRow,
    optionsDialogTab,
    remoteEditRef,
    screenshotDirEditRef,
    setConfigActiveWindowIdDisplayEnabled: setConfigActiveWindowIdDisplayEnabledState,
    setConfigAgentAlertAnimConfusables: setConfigAgentAlertAnimConfusablesState,
    setConfigAgentAlertAnimCycleCount: setConfigAgentAlertAnimCycleCountState,
    setConfigAgentAlertAnimDelay: setConfigAgentAlertAnimDelayState,
    setConfigAgentAlertAnimEqualizer: setConfigAgentAlertAnimEqualizerState,
    setConfigAgentAlertAnimGlow: setConfigAgentAlertAnimGlowState,
    setConfigAgentAlertAnimScribble: setConfigAgentAlertAnimScribbleState,
    setConfigAgentAlertCursorAlert: setConfigAgentAlertCursorAlertState,
    setConfigAgentAlertCursorBlink: setConfigAgentAlertCursorBlinkState,
    setConfigAgentAlertCursorColor: setConfigAgentAlertCursorColorState,
    setConfigAgentAlertCursorShape: setConfigAgentAlertCursorShapeState,
    setConfigAgentAlertWatermark: setConfigAgentAlertWatermarkState,
    setConfigAnimationCycleCountCursor: setConfigAnimationCycleCountCursorState,
    setConfigAnimationCycleCountEditing: setConfigAnimationCycleCountEditingState,
    setConfigAnimationCycleCountText: setConfigAnimationCycleCountTextState,
    setConfigAnimationDelayCursor: setConfigAnimationDelayCursorState,
    setConfigAnimationDelayEditing: setConfigAnimationDelayEditingState,
    setConfigAnimationDelayText: setConfigAnimationDelayTextState,
    setConfigBufferZoomFade: setConfigBufferZoomFadeState,
    setConfigCursorColorPickerOpen: setConfigCursorColorPickerOpenState,
    setConfigDimInactivePanes: setConfigDimInactivePanesState,
    setConfigDimInactivePanesOpacity: setConfigDimInactivePanesOpacityState,
    setConfigHoneybeamsEnabled: setConfigHoneybeamsEnabledState,
    setConfigIgnoreMouseInput: setConfigIgnoreMouseInputState,
    setConfigMultiSelectEditing: setConfigMultiSelectEditingState,
    setConfigMuxotronEnabled: setConfigMuxotronEnabledState,
    setConfigPaneTabsEnabled: setConfigPaneTabsEnabledState,
    setConfigPrivilegedPaneDetection: setConfigPrivilegedPaneDetectionState,
    setConfigPrivilegedPaneDetectionOpacity: setConfigPrivilegedPaneDetectionOpacityState,
    setConfigQuickTerminalSize,
    setConfigRemoteAdding,
    setConfigRemoteEditing,
    setConfigRemoteSelectedIndex: setConfigRemoteSelectedIndexState,
    setConfigRemoteServers: setConfigRemoteServersState,
    setConfigRemoteTesting: setConfigRemoteTestingState,
    setConfigScreenshotDir,
    setConfigScreenshotDirCursor,
    setConfigScreenshotDirEditing,
    setConfigScreenshotFlash: setConfigScreenshotFlashState,
    setConfigThemeBuiltin: setConfigThemeBuiltinState,
    setConfigThemeMode: setConfigThemeModeState,
    setConfigTmuxKeyBindingHints: setConfigTmuxKeyBindingHintsState,
    setConfigTmuxPrefixKeyAlias: setConfigTmuxPrefixKeyAliasState,
    setConfigTmuxPrefixKeyAliasCaptureError: setConfigTmuxPrefixKeyAliasCaptureErrorState,
    setConfigTmuxPrefixKeyAliasCapturing: setConfigTmuxPrefixKeyAliasCapturingState,
    setConfigUIMode: setConfigUIModeState,
    setOptionsDialogOpen: setOptionsDialogOpenState,
    setOptionsDialogRow: setOptionsDialogRowState,
    setOptionsDialogTab: setOptionsDialogTabState,
  };
}
