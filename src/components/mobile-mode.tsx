import type { MouseEvent } from "@opentui/core";
import type { ReactNode } from "react";

import { useMemo } from "react";

import { hexToRgb, lerpRgb, rgbToHex, theme } from "../themes/theme.ts";
import { centerToWidth, stringWidth } from "../util/text.ts";

interface MobileModeProps {
  height: number;
  onExitMobileMode: () => void;
  width: number;
}

export function MobileMode({ height, onExitMobileMode, width }: MobileModeProps) {
  return <MobileMainMenu height={height} onExitMobileMode={onExitMobileMode} width={width} />;
}

/**
 * Rectangular button with thin rounded border and horizontal partial-fill
 * gradients (▏▎▍▌▋▊▉) fading inward on the left/right edges.
 * The center ~40% is kept clear for the label.
 */
function MobileButton({
  borderColor,
  disabled,
  height,
  label,
  onPress,
  width,
}: {
  borderColor: string;
  disabled?: boolean;
  height?: number;
  label: string;
  onPress?: () => void;
  width: number;
}) {
  const h = Math.max(3, height ?? 3);
  const inner = width - 2; // columns inside the left/right border chars

  const handler =
    onPress && !disabled
      ? (event: MouseEvent) => {
          if (event.button === 0) onPress();
        }
      : undefined;

  const fgBorder = disabled ? theme.textSecondary : borderColor;
  const fgLabel = disabled ? theme.textSecondary : theme.text;
  const fgGradOuter = theme.bg;
  const fgGradInner = theme.bgSurface;
  const bgGrad = theme.bgSurface;

  // Clear zone: center 40% of inner width, but at least wide enough for label
  const labelHalf = Math.ceil((stringWidth(label) + 2) / 2);
  const clearHalf = Math.max(labelHalf, Math.floor(inner * 0.2));
  const halfInner = inner / 2;

  // Gradient zone on each side: from border inward to the clear zone
  const gradCols = Math.max(0, Math.floor(halfInner - clearHalf));

  // Partial-fill blocks: thickest (7/8) to thinnest (1/8)
  const FILLS = ["\u2589", "\u258A", "\u258B", "\u258C", "\u258D", "\u258E", "\u258F"];

  // Pre-build left and right gradient strings
  let leftGrad = "";
  let rightGrad = "";
  for (let i = 0; i < gradCols; i++) {
    const frac = (i + 0.5) / gradCols; // 0 at outer → 1 at inner
    const idx = Math.min(Math.round(frac * (FILLS.length - 1)), FILLS.length - 1);
    leftGrad += FILLS[idx];
    rightGrad += FILLS[idx];
  }

  const centerW = inner - gradCols * 2;
  const interiorCount = h - 2;
  const labelRow = Math.floor(interiorCount / 2);

  // Top and bottom borders
  const top = "\u256D" + "\u2500".repeat(inner) + "\u256E";
  const bot = "\u2570" + "\u2500".repeat(inner) + "\u256F";

  const rows: ReactNode[] = [];
  rows.push(<text bg={theme.bg} content={top} fg={fgBorder} key="t" onMouseDown={handler} />);

  for (let i = 0; i < interiorCount; i++) {
    // Centre content
    let centerContent: string;
    let centerFg: string;
    if (i === labelRow) {
      centerContent = centerToWidth(label, centerW);
      centerFg = fgLabel;
    } else {
      centerContent = " ".repeat(centerW);
      centerFg = bgGrad;
    }

    rows.push(
      <box flexDirection="row" height={1} key={`m${i}`} width={width}>
        <text bg={theme.bg} content={"\u2502"} fg={fgBorder} onMouseDown={handler} />
        {leftGrad.length > 0 && <text bg={bgGrad} content={leftGrad} fg={fgGradOuter} onMouseDown={handler} />}
        <text bg={bgGrad} content={centerContent} fg={centerFg} onMouseDown={handler} />
        {rightGrad.length > 0 && <text bg={theme.bg} content={rightGrad} fg={fgGradInner} onMouseDown={handler} />}
        <text bg={theme.bg} content={"\u2502"} fg={fgBorder} onMouseDown={handler} />
      </box>,
    );
  }

  rows.push(<text bg={theme.bg} content={bot} fg={fgBorder} key="b" onMouseDown={handler} />);

  return (
    <box flexDirection="column" height={h} width={width}>
      {rows}
    </box>
  );
}

function MobileMainMenu({
  height,
  onExitMobileMode,
  width,
}: {
  height: number;
  onExitMobileMode: () => void;
  width: number;
}) {
  // 5% padding on all sides — buttons fill ~90% of the screen
  const padX = Math.max(1, Math.floor(width * 0.05));
  const padY = Math.max(1, Math.floor(height * 0.05));
  const innerWidth = width - 2 * padX;
  const innerHeight = height - 2 * padY;

  // Distribute full inner height among 3 button slots
  // Each button must have an odd height so the label row is perfectly centered
  const BUTTON_SLOTS = 3; // Agents, New Agent, Switch to Desktop UI
  const baseButtonH = Math.floor(innerHeight / BUTTON_SLOTS);
  // Force odd: if base is even, subtract 1
  const oddBase = Math.max(3, baseButtonH % 2 === 1 ? baseButtonH : baseButtonH - 1);
  const buttonHeights = Array.from({ length: BUTTON_SLOTS }, () => oddBase);

  // Muted border colour — blended toward bg so it doesn't pop too hard
  const borderColor = useMemo(() => {
    const bg = hexToRgb(theme.bg);
    return rgbToHex(lerpRgb(bg, theme.accentRgb, 0.35));
  }, []);

  // Staggered dot grid matching honeycomb layout from HoneycombBackground
  const dotColor = useMemo(() => {
    const bg = hexToRgb(theme.bg);
    return rgbToHex(lerpRgb(bg, theme.accentRgb, 0.15));
  }, []);
  const dotRows = useMemo(() => {
    const CELL_W = 5; // horizontal spacing between dots
    const ROW_H = 2; // vertical spacing — dot every 2nd row
    const MARGIN = 2;
    const STAGGER = 2;

    const evenAvail = width - 2 * MARGIN;
    const evenCols = Math.floor((evenAvail - 1) / CELL_W) + 1;
    const oddCols = evenCols - 1;

    const lines: string[] = [];
    for (let r = 0; r < height; r++) {
      if (r % ROW_H !== 0) {
        lines.push(" ".repeat(width));
        continue;
      }
      const dotRow = r / ROW_H;
      const isOddRow = dotRow % 2 === 1;
      const cols = isOddRow ? oddCols : evenCols;
      const leftPad = isOddRow ? MARGIN + STAGGER : MARGIN;
      const rightPad = isOddRow ? MARGIN + STAGGER : MARGIN;
      const naturalW = (cols - 1) * CELL_W + 1;
      const slack = width - leftPad - naturalW - rightPad;

      // Distribute slack evenly across inter-cell gaps
      const gaps = cols - 1;
      const wideGaps = new Set<number>();
      const distributable = Math.max(0, Math.min(slack, gaps));
      if (distributable > 0) {
        for (let i = 0; i < distributable; i++) {
          wideGaps.add(Math.floor(((i + 1) * gaps) / (distributable + 1)));
        }
      }

      let line = " ".repeat(leftPad);
      for (let c = 0; c < cols; c++) {
        const isLast = c === cols - 1;
        const gapExtra = !isLast && wideGaps.has(c) ? 1 : 0;
        const pad = isLast ? 0 : CELL_W - 1 + gapExtra;
        line += "\u00B7" + " ".repeat(pad); // · center dot
      }
      lines.push(line);
    }
    return lines;
  }, [width, height]);

  return (
    <box flexDirection="column" height={height} width={width}>
      {/* Dot grid background */}
      <box flexDirection="column" height={height} left={0} position="absolute" top={0} width={width} zIndex={0}>
        {dotRows.map((line, i) => (
          <text content={line} fg={dotColor} key={i} />
        ))}
      </box>
      {/* Padded content area */}
      <box flexDirection="column" height={innerHeight} left={padX} position="absolute" top={padY} width={innerWidth}>
        {/* Agents — disabled */}
        <MobileButton
          borderColor={borderColor}
          disabled
          height={buttonHeights[0]}
          label="Agents — Coming Soon"
          width={innerWidth}
        />
        {/* New Agent — disabled */}
        <MobileButton
          borderColor={borderColor}
          disabled
          height={buttonHeights[1]}
          label="New Agent — Coming Soon"
          width={innerWidth}
        />
        {/* Switch to Desktop UI — active */}
        <MobileButton
          borderColor={borderColor}
          height={buttonHeights[2]}
          label="Switch to Desktop UI"
          onPress={onExitMobileMode}
          width={innerWidth}
        />
      </box>
    </box>
  );
}
