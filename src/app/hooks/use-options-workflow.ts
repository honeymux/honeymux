import { useCallback, useRef, useState } from "react";

import type { Base16SchemeName, ThemeMode } from "../../themes/theme.ts";
import type { CursorAlertBlink, CursorAlertShape, HoneymuxConfig, UIMode, WatermarkShape } from "../../util/config.ts";
import type { OptionsDialogState, RemoteServer } from "../options/model.ts";
import type { UiChromeState } from "./use-app-state-groups.ts";

import { applyTheme, resolveThemeName } from "../../themes/theme.ts";
import { defaultConfig, loadConfig, saveConfig } from "../../util/config.ts";
import { buildOptionsDialogState } from "../options/bridge.ts";
import { type OptionsDialogSessionApi, useOptionsDialogSession } from "../options/dialog-session.ts";

export interface OptionsWorkflowApi extends OptionsWorkflowSessionApi {
  config: HoneymuxConfig;
  handleOptionsClick: (opts?: { fromMainMenu?: boolean }) => Promise<void>;
  handleOptionsConfirm: (
    ignoreMouseInput?: boolean,
    tmuxPrefixKeyAlias?: null | string,
    uiMode?: UIMode,
    honeybeamsEnabled?: boolean,
    privilegedPaneDetection?: boolean,
    muxotronEnabled?: boolean,
    agentAlertAnimGlow?: boolean,
    agentAlertAnimConfusables?: boolean,
    agentAlertAnimScribble?: boolean,
    agentAlertWatermark?: WatermarkShape,
    agentAlertAnimEqualizer?: boolean,
    agentAlertCursorAlert?: boolean,
    agentAlertCursorShape?: CursorAlertShape,
    agentAlertCursorBlink?: CursorAlertBlink,
    agentAlertCursorColor?: string,
    remoteServers?: RemoteServer[],
  ) => Promise<void>;
  previewConfigChange: (
    newIgnoreMouseInput?: boolean,
    newThemeMode?: ThemeMode,
    newThemeBuiltin?: Base16SchemeName,
    newUIMode?: UIMode,
  ) => void;
  setConfig: (value: HoneymuxConfig) => void;
}

interface OptionsConfirmOverrides {
  agentAlertAnimConfusables?: boolean;
  agentAlertAnimEqualizer?: boolean;
  agentAlertAnimGlow?: boolean;
  agentAlertAnimScribble?: boolean;
  agentAlertCursorAlert?: boolean;
  agentAlertCursorBlink?: CursorAlertBlink;
  agentAlertCursorColor?: string;
  agentAlertCursorShape?: CursorAlertShape;
  agentAlertWatermark?: WatermarkShape;
  honeybeamsEnabled?: boolean;
  ignoreMouseInput?: boolean;
  muxotronEnabled?: boolean;
  privilegedPaneDetection?: boolean;
  remoteServers?: RemoteServer[];
  tmuxPrefixKeyAlias?: null | string;
  uiMode?: UIMode;
}

type OptionsWorkflowSessionApi = Omit<OptionsDialogSessionApi, "loadFromConfig">;

interface UseOptionsWorkflowOptions {
  setDropdownOpen: UiChromeState["setDropdownOpen"];
}

export function useOptionsWorkflow({ setDropdownOpen }: UseOptionsWorkflowOptions): OptionsWorkflowApi {
  const initialConfigRef = useRef<HoneymuxConfig | null>(null);
  if (initialConfigRef.current === null) {
    initialConfigRef.current = loadConfig() ?? defaultConfig();
  }
  const initialConfig = initialConfigRef.current;

  const [config, setConfigState] = useState<HoneymuxConfig>(initialConfig);
  const setConfig = useCallback((value: HoneymuxConfig) => {
    setConfigState(value);
  }, []);

  const dialogSession = useOptionsDialogSession(initialConfig, {
    onQuickTerminalSizeChange: (value) => {
      setConfigState((previous) => ({ ...previous, quickTerminalSize: value }));
    },
  });
  const { loadFromConfig, ...sessionApi } = dialogSession;

  const previewConfigChange = useCallback(
    (
      newIgnoreMouseInput?: boolean,
      newThemeMode?: ThemeMode,
      newThemeBuiltin?: Base16SchemeName,
      newUIMode?: UIMode,
    ) => {
      const nextThemeMode = newThemeMode ?? dialogSession.configThemeMode;
      const nextThemeBuiltin = newThemeBuiltin ?? dialogSession.configThemeBuiltin;

      if (nextThemeMode !== dialogSession.configThemeMode) {
        dialogSession.setConfigThemeMode(nextThemeMode);
      }
      if (nextThemeBuiltin !== dialogSession.configThemeBuiltin) {
        dialogSession.setConfigThemeBuiltin(nextThemeBuiltin);
      }
      if (newThemeMode !== undefined || newThemeBuiltin !== undefined) {
        applyTheme(resolveThemeName(nextThemeMode, nextThemeBuiltin), config.themeCustom);
      }
      if (newIgnoreMouseInput !== undefined) dialogSession.setConfigIgnoreMouseInput(newIgnoreMouseInput);
      if (newUIMode !== undefined) dialogSession.setConfigUIMode(newUIMode);
    },
    [config.themeCustom, dialogSession],
  );

  const handleOptionsClick = useCallback(
    async (opts?: { fromMainMenu?: boolean }) => {
      setDropdownOpen(false);
      dialogSession.openedFromMainMenuRef.current = opts?.fromMainMenu ?? false;
      loadFromConfig(config);
    },
    [config, dialogSession.openedFromMainMenuRef, loadFromConfig, setDropdownOpen],
  );

  const handleOptionsConfirm = useCallback(
    async (
      ignoreMouseInput?: boolean,
      tmuxPrefixKeyAlias?: null | string,
      uiMode?: UIMode,
      honeybeamsEnabled?: boolean,
      privilegedPaneDetection?: boolean,
      muxotronEnabled?: boolean,
      agentAlertAnimGlow?: boolean,
      agentAlertAnimConfusables?: boolean,
      agentAlertAnimScribble?: boolean,
      agentAlertWatermark?: WatermarkShape,
      agentAlertAnimEqualizer?: boolean,
      agentAlertCursorAlert?: boolean,
      agentAlertCursorShape?: CursorAlertShape,
      agentAlertCursorBlink?: CursorAlertBlink,
      agentAlertCursorColor?: string,
      remoteServers?: RemoteServer[],
    ) => {
      const mergedDraft = applyConfirmOverrides(buildOptionsDialogState(dialogSession), {
        agentAlertAnimConfusables,
        agentAlertAnimEqualizer,
        agentAlertAnimGlow,
        agentAlertAnimScribble,
        agentAlertCursorAlert,
        agentAlertCursorBlink,
        agentAlertCursorColor,
        agentAlertCursorShape,
        agentAlertWatermark,
        honeybeamsEnabled,
        ignoreMouseInput,
        muxotronEnabled,
        privilegedPaneDetection,
        remoteServers,
        tmuxPrefixKeyAlias,
        uiMode,
      });

      const newConfig: HoneymuxConfig = {
        activeWindowIdDisplayEnabled: mergedDraft.activeWindowIdDisplayEnabled,
        agentAlertAnimConfusables: mergedDraft.agentAlertAnimConfusables,
        agentAlertAnimCycleCount: mergedDraft.agentAlertAnimCycleCount,
        agentAlertAnimDelay: mergedDraft.agentAlertAnimDelay,
        agentAlertAnimEqualizer: mergedDraft.agentAlertAnimEqualizer,
        agentAlertAnimGlow: mergedDraft.agentAlertAnimGlow,
        agentAlertAnimScribble: mergedDraft.agentAlertAnimScribble,
        agentAlertCursorAlert: mergedDraft.agentAlertCursorAlert,
        agentAlertCursorBlink: mergedDraft.agentAlertCursorBlink,
        agentAlertCursorColor: mergedDraft.agentAlertCursorColor,
        agentAlertCursorShape: mergedDraft.agentAlertCursorShape,
        agentAlertWatermark: mergedDraft.agentAlertWatermark,
        bufferZoomFade: mergedDraft.bufferZoomFade,
        bufferZoomMaxLines: config.bufferZoomMaxLines,
        dimInactivePanes: mergedDraft.dimInactivePanes,
        dimInactivePanesOpacity: mergedDraft.dimInactivePanesOpacity,
        honeybeamsEnabled: mergedDraft.honeybeamsEnabled,
        ignoreMouseInput: mergedDraft.ignoreMouseInput,
        metaSavedAt: Date.now(),
        muxotronEnabled: mergedDraft.muxotronEnabled,
        paneTabsEnabled: mergedDraft.paneTabsEnabled,
        policyLocalOsc52Passthrough: config.policyLocalOsc52Passthrough,
        policyLocalOtherOscPassthrough: config.policyLocalOtherOscPassthrough,
        privilegedPaneDetection: mergedDraft.privilegedPaneDetection,
        privilegedPaneDetectionOpacity: mergedDraft.privilegedPaneDetectionOpacity,
        quickTerminalSize: mergedDraft.quickTerminalSize,
        remote:
          mergedDraft.remoteServers.length > 0
            ? mergedDraft.remoteServers.map((server) => ({
                host: server.host,
                name: server.name,
                ...(server.agentForwarding ? { agentForwarding: true } : {}),
              }))
            : undefined,
        screenshotDir: mergedDraft.screenshotDir,
        screenshotFlash: mergedDraft.screenshotFlash,
        screenshotMaxHeightPixels: config.screenshotMaxHeightPixels,
        themeBuiltin: mergedDraft.themeBuiltin,
        themeCustom: config.themeCustom,
        themeMode: mergedDraft.themeMode,
        tmuxKeyBindingHints: mergedDraft.tmuxKeyBindingHints,
        tmuxPrefixKeyAlias: mergedDraft.tmuxPrefixKeyAlias,
        uiMode: mergedDraft.uiMode,
        zoomAgentsViewStickyKey: config.zoomAgentsViewStickyKey,
        zoomServerViewStickyKey: config.zoomServerViewStickyKey,
      };

      setConfigState(newConfig);
      dialogSession.setOptionsDialogOpen(false);

      await saveConfig(newConfig);

      applyTheme(resolveThemeName(mergedDraft.themeMode, mergedDraft.themeBuiltin), newConfig.themeCustom);
    },
    [config, dialogSession],
  );

  return {
    config,
    setConfig,
    ...sessionApi,
    handleOptionsClick,
    handleOptionsConfirm,
    previewConfigChange,
  };
}

function applyConfirmOverrides(draft: OptionsDialogState, overrides: OptionsConfirmOverrides): OptionsDialogState {
  return {
    ...draft,
    agentAlertAnimConfusables: overrides.agentAlertAnimConfusables ?? draft.agentAlertAnimConfusables,
    agentAlertAnimEqualizer: overrides.agentAlertAnimEqualizer ?? draft.agentAlertAnimEqualizer,
    agentAlertAnimGlow: overrides.agentAlertAnimGlow ?? draft.agentAlertAnimGlow,
    agentAlertAnimScribble: overrides.agentAlertAnimScribble ?? draft.agentAlertAnimScribble,
    agentAlertCursorAlert: overrides.agentAlertCursorAlert ?? draft.agentAlertCursorAlert,
    agentAlertCursorBlink: overrides.agentAlertCursorBlink ?? draft.agentAlertCursorBlink,
    agentAlertCursorColor: overrides.agentAlertCursorColor ?? draft.agentAlertCursorColor,
    agentAlertCursorShape: overrides.agentAlertCursorShape ?? draft.agentAlertCursorShape,
    agentAlertWatermark: overrides.agentAlertWatermark ?? draft.agentAlertWatermark,
    honeybeamsEnabled: overrides.honeybeamsEnabled ?? draft.honeybeamsEnabled,
    ignoreMouseInput: overrides.ignoreMouseInput ?? draft.ignoreMouseInput,
    muxotronEnabled: overrides.muxotronEnabled ?? draft.muxotronEnabled,
    privilegedPaneDetection: overrides.privilegedPaneDetection ?? draft.privilegedPaneDetection,
    remoteServers: overrides.remoteServers ?? draft.remoteServers,
    tmuxPrefixKeyAlias: overrides.tmuxPrefixKeyAlias ?? draft.tmuxPrefixKeyAlias,
    uiMode: overrides.uiMode ?? draft.uiMode,
  };
}
