import { TextAttributes } from "@opentui/core";

import { version } from "../../package.json";
import { theme } from "../themes/theme.ts";
import { HoneycombBackground } from "./honeycomb-background.tsx";

interface TooNarrowOverlayProps {
  height: number;
  reason?: "narrow" | "short";
  width: number;
}

export function TooNarrowOverlay({ height, reason = "narrow", width }: TooNarrowOverlayProps) {
  // Message box
  const title = reason === "short" ? "Window too short" : "Window too narrow";
  const subtitle = reason === "short" ? "Please resize to 24 rows or more" : "Please widen to 80 columns or more";
  const hint = "or press any key to detach";
  const versionLine = `honeymux v${version}`;
  const longestLine = Math.max(title.length, subtitle.length, hint.length);
  const padH = 4;
  const padV = 1;
  const boxInnerW = longestLine + padH * 2;
  const boxW = boxInnerW + 2;
  const boxH = 8 + padV * 2 + 2; // 8 text lines (bear + blank + title + blank + subtitle + hint + blank + version) + padding + borders
  const boxLeft = Math.floor((width - boxW) / 2);
  const boxTop = Math.floor((height - boxH) / 2);

  return (
    <box
      backgroundColor="#000000"
      height={height}
      id="honeyshots:too-narrow-overlay"
      left={0}
      position="absolute"
      top={0}
      width={width}
      zIndex={25}
    >
      <HoneycombBackground height={height} width={width} />
      {/* Center message box */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.statusWarning}
        borderStyle="rounded"
        flexDirection="column"
        height={boxH}
        justifyContent="center"
        left={boxLeft}
        position="absolute"
        top={boxTop}
        width={boxW}
      >
        <text content="ʕxᴥxʔ" fg={theme.statusWarning} />
        <text content="" />
        <text attributes={TextAttributes.BOLD} content={title} fg={theme.statusError} />
        <text content="" />
        <text content={subtitle} fg={theme.textSecondary} />
        <text content={hint} fg={theme.textDim} />
        <text content="" />
        <text content={versionLine} fg={theme.textDim} />
      </box>
    </box>
  );
}
