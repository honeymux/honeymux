import type { TerminalLine } from "ghostty-opentui";
import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import takumiNativePath from "@hmx/takumi-native-path";
import { StyleFlags } from "ghostty-opentui";
import { mkdirSync } from "node:fs";
import { useCallback, useRef, useState } from "react";

import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";

import { theme } from "../../themes/theme.ts";
import { computeHoneybeamOffsets } from "../../util/honeybeam-animation.ts";
import { log } from "../../util/log.ts";
import { runScreenshotFlash } from "../../util/screenshot-flash.ts";
import { cropTerminalData } from "../../util/terminal-data-crop.ts";

export interface ImageDims {
  height: number;
  width: number;
}

export interface ScreenshotPreview {
  dir: string;
  scrollbackDims: "error" | "loading" | ImageDims;
  viewportDims: ImageDims;
}

export interface ScreenshotWorkflowApi {
  dismissScreenshotDone: () => void;
  dismissScreenshotError: () => void;
  dismissScreenshotLargeDialog: () => void;
  handleScreenshotCapture: (mode: ScreenshotMode) => Promise<void>;
  openScreenshotDialog: () => void;
  screenshotButtonCol: number;
  screenshotDialogOpen: boolean;
  screenshotDoneButtonCol: number;
  screenshotDonePath: null | string;
  screenshotError: null | string;
  screenshotLargeDialogOpen: boolean;
  screenshotPreview: ScreenshotPreview | null;
  setScreenshotButtonCol: (col: number) => void;
  setScreenshotDialogOpen: (open: boolean) => void;
  setScreenshotDoneButtonCol: (col: number) => void;
  setScreenshotDonePath: (path: null | string) => void;
}

/** If capture + render + write has not finished in this long, show the
 * large-image notice dialog so the user knows they can walk away. */
const LARGE_IMAGE_DIALOG_DELAY_MS = 2000;

/** Default maximum image height in pixels that we're willing to render.
 * Scrollback captures that would exceed this are refused up front because
 * renderers and image formats commonly cap per-dimension size at 65535 (u16).
 * Override via the `screenshotMaxHeightPixels` config key. */
export const DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT = 65535;

type ScreenshotMode = "scrollback" | "viewport";

interface UseScreenshotWorkflowOptions {
  configScreenshotDir: string;
  configScreenshotFlash: boolean;
  refs: Pick<
    AppRuntimeRefs,
    "addInfoRef" | "clientRef" | "dimsRef" | "handleRedrawRef" | "sidebarOpenRef" | "sidebarWidthRef" | "terminalRef"
  >;
}

export function isScrollbackTooTall(preview: ScreenshotPreview | null, maxHeight: number): boolean {
  if (!preview) return false;
  const dims = preview.scrollbackDims;
  return typeof dims === "object" && dims.height > maxHeight;
}

export const MAX_SCROLLBACK_LINES = 5000;

// Must match the defaults used at the renderTerminalToImage call site below,
// and the constants in node_modules/ghostty-opentui/src/image.ts.
const PREVIEW_FONT_SIZE = 14;
const PREVIEW_LINE_HEIGHT = 1.5;
const PREVIEW_CHAR_WIDTH_FACTOR = 0.6;
const PREVIEW_DEVICE_PIXEL_RATIO = 2;

interface PaneScreenshotInfo {
  cwd: string;
  height: number;
  left: number;
  paneId: string;
  top: number;
  width: number;
}

export function buildScreenshotFilePath(
  dir: string,
  now: Date,
  names?: { paneName: string; sessionName: string; windowName: string },
): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (names) {
    const s = sanitizeFilenamePart(names.sessionName) || "session";
    const w = sanitizeFilenamePart(names.windowName) || "window";
    const p = sanitizeFilenamePart(names.paneName) || "pane";
    return `${dir}/${s}-${w}-${p}-${timestamp}.png`;
  }
  return `${dir}/${timestamp}.png`;
}

export function computePreviewImageDims(cols: number, lines: number): ImageDims {
  const charWidth = PREVIEW_FONT_SIZE * PREVIEW_CHAR_WIDTH_FACTOR;
  const lineHeightPx = Math.round(PREVIEW_FONT_SIZE * PREVIEW_LINE_HEIGHT);
  const cssWidth = Math.ceil(cols * charWidth);
  const cssHeight = lines * lineHeightPx;
  return {
    height: Math.round(cssHeight * PREVIEW_DEVICE_PIXEL_RATIO),
    width: Math.round(cssWidth * PREVIEW_DEVICE_PIXEL_RATIO),
  };
}

/** Mirror of trimTrailingEmptyLines in ghostty-opentui/src/image.ts. */
export function countRenderedLines(lines: TerminalLine[]): number {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!;
    const isEmpty =
      line.spans.length === 0 ||
      line.spans.every(
        (span) => span.text.trim() === "" && span.bg === null && (span.flags & StyleFlags.INVERSE) === 0,
      );
    if (!isEmpty) break;
    end--;
  }
  return end;
}

export function resolveScreenshotOutputDir(configScreenshotDir: string, fallbackDir: string, homeDir?: string): string {
  if (!configScreenshotDir) return fallbackDir;
  return configScreenshotDir.replace(/^~(?=\/|$)/, homeDir || "~");
}

/** Sanitize a name for use in a filename: collapse runs of non-alphanumeric
 *  characters to a single hyphen, strip leading/trailing hyphens. */
export function sanitizeFilenamePart(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function useScreenshotWorkflow({
  configScreenshotDir,
  configScreenshotFlash,
  refs,
}: UseScreenshotWorkflowOptions): ScreenshotWorkflowApi {
  const { addInfoRef, clientRef, dimsRef, handleRedrawRef, sidebarOpenRef, sidebarWidthRef, terminalRef } = refs;
  const [screenshotDialogOpen, setScreenshotDialogOpen] = useState(false);
  const [screenshotButtonCol, setScreenshotButtonCol] = useState(0);
  const [screenshotDonePath, setScreenshotDonePath] = useState<null | string>(null);
  const [screenshotDoneButtonCol, setScreenshotDoneButtonCol] = useState(1);
  const [screenshotError, setScreenshotError] = useState<null | string>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotPreview | null>(null);
  const [screenshotLargeDialogOpen, setScreenshotLargeDialogOpen] = useState(false);
  const previewVersionRef = useRef(0);
  // Set to true once the 1s "large image" timer has fired for the current
  // capture. Once true, completion delivers a hint instead of the done dialog
  // — even if the user has dismissed the notice in the meantime.
  const largeNotifyRef = useRef(false);
  const largeDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openScreenshotDialog = useCallback(() => {
    setScreenshotDialogOpen(true);
    setScreenshotButtonCol(0);
    setScreenshotPreview(null);
    const version = ++previewVersionRef.current;

    void (async () => {
      try {
        const client = clientRef.current;
        if (!client) return;
        const info = (await client.getActivePaneScreenshotInfo()) as PaneScreenshotInfo;
        if (previewVersionRef.current !== version) return;

        const dir = resolveScreenshotOutputDir(configScreenshotDir, info.cwd, process.env.HOME);
        const viewportDims = computePreviewImageDims(info.width, info.height);
        setScreenshotPreview({ dir, scrollbackDims: "loading", viewportDims });

        const output = await client.runCommandArgs([
          "capture-pane",
          "-p",
          "-e",
          "-S",
          `-${MAX_SCROLLBACK_LINES}`,
          "-t",
          info.paneId,
        ]);
        if (previewVersionRef.current !== version) return;
        const { ptyToJson } = await import("ghostty-opentui");
        const data = ptyToJson(output, { cols: info.width, rows: info.height });
        const lineCount = countRenderedLines(data.lines);
        const scrollbackDims = computePreviewImageDims(info.width, Math.max(1, lineCount));
        // Viewport shares the pane's bottom edge with scrollback, so its
        // rendered (trimmed) line count cannot exceed the scrollback's. For
        // a mostly-empty pane this clamps the predicted viewport height to
        // match what renderTerminalToImage will actually produce.
        const viewportLines = Math.max(1, Math.min(info.height, lineCount));
        const viewportDimsClamped = computePreviewImageDims(info.width, viewportLines);
        setScreenshotPreview((prev) => (prev ? { ...prev, scrollbackDims, viewportDims: viewportDimsClamped } : prev));
      } catch {
        if (previewVersionRef.current !== version) return;
        setScreenshotPreview((prev) => (prev ? { ...prev, scrollbackDims: "error" } : prev));
      }
    })();
  }, [clientRef, configScreenshotDir]);

  const dismissScreenshotDone = useCallback(() => {
    setScreenshotDonePath(null);
  }, []);

  const dismissScreenshotError = useCallback(() => {
    setScreenshotError(null);
  }, []);

  const dismissScreenshotLargeDialog = useCallback(() => {
    setScreenshotLargeDialogOpen(false);
  }, []);

  const handleScreenshotCapture = useCallback(
    async (mode: ScreenshotMode) => {
      setScreenshotDialogOpen(false);
      largeNotifyRef.current = false;
      setScreenshotLargeDialogOpen(false);
      if (largeDialogTimerRef.current !== null) {
        clearTimeout(largeDialogTimerRef.current);
        largeDialogTimerRef.current = null;
      }
      largeDialogTimerRef.current = setTimeout(() => {
        largeNotifyRef.current = true;
        setScreenshotLargeDialogOpen(true);
        largeDialogTimerRef.current = null;
      }, LARGE_IMAGE_DIALOG_DELAY_MS);

      const clearLargeDialogTimer = () => {
        if (largeDialogTimerRef.current !== null) {
          clearTimeout(largeDialogTimerRef.current);
          largeDialogTimerRef.current = null;
        }
      };

      try {
        const client = clientRef.current;
        const terminal = terminalRef.current;
        if (!client || !terminal) throw new Error("Not connected");

        const info = (await client.getActivePaneScreenshotInfo()) as PaneScreenshotInfo;

        // Query session/window/pane metadata for the filename and log entry.
        const logInfoPromise = client.getPaneContext(info.paneId).catch(() => null);

        // Fire the flash in parallel with the capture/render work so the user
        // gets immediate visual feedback regardless of render duration. The
        // flash writes directly to the terminal output path, bypassing
        // OpenTUI's diff — schedule a full redraw as soon as it finishes so
        // residue is cleared even when render/write is still running (e.g.
        // the large-image notice dialog is already showing behind it).
        let flashPromise: Promise<void> | null = null;
        if (configScreenshotFlash) {
          const dims = dimsRef.current;
          const sidebarOffset = sidebarOpenRef.current ? sidebarWidthRef.current + 1 : 0;
          const { colOffset, rowOffset } = computeHoneybeamOffsets(dims, sidebarOffset);
          flashPromise = runScreenshotFlash(info.left, info.top, info.width, info.height, colOffset, rowOffset);
          void flashPromise.then(() => handleRedrawRef.current()).catch(() => {});
        }

        // In the compiled binary, point takumi's NAPI loader at the .node
        // asset that bun --compile embedded via takumi-native-path.ts. In dev
        // mode the shim resolves to undefined and takumi's normal dispatch
        // finds the binding in node_modules.
        if (takumiNativePath) process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] ??= takumiNativePath;
        const { renderTerminalToImage } = await import("ghostty-opentui/image");
        let data: import("ghostty-opentui").TerminalData;

        if (mode === "viewport") {
          data = getViewportScreenshotData(terminal, info);
        } else {
          const output = await client.runCommandArgs([
            "capture-pane",
            "-p",
            "-e",
            "-S",
            `-${MAX_SCROLLBACK_LINES}`,
            "-t",
            info.paneId,
          ]);
          const { ptyToJson } = await import("ghostty-opentui");
          data = ptyToJson(output, { cols: info.width, rows: info.height });
        }

        const png = await renderTerminalToImage(data, {
          devicePixelRatio: 2,
          format: "png",
          theme: { background: theme.bg, text: theme.text },
        });
        const dir = resolveScreenshotOutputDir(configScreenshotDir, info.cwd, process.env.HOME);
        const logInfo = await logInfoPromise;
        const filePath = buildScreenshotFilePath(
          dir,
          new Date(),
          logInfo
            ? { paneName: logInfo.paneName, sessionName: logInfo.sessionName, windowName: logInfo.windowName }
            : undefined,
        );

        mkdirSync(dir, { recursive: true });
        await Bun.write(filePath, png);

        // Log the screenshot event.
        const lineCount = countRenderedLines(data.lines);
        const pixelDims = computePreviewImageDims(info.width, lineCount);
        if (logInfo) {
          log(
            "screenshot",
            `mode=${mode} session=${logInfo.sessionName} (${logInfo.sessionId}) window=${logInfo.windowName} (${logInfo.windowId}) pane=${logInfo.paneName} (${logInfo.paneId}) lines=${lineCount} pixels=${pixelDims.width}x${pixelDims.height} file=${filePath}`,
          );
        } else {
          log(
            "screenshot",
            `mode=${mode} pane=${info.paneId} lines=${lineCount} pixels=${pixelDims.width}x${pixelDims.height} file=${filePath}`,
          );
        }

        // Wait for the flash's direct output frames to stop before we draw the
        // next dialog, so its frames don't overwrite the dialog. The redraw
        // itself was already fired by the .then handler above.
        if (flashPromise) await flashPromise;

        clearLargeDialogTimer();

        if (largeNotifyRef.current) {
          setScreenshotLargeDialogOpen(false);
          addInfoRef.current?.(`screenshot-${Date.now()}`, ["Screenshot Saved", "", filePath]);
        } else {
          setScreenshotDonePath(filePath);
          setScreenshotDoneButtonCol(1);
        }
      } catch (error) {
        clearLargeDialogTimer();
        setScreenshotLargeDialogOpen(false);
        setScreenshotError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      addInfoRef,
      clientRef,
      configScreenshotDir,
      configScreenshotFlash,
      dimsRef,
      handleRedrawRef,
      sidebarOpenRef,
      sidebarWidthRef,
      terminalRef,
    ],
  );

  return {
    dismissScreenshotDone,
    dismissScreenshotError,
    dismissScreenshotLargeDialog,
    handleScreenshotCapture,
    openScreenshotDialog,
    screenshotButtonCol,
    screenshotDialogOpen,
    screenshotDoneButtonCol,
    screenshotDonePath,
    screenshotError,
    screenshotLargeDialogOpen,
    screenshotPreview,
    setScreenshotButtonCol,
    setScreenshotDialogOpen,
    setScreenshotDoneButtonCol,
    setScreenshotDonePath,
  };
}

function getViewportScreenshotData(
  terminal: GhosttyTerminalRenderable,
  info: PaneScreenshotInfo,
): import("ghostty-opentui").TerminalData {
  const internal = terminal as unknown as {
    _persistentTerminal?: { getJson: () => unknown };
  };
  const persistentTerminal = internal._persistentTerminal;
  if (!persistentTerminal) throw new Error("No persistent terminal");
  const fullData = persistentTerminal.getJson() as import("ghostty-opentui").TerminalData;
  return cropTerminalData(fullData, info.left, info.top, info.width, info.height);
}
