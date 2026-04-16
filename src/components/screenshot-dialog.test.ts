import { describe, expect, mock, test } from "bun:test";

import { DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT } from "../app/hooks/use-screenshot-workflow.ts";
import {
  buildScreenshotSizeLine,
  handleScreenshotDialogInput,
  shouldShowScreenshotDirLine,
} from "./screenshot-dialog.tsx";

describe("handleScreenshotDialogInput", () => {
  const setup = (scrollbackDisabled: boolean) => {
    const onViewport = mock(() => {});
    const onScrollback = mock(() => {});
    const onCancel = mock(() => {});
    const dispatch = (data: string, buttonCol: number) =>
      handleScreenshotDialogInput(data, buttonCol, onViewport, onScrollback, onCancel, scrollbackDisabled);
    return { dispatch, onCancel, onScrollback, onViewport };
  };

  test("cycles focus through all three buttons when scrollback is enabled", () => {
    const { dispatch } = setup(false);
    expect(dispatch("\t", 0)).toBe(1);
    expect(dispatch("\t", 1)).toBe(2);
    expect(dispatch("\t", 2)).toBe(0);
    expect(dispatch("\x1b[Z", 0)).toBe(2);
    expect(dispatch("\x1b[Z", 2)).toBe(1);
    expect(dispatch("\x1b[Z", 1)).toBe(0);
  });

  test("still allows focus to land on scrollback when disabled", () => {
    const { dispatch } = setup(true);
    // Tab / right arrow: normal 0 → 1 → 2 → 0 cycle even when disabled,
    // so the user can focus scrollback and see the explanatory size line.
    expect(dispatch("\t", 0)).toBe(1);
    expect(dispatch("\x1b[C", 1)).toBe(2);
    expect(dispatch("\x1b[C", 2)).toBe(0);
    // Shift+Tab / left arrow: mirrored.
    expect(dispatch("\x1b[Z", 0)).toBe(2);
    expect(dispatch("\x1b[D", 2)).toBe(1);
    expect(dispatch("\x1b[D", 1)).toBe(0);
  });

  test("Enter on disabled scrollback button is a no-op", () => {
    const { dispatch, onCancel, onScrollback, onViewport } = setup(true);
    expect(dispatch("\r", 1)).toBe("handled");
    expect(onScrollback).not.toHaveBeenCalled();
    expect(onViewport).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("Enter on enabled scrollback button invokes scrollback handler", () => {
    const { dispatch, onScrollback } = setup(false);
    expect(dispatch("\r", 1)).toBe("handled");
    expect(onScrollback).toHaveBeenCalledTimes(1);
  });
});

describe("buildScreenshotSizeLine", () => {
  test("shows too-long message for oversized scrollback focus", () => {
    const line = buildScreenshotSizeLine(
      {
        dir: "/tmp",
        scrollbackDims: { height: DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT + 100, width: 4000 },
        viewportDims: { height: 2520, width: 4032 },
      },
      1,
    );
    expect(line).toBe(
      `Scrollback too long for capture (${DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT + 100} > ${DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT})`,
    );
  });

  test("hides the dir line for disabled scrollback focus only", () => {
    const preview = {
      dir: "/tmp",
      scrollbackDims: { height: DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT + 100, width: 4000 },
      viewportDims: { height: 2520, width: 4032 },
    } as const;
    expect(shouldShowScreenshotDirLine(preview, 0)).toBe(true); // viewport
    expect(shouldShowScreenshotDirLine(preview, 1)).toBe(false); // disabled scrollback
    expect(shouldShowScreenshotDirLine(preview, 2)).toBe(true); // cancel
    expect(
      shouldShowScreenshotDirLine(
        {
          dir: "/tmp",
          scrollbackDims: { height: 1000, width: 4000 },
          viewportDims: { height: 2520, width: 4032 },
        },
        1,
      ),
    ).toBe(true); // enabled scrollback
    expect(shouldShowScreenshotDirLine(null, 0)).toBe(false);
  });

  test("shows normal dimensions for viewport focus regardless of scrollback size", () => {
    const line = buildScreenshotSizeLine(
      {
        dir: "/tmp",
        scrollbackDims: { height: DEFAULT_MAX_SCREENSHOT_PIXEL_HEIGHT + 100, width: 4000 },
        viewportDims: { height: 2520, width: 4032 },
      },
      0,
    );
    expect(line).toBe("An image with dimensions 4032 × 2520 will be written to");
  });
});
