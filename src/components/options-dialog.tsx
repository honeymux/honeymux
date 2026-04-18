import type { MouseEvent } from "@opentui/core";

import { useRenderer } from "@opentui/react";
import { useCallback, useEffect, useRef } from "react";

import type { Base16SchemeName, ThemeMode } from "../themes/theme.ts";
import type { CursorAlertShape, UIMode, WatermarkShape } from "../util/config.ts";

import { buildOptionsDialogState } from "../app/options/bridge.ts";
import {
  MAX_CONTENT_ROWS,
  OPTION_HELP,
  type OptionsDialogState,
  type OptionsTab,
  type RemoteAddingState,
  type RemoteEditingState,
  type RemoteServer,
  type RemoteTestingState,
  type RowKind,
  TAB_LABELS,
  TAB_ORDER,
  TAB_ROWS,
} from "../app/options/model.ts";
import { theme } from "../themes/theme.ts";
import { CONFIG_FILE, defaultConfig } from "../util/config.ts";
import { formatBinding } from "../util/keybindings.ts";
import { shortenPath, stringWidth } from "../util/text.ts";
import { COLOR_PICKER_MIN_WIDTH, ColorPicker } from "./color-picker.tsx";
import { getDialogCombinedW } from "./main-menu-dialog.tsx";
import { OptionsControlsContent } from "./options-dialog-content.tsx";
import { centerOptionsText, sanitizeOptionsText, wrapOptionsText } from "./options-dialog-display.ts";
import { useCaptureGlow } from "./use-capture-glow.ts";

export interface OptionsDialogActions {
  animationCycleCountTextareaRef: React.RefObject<any>;
  animationDelayTextareaRef: React.RefObject<any>;
  onSetActiveWindowIdDisplay: OptionsDialogWorkflow["setConfigActiveWindowIdDisplayEnabled"];
  onSetAgentConfusables: OptionsDialogWorkflow["setConfigAgentAlertAnimConfusables"];
  onSetAgentCursorAlert: OptionsDialogWorkflow["setConfigAgentAlertCursorAlert"];
  onSetAgentCursorBlink: OptionsDialogWorkflow["setConfigAgentAlertCursorBlink"];
  onSetAgentCursorColor: OptionsDialogWorkflow["setConfigAgentAlertCursorColor"];
  onSetAgentCursorShape: OptionsDialogWorkflow["setConfigAgentAlertCursorShape"];
  onSetAgentEqualizer: OptionsDialogWorkflow["setConfigAgentAlertAnimEqualizer"];
  onSetAgentGlow: OptionsDialogWorkflow["setConfigAgentAlertAnimGlow"];
  onSetAgentScribble: OptionsDialogWorkflow["setConfigAgentAlertAnimScribble"];
  onSetAgentWatermark: OptionsDialogWorkflow["setConfigAgentAlertWatermark"];
  onSetBufferZoomFade: OptionsDialogWorkflow["setConfigBufferZoomFade"];
  onSetCursorColorPickerOpen: OptionsDialogWorkflow["setConfigCursorColorPickerOpen"];
  onSetDimInactivePanes: OptionsDialogWorkflow["setConfigDimInactivePanes"];
  onSetDimOpacity: OptionsDialogWorkflow["setConfigDimInactivePanesOpacity"];
  onSetHoneybeams: OptionsDialogWorkflow["setConfigHoneybeamsEnabled"];
  onSetMuxotron: OptionsDialogWorkflow["setConfigMuxotronEnabled"];
  onSetPaneTabs: OptionsDialogWorkflow["setConfigPaneTabsEnabled"];
  onSetQuickTerminalSize: OptionsDialogWorkflow["setConfigQuickTerminalSize"];
  onSetRootDetection: OptionsDialogWorkflow["setConfigPrivilegedPaneDetection"];
  onSetRootTintOpacity: OptionsDialogWorkflow["setConfigPrivilegedPaneDetectionOpacity"];
  onSetScreenshotDir: OptionsDialogWorkflow["setConfigScreenshotDir"];
  onSetScreenshotFlash: OptionsDialogWorkflow["setConfigScreenshotFlash"];
  onSetTmuxKeyBindingHints: OptionsDialogWorkflow["setConfigTmuxKeyBindingHints"];
  onSubmitAnimationCycleCount: () => void;
  onSubmitAnimationDelay: () => void;
  onSubmitScreenshotDir: () => void;
  onToggle: OptionsDialogToggleAction;
  screenshotDirTextareaRef: React.RefObject<any>;
}

export type OptionsDialogConfirmAction = (
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
  agentAlertCursorBlink?: boolean,
  agentAlertCursorColor?: string,
  remoteServers?: RemoteServer[],
) => Promise<void> | void;

export interface OptionsDialogRenderState extends OptionsDialogState {
  termHeight: number;
  termWidth: number;
}

export type OptionsDialogToggleAction = (
  ignoreMouseInput?: boolean,
  themeMode?: ThemeMode,
  themeBuiltin?: Base16SchemeName,
  uiMode?: UIMode,
) => void;

interface OptionsDialogChrome {
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  termHeight: number;
  termWidth: number;
  textInputActive: React.MutableRefObject<boolean>;
  textInputEscapeHandlerRef: React.MutableRefObject<(() => void) | null>;
  tmuxPrefixLabel: null | string;
}

interface OptionsDialogProps {
  chrome: OptionsDialogChrome;
  workflow: OptionsDialogWorkflow;
}

interface OptionsDialogWorkflow {
  configActiveWindowIdDisplayEnabled: boolean;
  configAgentAlertAnimConfusables: boolean;
  configAgentAlertAnimCycleCount: number;
  configAgentAlertAnimDelay: number;
  configAgentAlertAnimEqualizer: boolean;
  configAgentAlertAnimGlow: boolean;
  configAgentAlertAnimScribble: boolean;
  configAgentAlertCursorAlert: boolean;
  configAgentAlertCursorBlink: boolean;
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
  handleOptionsConfirm: OptionsDialogConfirmAction;
  optionsDialogRow: number;
  optionsDialogTab: OptionsTab;
  previewConfigChange: OptionsDialogToggleAction;
  remoteEditRef: React.MutableRefObject<{ adding: RemoteAddingState; editing: RemoteEditingState }>;
  screenshotDirEditRef: React.MutableRefObject<{ cursor: number; dir: string; editing: boolean }>;
  setConfigActiveWindowIdDisplayEnabled: (value: boolean) => void;
  setConfigAgentAlertAnimConfusables: (value: boolean) => void;
  setConfigAgentAlertAnimCycleCount: (value: number) => void;
  setConfigAgentAlertAnimDelay: (value: number) => void;
  setConfigAgentAlertAnimEqualizer: (value: boolean) => void;
  setConfigAgentAlertAnimGlow: (value: boolean) => void;
  setConfigAgentAlertAnimScribble: (value: boolean) => void;
  setConfigAgentAlertCursorAlert: (value: boolean) => void;
  setConfigAgentAlertCursorBlink: (value: boolean) => void;
  setConfigAgentAlertCursorColor: (value: string) => void;
  setConfigAgentAlertCursorShape: (value: CursorAlertShape) => void;
  setConfigAgentAlertWatermark: (value: WatermarkShape) => void;
  setConfigAnimationCycleCountEditing: (value: boolean) => void;
  setConfigAnimationDelayEditing: (value: boolean) => void;
  setConfigBufferZoomFade: (value: boolean) => void;
  setConfigCursorColorPickerOpen: (value: boolean) => void;
  setConfigDimInactivePanes: (value: boolean) => void;
  setConfigDimInactivePanesOpacity: (value: number) => void;
  setConfigHoneybeamsEnabled: (value: boolean) => void;
  setConfigMultiSelectEditing: (value: boolean) => void;
  setConfigMuxotronEnabled: (value: boolean) => void;
  setConfigPaneTabsEnabled: (value: boolean) => void;
  setConfigPrivilegedPaneDetection: (value: boolean) => void;
  setConfigPrivilegedPaneDetectionOpacity: (value: number) => void;
  setConfigQuickTerminalSize: (value: number) => void;
  setConfigScreenshotDir: (value: string) => void;
  setConfigScreenshotDirEditing: (value: boolean) => void;
  setConfigScreenshotFlash: (value: boolean) => void;
  setConfigTmuxKeyBindingHints: (value: boolean) => void;
  setOptionsDialogTab: (tab: OptionsTab) => void;
}

const MULTI_SELECT_KINDS: ReadonlySet<RowKind> = new Set([
  "agentAlertCursorShape",
  "agentAlertWatermark",
  "quickTerminalSize",
  "themeBuiltin",
  "themeMode",
  "uiMode",
]);

export function OptionsDialog({ chrome, workflow }: OptionsDialogProps) {
  const { dropdownInputRef, termHeight, termWidth, textInputActive, textInputEscapeHandlerRef, tmuxPrefixLabel } =
    chrome;
  const configPath = shortenPath(CONFIG_FILE);
  const { glowColor: captureGlowColor } = useCaptureGlow(workflow.configTmuxPrefixKeyAliasCapturing);
  const boxHeight = 22;
  const dialogWidth = getDialogCombinedW(termWidth);
  const innerBoxWidth = dialogWidth - 4;
  const subInner = innerBoxWidth - 2;
  const helpWrapWidth = subInner - 4;
  const subTopLine = `╭${"─".repeat(subInner)}╮`;
  const subSeparator = `├${"─".repeat(subInner)}┤`;
  const subBottom = `╰${"─".repeat(subInner)}╯`;
  const splitLeftWidth = Math.floor((subInner - 1) / 2);
  const splitRightWidth = subInner - 1 - splitLeftWidth;
  const splitTopLine = `╭${"─".repeat(splitLeftWidth)}┬${"─".repeat(splitRightWidth)}╮`;
  const splitMergeSeparator = `├${"─".repeat(splitLeftWidth)}┴${"─".repeat(splitRightWidth)}┤`;

  const renderer = useRenderer();
  const captureCursorRef = useRef<{ x: number; y: number } | null>(null);
  const screenshotDirTextareaRef = useRef<any>(null);
  const animationDelayTextareaRef = useRef<any>(null);
  const animationCycleCountTextareaRef = useRef<any>(null);

  const onSubmitScreenshotDir = useCallback(() => {
    const text = (screenshotDirTextareaRef.current?.plainText ?? "").trim();
    workflow.setConfigScreenshotDir(text || defaultConfig().screenshotDir);
    workflow.setConfigScreenshotDirEditing(false);
  }, [workflow]);

  const onSubmitAnimationDelay = useCallback(() => {
    const text = (animationDelayTextareaRef.current?.plainText ?? "").trim();
    const parsed = parseInt(text, 10);
    const value = isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, 86400);
    workflow.setConfigAgentAlertAnimDelay(value);
    workflow.setConfigAnimationDelayEditing(false);
  }, [workflow]);

  const onSubmitAnimationCycleCount = useCallback(() => {
    const text = (animationCycleCountTextareaRef.current?.plainText ?? "").trim();
    const parsed = parseInt(text, 10);
    const value = isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, 1_000_000);
    workflow.setConfigAgentAlertAnimCycleCount(value);
    workflow.setConfigAnimationCycleCountEditing(false);
  }, [workflow]);

  // While any text field is editing, route all keys to OpenTUI's textarea by
  // flipping `textInputActive` on, and register an escape handler so pressing
  // Escape aborts the edit and reverts to the value that was in effect before
  // editing began. The textarea keeps its own scratch buffer and only commits
  // on Enter, so canceling is just flipping `editing` off.
  const screenshotDirEditing = workflow.configScreenshotDirEditing;
  const animationDelayEditing = workflow.configAnimationDelayEditing;
  const animationCycleCountEditing = workflow.configAnimationCycleCountEditing;
  const activeEscapeHandler: (() => void) | null = screenshotDirEditing
    ? () => workflow.setConfigScreenshotDirEditing(false)
    : animationDelayEditing
      ? () => workflow.setConfigAnimationDelayEditing(false)
      : animationCycleCountEditing
        ? () => workflow.setConfigAnimationCycleCountEditing(false)
        : null;
  useEffect(() => {
    if (!activeEscapeHandler) return;
    textInputActive.current = true;
    textInputEscapeHandlerRef.current = activeEscapeHandler;
    return () => {
      textInputActive.current = false;
      if (textInputEscapeHandlerRef.current === activeEscapeHandler) {
        textInputEscapeHandlerRef.current = null;
      }
    };
  }, [activeEscapeHandler, textInputActive, textInputEscapeHandlerRef]);

  // Start the caret at the end of the initial value so typing appends rather
  // than overwriting (matching DropdownInputPanel's behavior).
  useEffect(() => {
    if (screenshotDirEditing) screenshotDirTextareaRef.current?.gotoBufferEnd();
  }, [screenshotDirEditing]);
  useEffect(() => {
    if (animationDelayEditing) animationDelayTextareaRef.current?.gotoBufferEnd();
  }, [animationDelayEditing]);
  useEffect(() => {
    if (animationCycleCountEditing) animationCycleCountTextareaRef.current?.gotoBufferEnd();
  }, [animationCycleCountEditing]);

  if (workflow.configTmuxPrefixKeyAliasCapturing && workflow.optionsDialogTab === "input") {
    const dialogLeft = Math.floor((termWidth - dialogWidth) / 2);
    const dialogTop = Math.floor((termHeight - boxHeight) / 2);
    const totalContentRows = MAX_CONTENT_ROWS - 2;
    const rightContentRows = 3;
    const centeredRightPadTop = Math.max(0, Math.floor((totalContentRows - rightContentRows) / 2));
    const rightPadTop = Math.max(0, centeredRightPadTop);
    const rowY = dialogTop + 1 + 7 + rightPadTop + 2;
    const rightColumnX = dialogLeft + 2 + 1 + splitLeftWidth + 1 + 1;
    const labelWidth = stringWidth(" ▸ Prefix key alias: ");
    const formatted = workflow.configTmuxPrefixKeyAlias ? formatBinding(workflow.configTmuxPrefixKeyAlias) : "";
    const cursorInSlot = Math.min(stringWidth(sanitizeOptionsText(formatted)), 17);
    captureCursorRef.current = { x: rightColumnX + labelWidth + cursorInSlot, y: rowY };
  } else {
    captureCursorRef.current = null;
  }

  useEffect(() => {
    const postProcess = () => {
      const pos = captureCursorRef.current;
      if (pos) renderer.setCursorPosition(pos.x, pos.y, true);
    };
    renderer.addPostProcessFn(postProcess);
    return () => {
      renderer.removePostProcessFn(postProcess);
    };
  }, [renderer]);

  const state: OptionsDialogRenderState = {
    ...buildOptionsDialogState(workflow),
    termHeight,
    termWidth,
  };

  const actions: OptionsDialogActions = {
    animationCycleCountTextareaRef,
    animationDelayTextareaRef,
    onSetActiveWindowIdDisplay: workflow.setConfigActiveWindowIdDisplayEnabled,
    onSetAgentConfusables: workflow.setConfigAgentAlertAnimConfusables,
    onSetAgentCursorAlert: workflow.setConfigAgentAlertCursorAlert,
    onSetAgentCursorBlink: workflow.setConfigAgentAlertCursorBlink,
    onSetAgentCursorColor: workflow.setConfigAgentAlertCursorColor,
    onSetAgentCursorShape: workflow.setConfigAgentAlertCursorShape,
    onSetAgentEqualizer: workflow.setConfigAgentAlertAnimEqualizer,
    onSetAgentGlow: workflow.setConfigAgentAlertAnimGlow,
    onSetAgentScribble: workflow.setConfigAgentAlertAnimScribble,
    onSetAgentWatermark: workflow.setConfigAgentAlertWatermark,
    onSetBufferZoomFade: workflow.setConfigBufferZoomFade,
    onSetCursorColorPickerOpen: workflow.setConfigCursorColorPickerOpen,
    onSetDimInactivePanes: workflow.setConfigDimInactivePanes,
    onSetDimOpacity: workflow.setConfigDimInactivePanesOpacity,
    onSetHoneybeams: workflow.setConfigHoneybeamsEnabled,
    onSetMuxotron: workflow.setConfigMuxotronEnabled,
    onSetPaneTabs: workflow.setConfigPaneTabsEnabled,
    onSetQuickTerminalSize: workflow.setConfigQuickTerminalSize,
    onSetRootDetection: workflow.setConfigPrivilegedPaneDetection,
    onSetRootTintOpacity: workflow.setConfigPrivilegedPaneDetectionOpacity,
    onSetScreenshotDir: workflow.setConfigScreenshotDir,
    onSetScreenshotFlash: workflow.setConfigScreenshotFlash,
    onSetTmuxKeyBindingHints: workflow.setConfigTmuxKeyBindingHints,
    onSubmitAnimationCycleCount,
    onSubmitAnimationDelay,
    onSubmitScreenshotDir,
    onToggle: workflow.previewConfigChange,
    screenshotDirTextareaRef,
  };

  const { actionHint: initialActionHint, helpText: initialHelpText } = getOptionsDialogHelpState(state);
  const rows = TAB_ROWS[state.tab];
  const currentKind = rows[state.row] as RowKind;
  const isCapturing = state.tmuxPrefixKeyAliasCapturing;
  const actionHint = isCapturing ? null : initialActionHint;
  const helpText = isCapturing ? state.tmuxPrefixKeyAliasCaptureError || "press modifier key to bind" : initialHelpText;

  const helpLines = wrapOptionsText(helpText, helpWrapWidth);
  if (helpLines.length < 1) helpLines.push("");
  if (helpLines.length > 1) helpLines.length = 1;

  const confirmSave = () =>
    workflow.handleOptionsConfirm(
      state.ignoreMouseInput,
      state.tmuxPrefixKeyAlias,
      state.uiMode,
      state.honeybeamsEnabled,
      state.privilegedPaneDetection,
      state.muxotronEnabled,
      state.agentAlertAnimGlow,
      state.agentAlertAnimConfusables,
      state.agentAlertAnimScribble,
      state.agentAlertWatermark,
      state.agentAlertAnimEqualizer,
      state.agentAlertCursorAlert,
      state.agentAlertCursorShape,
      state.agentAlertCursorBlink,
      state.agentAlertCursorColor,
      state.remoteServers,
    );

  return (
    <>
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) confirmSave();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        id="honeyshots:options"
        justifyContent="center"
        left={Math.floor((termWidth - dialogWidth) / 2)}
        position="absolute"
        top={Math.floor((termHeight - boxHeight) / 2)}
        width={dialogWidth}
        zIndex={20}
      >
        <box height={1} />
        <box flexDirection="row" gap={2} height={1}>
          {TAB_ORDER.map((tab) => {
            const active = tab === state.tab;
            return (
              <text
                bg={active ? theme.accent : theme.textDim}
                content={` ${TAB_LABELS[tab]} `}
                fg={active ? theme.bgSurface : theme.text}
                key={tab}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) workflow.setOptionsDialogTab(tab);
                }}
              />
            );
          })}
        </box>
        <box height={1} />
        <box flexDirection="row" height={1}>
          <text content={isSplitTab(state.tab) ? splitTopLine : subTopLine} fg={theme.textDim} />
        </box>
        <OptionsControlsContent
          actions={actions}
          innerWidth={subInner}
          splitLeftWidth={splitLeftWidth}
          splitRightWidth={splitRightWidth}
          state={state}
          tmuxPrefixLabel={tmuxPrefixLabel}
        />
        <box flexDirection="row" height={1}>
          <text content={isSplitTab(state.tab) ? splitMergeSeparator : subSeparator} fg={theme.textDim} />
        </box>
        {helpLines.map((line, index) => (
          <box flexDirection="row" height={1} key={`help-${index}`}>
            <text content="│" fg={theme.textDim} />
            <text
              content={centerOptionsText(line, subInner)}
              fg={
                isCapturing
                  ? state.tmuxPrefixKeyAliasCaptureError
                    ? theme.statusError
                    : captureGlowColor
                  : theme.textSecondary
              }
            />
            <text content="│" fg={theme.textDim} />
          </box>
        ))}
        <box flexDirection="row" height={1}>
          <text content={subSeparator} fg={theme.textDim} />
        </box>
        <box flexDirection="row" height={1}>
          <text content="│" fg={theme.textDim} />
          <text content={centerOptionsText(configPath, subInner)} fg={theme.textDim} />
          <text content="│" fg={theme.textDim} />
        </box>
        <box flexDirection="row" height={1}>
          <text content={subBottom} fg={theme.textDim} />
        </box>
        <box flexDirection="row" gap={2} height={1} justifyContent="center">
          {isCapturing ? (
            <>
              <text content="esc" fg={theme.accent} />
              <text content="cancel" fg={theme.textDim} />
            </>
          ) : state.multiSelectEditing ? (
            <>
              {actionHint && (
                <>
                  <text content={actionHint.key} fg={theme.accent} />
                  <text content={actionHint.label} fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              <text content="↵/esc" fg={theme.accent} />
              <text content="done" fg={theme.textDim} />
            </>
          ) : (
            <>
              <text content={isSplitTab(state.tab) ? "↑↓←→" : "↑↓"} fg={theme.accent} />
              <text content="nav" fg={theme.textDim} />
              <text content=" " />
              <text content="tab" fg={theme.accent} />
              <text content="switch page" fg={theme.textDim} />
              <text content=" " />
              {actionHint && (
                <>
                  <text content={actionHint.key} fg={theme.accent} />
                  <text content={actionHint.label} fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              {currentKind === "tmuxPrefixKeyAlias" && state.tmuxPrefixKeyAlias !== null && (
                <>
                  <text content="del" fg={theme.accent} />
                  <text content="unmap" fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              <text content="esc" fg={theme.accent} />
              <text content="close" fg={theme.textDim} />
            </>
          )}
        </box>
      </box>
      <text
        bg={theme.bgSurface}
        content=" Options "
        fg={theme.textBright}
        left={Math.floor((termWidth - 9) / 2)}
        position="absolute"
        selectable={false}
        top={Math.floor((termHeight - boxHeight) / 2)}
        zIndex={21}
      />
      {state.cursorColorPickerOpen && (
        <box
          left={Math.floor((termWidth - Math.min(COLOR_PICKER_MIN_WIDTH, termWidth - 4)) / 2)}
          position="absolute"
          top={Math.floor((termHeight - 20) / 2)}
          zIndex={22}
        >
          <ColorPicker
            dropdownInputRef={dropdownInputRef}
            onClose={() => actions.onSetCursorColorPickerOpen(false)}
            onSelect={(color) => {
              if (color !== null) actions.onSetAgentCursorColor(color);
              actions.onSetCursorColorPickerOpen(false);
            }}
            selectedColor={state.agentAlertCursorColor}
            width={Math.min(COLOR_PICKER_MIN_WIDTH, termWidth - 4)}
          />
        </box>
      )}
    </>
  );
}

function getOptionsDialogHelpState(state: OptionsDialogRenderState): {
  actionHint: { key: string; label: string } | null;
  helpText: string;
} {
  const rows = TAB_ROWS[state.tab];
  const currentKind = rows[state.row] as RowKind;

  if (state.tab === "remote") {
    return {
      actionHint:
        state.remoteEditing || state.remoteAdding
          ? { key: "↵", label: "confirm" }
          : { key: "a/d/↵/e/t", label: "add/del/name/host/test" },
      helpText:
        state.remoteEditing || state.remoteAdding
          ? "Type to edit. Enter to confirm, Esc to cancel."
          : "Servers for persistent remote panes. Use ≡ menu on any pane to connect.",
    };
  }

  const isMultiSelect = MULTI_SELECT_KINDS.has(currentKind);
  const isEdit =
    currentKind === "screenshotDir" ||
    currentKind === "agentAlertAnimDelay" ||
    currentKind === "agentAlertAnimCycleCount";
  const isCapture = currentKind === "tmuxPrefixKeyAlias";
  const isCombined = currentKind === "dimPanes" || currentKind === "rootDetect";

  const actionHint = state.multiSelectEditing
    ? { key: "←→", label: isCombined ? "adjust" : "select" }
    : isCombined
      ? { key: "space/↵", label: "toggle/adjust" }
      : isMultiSelect
        ? { key: "↵", label: "select" }
        : isEdit || isCapture
          ? { key: "↵", label: isCapture ? "map" : "edit" }
          : currentKind === "generalSep"
            ? null
            : { key: "space", label: "toggle" };

  const helpText =
    currentKind === "themeMode" && state.themeMode === "custom"
      ? 'Edit "themeCustom" base16 palette in config.json to define your own colors.'
      : currentKind === "uiMode"
        ? ((
            {
              adaptive: "Adaptive mode: window tabs, mux-o-tron, session menu, UI controls, etc",
              "marquee-bottom": "Marquee-bottom mode: full-width mux-o-tron (bottom of screen)",
              "marquee-top": "Marquee-top mode: full-width mux-o-tron (top of screen)",
              raw: "Raw mode: no forced always-visible chrome; UI on demand only",
            } as Record<string, string>
          )[state.uiMode] ?? "")
        : OPTION_HELP[currentKind] || "";

  return { actionHint, helpText };
}

function isSplitTab(tab: OptionsTab): boolean {
  return tab === "agents" || tab === "input";
}
