import { type MouseEvent, TextAttributes } from "@opentui/core";

import type { OptionsDialogActions, OptionsDialogRenderState } from "./options-dialog.tsx";

import {
  DIM_OPACITY_MAX,
  DIM_OPACITY_MIN,
  DIM_OPACITY_STEP,
  ROOT_TINT_MAX,
  ROOT_TINT_MIN,
  ROOT_TINT_STEP,
  type RowKind,
  cycleBuiltinTheme,
  cycleCursorBlink,
  cycleCursorShape,
  cycleDimOpacity,
  cycleQuickSize,
  cycleRootTintOpacity,
  cycleUIMode,
  cycleWatermark,
  toggleThemeMode,
} from "../app/options/model.ts";
import { paletteColors, rgbToHex, theme } from "../themes/theme.ts";
import { formatBinding } from "../util/keybindings.ts";
import { padEndToWidth, padStartToWidth, shortenPath, stringWidth } from "../util/text.ts";
import { getDialogCombinedW } from "./main-menu-dialog.tsx";
import { fitOptionsText, rightTruncateOptionsText, sanitizeOptionsText } from "./options-dialog-display.ts";

/** Width to pad the feature name before appending "  opacity". */
const COMBINED_NAME_W = 32; // " ▸ (◉) Privileged pane detection" is the longest
/** Total label area width: name padded + "  opacity" + 1 space before ◂. */
const COMBINED_LABEL_W = COMBINED_NAME_W + 10; // "  opacity" (9) + 1 padding = 42
export const AGENT_CURSOR_COLOR_SWATCH = "\u2588\u2588";

export function SettingRow({
  actions,
  currentRow,
  kind,
  row,
  state,
}: {
  actions: OptionsDialogActions;
  currentRow: number;
  kind: RowKind;
  row: number;
  state: OptionsDialogRenderState;
}) {
  const {
    animationCycleCountTextareaRef,
    animationDelayTextareaRef,
    onSetActiveWindowIdDisplay,
    onSetAgentConfusables,
    onSetAgentCursorAlert,
    onSetAgentCursorBlink,
    onSetAgentCursorShape,
    onSetAgentEqualizer,
    onSetAgentGlow,
    onSetAgentScribble,
    onSetAgentWatermark,
    onSetBufferZoomFade,
    onSetCursorColorPickerOpen,
    onSetDimInactivePanes,
    onSetDimOpacity,
    onSetHoneybeams,
    onSetMuxotron,
    onSetPaneTabs,
    onSetQuickTerminalSize,
    onSetRootDetection,
    onSetRootTintOpacity,
    onSetScreenshotDir,
    onSetScreenshotFlash,
    onSetTmuxKeyBindingHints,
    onSubmitAnimationCycleCount,
    onSubmitAnimationDelay,
    onSubmitScreenshotDir,
    onToggle,
    screenshotDirTextareaRef,
  } = actions;
  const focused = row === currentRow;
  const color = focused ? theme.textBright : theme.textSecondary;
  const prefix = focused ? " ▸ " : "   ";

  switch (kind) {
    case "activeWindowIdDisplayEnabled": {
      const check = state.activeWindowIdDisplayEnabled ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Show window ID in active tab`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetActiveWindowIdDisplay(!state.activeWindowIdDisplayEnabled);
          }}
        />
      );
    }
    case "agentAlertAnimConfusables": {
      const check = state.agentAlertAnimConfusables ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Confusables`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentConfusables(!state.agentAlertAnimConfusables);
          }}
        />
      );
    }
    case "agentAlertAnimCycleCount": {
      const editing = focused && state.animationCycleCountEditing;
      const label = `${prefix}Anim cycles: `;
      if (editing) {
        return (
          <box flexDirection="row" height={1}>
            <text content={label} fg={color} selectable={false} />
            <textarea
              focused={true}
              height={1}
              initialValue={String(state.agentAlertAnimCycleCount)}
              keyBindings={[{ action: "submit", name: "return" }]}
              onSubmit={onSubmitAnimationCycleCount}
              ref={animationCycleCountTextareaRef}
              textColor={theme.textBright}
              width={8}
            />
          </box>
        );
      }
      return <text content={`${prefix}Anim cycles: ${state.agentAlertAnimCycleCount}`} fg={color} />;
    }
    case "agentAlertAnimDelay": {
      const editing = focused && state.animationDelayEditing;
      const label = `${prefix}Anim delay: `;
      if (editing) {
        return (
          <box flexDirection="row" height={1}>
            <text content={label} fg={color} selectable={false} />
            <textarea
              focused={true}
              height={1}
              initialValue={String(state.agentAlertAnimDelay)}
              keyBindings={[{ action: "submit", name: "return" }]}
              onSubmit={onSubmitAnimationDelay}
              ref={animationDelayTextareaRef}
              textColor={theme.textBright}
              width={8}
            />
            <text content="s" fg={color} selectable={false} />
          </box>
        );
      }
      const display = state.agentAlertAnimDelay === 0 ? "off" : `${state.agentAlertAnimDelay}s`;
      return <text content={`${prefix}Anim delay: ${display}`} fg={color} />;
    }
    case "agentAlertAnimEqualizer": {
      const check = state.agentAlertAnimEqualizer ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Anamorphic equalizer`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentEqualizer(!state.agentAlertAnimEqualizer);
          }}
        />
      );
    }
    case "agentAlertAnimGlow": {
      const check = state.agentAlertAnimGlow ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Glow`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentGlow(!state.agentAlertAnimGlow);
          }}
        />
      );
    }
    case "agentAlertAnimScribble": {
      const check = state.agentAlertAnimScribble ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Scribble`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentScribble(!state.agentAlertAnimScribble);
          }}
        />
      );
    }
    case "agentAlertCursorAlert": {
      const check = state.agentAlertCursorAlert ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Cursor shape & color alert`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentCursorAlert(!state.agentAlertCursorAlert);
          }}
        />
      );
    }
    case "agentAlertCursorBlink": {
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}  Blink: ${arrows ? "◂ " : ""}${state.agentAlertCursorBlink}${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentCursorBlink(cycleCursorBlink(state.agentAlertCursorBlink, 1));
          }}
        />
      );
    }
    case "agentAlertCursorColor": {
      const colorLabel = fitOptionsText(sanitizeOptionsText(state.agentAlertCursorColor), 9);
      return (
        <box flexDirection="row" height={1}>
          <text
            content={`${prefix}  Color: `}
            fg={color}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onSetCursorColorPickerOpen(true);
            }}
          />
          <text
            content={AGENT_CURSOR_COLOR_SWATCH}
            fg={state.agentAlertCursorColor}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onSetCursorColorPickerOpen(true);
            }}
          />
          <text
            content={` ${colorLabel}`}
            fg={color}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onSetCursorColorPickerOpen(true);
            }}
          />
        </box>
      );
    }
    case "agentAlertCursorShape": {
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}  Shape: ${arrows ? "◂ " : ""}${state.agentAlertCursorShape}${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentCursorShape(cycleCursorShape(state.agentAlertCursorShape, 1));
          }}
        />
      );
    }
    case "agentAlertWatermark": {
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}Terminal watermark: ${arrows ? "◂ " : ""}${state.agentAlertWatermark}${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetAgentWatermark(cycleWatermark(state.agentAlertWatermark, 1));
          }}
        />
      );
    }
    case "bufferZoomFade": {
      const check = state.bufferZoomFade ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Buffer zoom fade transition`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetBufferZoomFade(!state.bufferZoomFade);
          }}
        />
      );
    }
    case "dimPanes": {
      const disabled = !state.dimInactivePanes;
      const check = state.dimInactivePanes ? "(●)" : "( )";
      const nameText = padEndToWidth(`${prefix}${check} Dim inactive panes`, COMBINED_NAME_W);
      const padded = padEndToWidth(`${nameText}  opacity`, COMBINED_LABEL_W);
      const rowColor = disabled ? theme.textDim : color;
      const barWidth = (DIM_OPACITY_MAX - DIM_OPACITY_MIN) / DIM_OPACITY_STEP;
      const filled = disabled ? 0 : (state.dimInactivePanesOpacity - DIM_OPACITY_MIN) / DIM_OPACITY_STEP;
      const arrows = focused && state.multiSelectEditing;
      const pctText = arrows
        ? `] ${padStartToWidth(String(state.dimInactivePanesOpacity), 2)}% ▸ `
        : `] ${padStartToWidth(String(state.dimInactivePanesOpacity), 2)}%  `;
      const toggleClick = (event: MouseEvent) => {
        if (event.button === 0) onSetDimInactivePanes(!state.dimInactivePanes);
      };
      const sliderClick = (event: MouseEvent) => {
        if (event.button === 0 && !disabled) onSetDimOpacity(cycleDimOpacity(state.dimInactivePanesOpacity, 1));
      };
      return (
        <box flexDirection="row" height={1}>
          <text content={padded} fg={color} onMouseDown={toggleClick} />
          <text content={arrows ? "◂ [" : "  ["} fg={rowColor} onMouseDown={sliderClick} />
          {filled > 0 && (
            <text
              content={"\u2588".repeat(filled)}
              fg={disabled ? theme.textDim : theme.accent}
              onMouseDown={sliderClick}
            />
          )}
          {barWidth - filled > 0 && (
            <text content={"\u2591".repeat(barWidth - filled)} fg={theme.textDim} onMouseDown={sliderClick} />
          )}
          <text content={pctText} fg={rowColor} onMouseDown={sliderClick} />
        </box>
      );
    }
    case "generalSep": {
      return <text content="" />;
    }
    case "honeybeamsEnabled": {
      const check = state.honeybeamsEnabled ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Honeybeams`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetHoneybeams(!state.honeybeamsEnabled);
          }}
        />
      );
    }
    case "ignoreMouseInput": {
      const check = state.ignoreMouseInput ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Ignore all mouse events`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0)
              onToggle(!state.ignoreMouseInput, state.themeMode, state.themeBuiltin, state.uiMode);
          }}
        />
      );
    }
    case "muxotronEnabled": {
      const disabled = state.uiMode !== "adaptive";
      const check = state.muxotronEnabled ? "(●)" : "( )";
      const rowColor = disabled ? theme.textDim : color;
      return (
        <text
          content={`${prefix}${check} Enable Mux-o-Tron`}
          fg={rowColor}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0 && !disabled) onSetMuxotron(!state.muxotronEnabled);
          }}
        />
      );
    }
    case "paletteSwatch1":
    case "paletteSwatch2": {
      const startIdx = kind === "paletteSwatch1" ? 0 : 8;
      const colors = paletteColors.slice(startIdx, startIdx + 8);
      const dialogWidth = getDialogCombinedW(state.termWidth);
      const subInner = dialogWidth - 6;
      const swatchArea = subInner - 4; // 3 indent + 1 trailing
      const slotWidth = Math.floor(swatchArea / 8);
      const remainder = swatchArea % 8;
      return (
        <box flexDirection="row" height={1}>
          <text content="   " selectable={false} />
          {colors.map((rgb, index) => (
            <text
              content={"\u2588".repeat(slotWidth + (index < remainder ? 1 : 0))}
              fg={rgbToHex(rgb)}
              key={index}
              selectable={false}
            />
          ))}
        </box>
      );
    }
    case "paneTabsEnabled": {
      const check = state.paneTabsEnabled ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Enable pane tabs (experimental)`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetPaneTabs(!state.paneTabsEnabled);
          }}
        />
      );
    }
    case "quickTerminalSize": {
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}Quick terminal size: ${arrows ? "◂ " : ""}${state.quickTerminalSize}%${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetQuickTerminalSize(cycleQuickSize(state.quickTerminalSize, 1));
          }}
        />
      );
    }
    case "rootDetect": {
      const disabled = !state.privilegedPaneDetection;
      const check = state.privilegedPaneDetection ? "(●)" : "( )";
      const nameText = padEndToWidth(`${prefix}${check} Privileged pane detection`, COMBINED_NAME_W);
      const padded = padEndToWidth(`${nameText}  opacity`, COMBINED_LABEL_W);
      const rowColor = disabled ? theme.textDim : color;
      const barWidth = (ROOT_TINT_MAX - ROOT_TINT_MIN) / ROOT_TINT_STEP;
      const filled = disabled ? 0 : (state.privilegedPaneDetectionOpacity - ROOT_TINT_MIN) / ROOT_TINT_STEP;
      const arrows = focused && state.multiSelectEditing;
      const pctText = arrows
        ? `] ${padStartToWidth(String(state.privilegedPaneDetectionOpacity), 2)}% ▸ `
        : `] ${padStartToWidth(String(state.privilegedPaneDetectionOpacity), 2)}%  `;
      const toggleClick = (event: MouseEvent) => {
        if (event.button === 0) onSetRootDetection(!state.privilegedPaneDetection);
      };
      const sliderClick = (event: MouseEvent) => {
        if (event.button === 0 && !disabled) {
          onSetRootTintOpacity(cycleRootTintOpacity(state.privilegedPaneDetectionOpacity, 1));
        }
      };
      return (
        <box flexDirection="row" height={1}>
          <text content={padded} fg={color} onMouseDown={toggleClick} />
          <text content={arrows ? "◂ [" : "  ["} fg={rowColor} onMouseDown={sliderClick} />
          {filled > 0 && (
            <text
              content={"\u2588".repeat(filled)}
              fg={disabled ? theme.textDim : theme.accent}
              onMouseDown={sliderClick}
            />
          )}
          {barWidth - filled > 0 && (
            <text content={"\u2591".repeat(barWidth - filled)} fg={theme.textDim} onMouseDown={sliderClick} />
          )}
          <text content={pctText} fg={rowColor} onMouseDown={sliderClick} />
        </box>
      );
    }
    case "screenshotDir": {
      const editing = focused && state.screenshotDirEditing;
      const label = `${prefix}Screenshot dir: `;
      const fieldWidth = Math.max(0, getDialogCombinedW(state.termWidth) - 4 - 2 - stringWidth(label));
      if (editing) {
        return (
          <box flexDirection="row" height={1}>
            <text content={label} fg={color} selectable={false} />
            <textarea
              focused={true}
              height={1}
              initialValue={state.screenshotDir}
              keyBindings={[{ action: "submit", name: "return" }]}
              onSubmit={onSubmitScreenshotDir}
              ref={screenshotDirTextareaRef}
              textColor={theme.textBright}
              width={fieldWidth}
            />
          </box>
        );
      }
      const rawDir = sanitizeOptionsText(state.screenshotDir) || "(pane cwd)";
      const display = rightTruncateOptionsText(shortenPath(rawDir), fieldWidth);
      return (
        <text
          content={`${label}${display}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetScreenshotDir(state.screenshotDir);
          }}
        />
      );
    }
    case "screenshotFlash": {
      const check = state.screenshotFlash ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Flash pane when taking screenshot`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetScreenshotFlash(!state.screenshotFlash);
          }}
        />
      );
    }
    case "themeBuiltin": {
      const isCustom = state.themeMode === "custom";
      const themeColor = isCustom ? theme.textDim : color;
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}Theme: ${arrows ? "◂ " : ""}${state.themeBuiltin}${arrows ? " ▸" : ""}`}
          fg={themeColor}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0 && !isCustom) {
              const next = cycleBuiltinTheme(state.themeBuiltin, 1);
              onToggle(state.ignoreMouseInput, state.themeMode, next, state.uiMode);
            }
          }}
        />
      );
    }
    case "themeMode": {
      const modeLabel = state.themeMode;
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}Theme mode: ${arrows ? "◂ " : ""}${modeLabel}${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) {
              const next = toggleThemeMode(state.themeMode);
              onToggle(state.ignoreMouseInput, next, state.themeBuiltin, state.uiMode);
            }
          }}
        />
      );
    }
    case "tmuxKeyBindingHints": {
      const check = state.tmuxKeyBindingHints ? "(●)" : "( )";
      return (
        <text
          content={`${prefix}${check} Show tmux key binding hints`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSetTmuxKeyBindingHints(!state.tmuxKeyBindingHints);
          }}
        />
      );
    }
    case "tmuxPrefixKeyAlias": {
      const formatted = state.tmuxPrefixKeyAlias ? formatBinding(state.tmuxPrefixKeyAlias) : "";
      const bindWidth = 17;
      if (state.tmuxPrefixKeyAliasCapturing) {
        const display = fitOptionsText(formatted, bindWidth);
        const label = `${prefix}Prefix key alias: `;
        return (
          <box flexDirection="row">
            <text content={label} fg={color} />
            <text attributes={TextAttributes.UNDERLINE} bg={theme.accent} content={display} fg={theme.bgSurface} />
          </box>
        );
      }
      const display = formatted || "unmapped";
      return <text content={`${prefix}Prefix key alias: ${display}`} fg={color} />;
    }
    case "uiMode": {
      const arrows = focused && state.multiSelectEditing;
      return (
        <text
          content={`${prefix}UI mode: ${arrows ? "◂ " : ""}${state.uiMode}${arrows ? " ▸" : ""}`}
          fg={color}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) {
              onToggle(state.ignoreMouseInput, state.themeMode, state.themeBuiltin, cycleUIMode(state.uiMode, 1));
            }
          }}
        />
      );
    }
    default:
      return null;
  }
}
