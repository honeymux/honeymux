import type { MouseEvent } from "@opentui/core";

import { Buffer } from "node:buffer";

import type { ScreenshotPreview } from "../app/hooks/use-screenshot-workflow.ts";
import type { KeyAction } from "../util/keybindings.ts";

import { DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT } from "../app/hooks/use-screenshot-workflow.ts";
import { theme } from "../themes/theme.ts";
import { identifyKeySequence, isDismissKey } from "../util/keybindings.ts";
import { writeTerminalOutput } from "../util/terminal-output.ts";
import { midTruncatePath, stringWidth } from "../util/text.ts";

export interface ScreenshotDialogProps {
  buttonCol: number; // 0=Viewport, 1=Scrollback, 2=Cancel
  height: number;
  maxHeightPixels?: number;
  onCancel: () => void;
  onFocusScrollback: () => void;
  onScrollback: () => void;
  onViewport: () => void;
  preview: ScreenshotPreview | null;
  scrollbackDisabled: boolean;
  width: number;
}

export interface ScreenshotDoneDialogProps {
  buttonCol: number; // 0=Copy, 1=OK
  filePath: string;
  onCopy: () => void;
  onDismiss: () => void;
}

export interface ScreenshotLargeDialogProps {
  height: number;
  onDismiss: () => void;
  width: number;
}

// --- Screenshot Done Dialog ---

export function ScreenshotDialog({
  buttonCol,
  height,
  maxHeightPixels = DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
  onCancel,
  onFocusScrollback,
  onScrollback,
  onViewport,
  preview,
  scrollbackDisabled,
  width,
}: ScreenshotDialogProps) {
  const minBoxWidth = 56;
  const maxBoxWidth = Math.max(minBoxWidth, width - 4);
  const sizeLine = buildScreenshotSizeLine(preview, buttonCol, maxHeightPixels);
  const showDirLine = shouldShowScreenshotDirLine(preview, buttonCol, maxHeightPixels);
  const rawDir = preview?.dir ?? "";

  // Width must not change when the user toggles between focus options, so
  // size it against the longest possible size-line across all focus states
  // plus the directory line.
  const sidePadding = 4; // 2 border + 2 inner breathing room
  const candidateWidths = [
    minBoxWidth,
    stringWidth(buildScreenshotSizeLine(preview, 0, maxHeightPixels)) + sidePadding,
    stringWidth(buildScreenshotSizeLine(preview, 1, maxHeightPixels)) + sidePadding,
    rawDir.length + sidePadding,
  ];
  const boxWidth = Math.min(maxBoxWidth, Math.max(...candidateWidths));
  const innerWidth = Math.max(1, boxWidth - sidePadding);
  const dirLine = showDirLine && rawDir ? midTruncatePath(rawDir, innerWidth) : "";

  const boxHeight = 8;
  const dialogLeft = Math.floor((width - boxWidth) / 2);
  const dialogTop = Math.floor((height - boxHeight) / 2);

  const borderTitle = " Screenshot ";
  const borderTitleLeft = dialogLeft + Math.floor((boxWidth - borderTitle.length) / 2);

  const viewportSelected = buttonCol === 0;
  const scrollbackSelected = buttonCol === 1;
  const cancelSelected = buttonCol === 2;

  const viewportLabel = viewportSelected ? "▸ [ Viewport ]" : "  [ Viewport ]";
  // Disabled scrollback uses parens instead of brackets so it reads as
  // unavailable even while focusable (focus caret still shown when selected).
  const scrollbackLabel = scrollbackDisabled
    ? scrollbackSelected
      ? "▸ ( Scrollback )"
      : "  ( Scrollback )"
    : scrollbackSelected
      ? "▸ [ Scrollback ]"
      : "  [ Scrollback ]";
  const cancelLabel = cancelSelected ? "▸ [ Cancel ]" : "  [ Cancel ]";

  const viewportColor = viewportSelected ? theme.accent : theme.textDim;
  const scrollbackColor = scrollbackDisabled ? theme.textDim : scrollbackSelected ? theme.accent : theme.textDim;
  const cancelColor = cancelSelected ? theme.text : theme.textDim;

  return (
    <>
      {/* Backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onCancel();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      {/* Dialog */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        justifyContent="center"
        left={dialogLeft}
        position="absolute"
        top={dialogTop}
        width={boxWidth}
        zIndex={20}
      >
        <text content={sizeLine} fg={theme.textDim} />
        <text content={dirLine} fg={theme.text} />
        <text content="" />
        <box flexDirection="row" gap={2}>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onViewport();
            }}
            width={16}
          >
            <text content={viewportLabel} fg={viewportColor} />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button !== 0) return;
              if (scrollbackDisabled) onFocusScrollback();
              else onScrollback();
            }}
            width={16}
          >
            <text content={scrollbackLabel} fg={scrollbackColor} />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onCancel();
            }}
            width={16}
          >
            <text content={cancelLabel} fg={cancelColor} />
          </box>
        </box>
      </box>
      {/* Border title overlay */}
      <text
        bg={theme.bgSurface}
        content={borderTitle}
        fg={theme.textBright}
        left={borderTitleLeft}
        position="absolute"
        top={dialogTop}
        zIndex={21}
      />
    </>
  );
}

export function ScreenshotDoneDialog({ buttonCol, filePath, onCopy, onDismiss }: ScreenshotDoneDialogProps) {
  const boxWidth = Math.max(40, filePath.length + 10);
  const boxHeight = 8;

  const copySelected = buttonCol === 0;
  const okSelected = buttonCol === 1;

  const copyLabel = copySelected ? "[⧉]" : " ⧉ ";
  const okLabel = okSelected ? "▸ [ OK ]" : "  [ OK ]";

  const copyColor = copySelected ? theme.accent : theme.text;
  const okColor = okSelected ? theme.accent : theme.textDim;

  return (
    <>
      {/* Backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onDismiss();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      {/* Dialog */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        justifyContent="center"
        left="50%"
        marginLeft={-Math.floor(boxWidth / 2)}
        marginTop={-Math.floor(boxHeight / 2)}
        position="absolute"
        top="50%"
        width={boxWidth}
        zIndex={20}
      >
        <text content="Screenshot Saved" fg={theme.textBright} />
        <text content="" />
        <box flexDirection="row" gap={1}>
          <box backgroundColor={theme.bg} height={1}>
            <text content={` ${filePath} `} fg={theme.text} />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onCopy();
            }}
            width={3}
          >
            <text content={copyLabel} fg={copyColor} />
          </box>
        </box>
        <text content="" />
        <box
          alignItems="center"
          height={1}
          justifyContent="center"
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onDismiss();
          }}
          width={10}
        >
          <text content={okLabel} fg={okColor} />
        </box>
      </box>
    </>
  );
}

export function ScreenshotLargeDialog({ height, onDismiss, width }: ScreenshotLargeDialogProps) {
  const boxWidth = 56;
  const boxHeight = 8;
  const dialogLeft = Math.floor((width - boxWidth) / 2);
  const dialogTop = Math.floor((height - boxHeight) / 2);

  const borderTitle = " Notice ";
  const borderTitleLeft = dialogLeft + Math.floor((boxWidth - borderTitle.length) / 2);

  return (
    <>
      {/* Backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onDismiss();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      {/* Dialog */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        justifyContent="center"
        left={dialogLeft}
        position="absolute"
        top={dialogTop}
        width={boxWidth}
        zIndex={20}
      >
        <text content="Large image; a notification will be raised" fg={theme.text} />
        <text content="when the file write is complete." fg={theme.text} />
        <text content="" />
        <box
          alignItems="center"
          height={1}
          justifyContent="center"
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onDismiss();
          }}
          width={10}
        >
          <text content="▸ [ OK ]" fg={theme.accent} />
        </box>
      </box>
      {/* Border title overlay */}
      <text
        bg={theme.bgSurface}
        content={borderTitle}
        fg={theme.textBright}
        left={borderTitleLeft}
        position="absolute"
        top={dialogTop}
        zIndex={21}
      />
    </>
  );
}

export function buildScreenshotSizeLine(
  preview: ScreenshotPreview | null,
  buttonCol: number,
  maxHeight: number = DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
): string {
  if (!preview) return "Computing image size…";
  const dims = buttonCol === 1 ? preview.scrollbackDims : preview.viewportDims;
  if (dims === "loading") return "Computing scrollback size…";
  if (dims === "error") return "Scrollback size unavailable";
  if (buttonCol === 1 && dims.height > maxHeight) {
    return `Scrollback too long for capture (${dims.height} > ${maxHeight})`;
  }
  return `An image with dimensions ${dims.width} × ${dims.height} will be written to`;
}

/**
 * Handle keyboard input for the screenshot dialog.
 * Returns updated buttonCol, "handled" if an action was taken, or null.
 * When scrollbackDisabled is true, the scrollback button remains focusable
 * (so the size-line can explain why), but Enter/Space on it is a no-op.
 */
export function handleScreenshotDialogInput(
  data: string,
  buttonCol: number,
  onViewport: () => void,
  onScrollback: () => void,
  onCancel: () => void,
  scrollbackDisabled: boolean,
  sequenceMap?: Map<string, KeyAction>,
): "handled" | null | number {
  // Escape or screenshot keybinding → cancel
  const canonical = identifyKeySequence(data);
  if (isDismissKey(data) || (canonical && sequenceMap?.get(canonical) === "screenshot")) {
    onCancel();
    return "handled";
  }

  // Left arrow / Shift+Tab
  if (data === "\x1b[D" || data === "\x1b[Z") {
    return (buttonCol + 2) % 3;
  }

  // Right arrow / Tab
  if (data === "\x1b[C" || data === "\t") {
    return (buttonCol + 1) % 3;
  }

  // Enter or Space — dispatch to current button
  if (data === "\r" || data === "\n" || data === " ") {
    if (buttonCol === 0) onViewport();
    else if (buttonCol === 1) {
      if (scrollbackDisabled) return "handled";
      onScrollback();
    } else onCancel();
    return "handled";
  }

  return null;
}

/**
 * Handle keyboard input for the screenshot-done dialog.
 * Returns updated buttonCol, "handled" if an action was taken, or null.
 */
export function handleScreenshotDoneDialogInput(
  data: string,
  buttonCol: number,
  onCopy: () => void,
  onDismiss: () => void,
): "handled" | null | number {
  // Escape → dismiss
  if (isDismissKey(data)) {
    onDismiss();
    return "handled";
  }

  // Left arrow / Shift+Tab
  if (data === "\x1b[D" || data === "\x1b[Z") {
    return (buttonCol + 1) % 2;
  }

  // Right arrow / Tab
  if (data === "\x1b[C" || data === "\t") {
    return (buttonCol + 1) % 2;
  }

  // Enter or Space — dispatch to current button
  if (data === "\r" || data === "\n" || data === " ") {
    if (buttonCol === 0) onCopy();
    else onDismiss();
    return "handled";
  }

  return null;
}

/**
 * Handle keyboard input for the "large image" notice dialog.
 * Any of Esc, Enter, or Space dismisses.
 */
export function handleScreenshotLargeDialogInput(data: string, onDismiss: () => void): "handled" | null {
  if (isDismissKey(data) || data === "\r" || data === "\n" || data === " ") {
    onDismiss();
    return "handled";
  }
  return null;
}

export function shouldShowScreenshotDirLine(
  preview: ScreenshotPreview | null,
  buttonCol: number,
  maxHeight: number = DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT,
): boolean {
  if (!preview) return false;
  if (buttonCol !== 1) return true;
  const dims = preview.scrollbackDims;
  if (typeof dims !== "object") return true;
  return dims.height <= maxHeight;
}

export { copyToClipboard };

function copyToClipboard(text: string): void {
  // OSC 52: set system clipboard via terminal emulator
  const encoded = Buffer.from(text).toString("base64");
  writeTerminalOutput(`\x1b]52;c;${encoded}\x1b\\`);
}
