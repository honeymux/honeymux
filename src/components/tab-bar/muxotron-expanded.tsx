import type { ReactNode } from "react";

import { type MouseEvent, TextAttributes } from "@opentui/core";

import type { HoneymuxState } from "../../agents/types.ts";
import type { MuxotronBorderOverlay } from "./muxotron-model.ts";

import { theme } from "../../themes/theme.ts";
import { buildInteractiveScrollSequence } from "./muxotron-interactive-mouse.ts";
import { MuxotronMascotOverlay } from "./muxotron-mascot-overlay.tsx";

interface MuxotronExpandedViewProps {
  /** When set, render this node in the content area instead of wrappedLines. */
  agentTerminalNode?: ReactNode;
  borderColor: string;
  bottomNode: ReactNode;
  bx: number;
  centeredLeft: number;
  counterDisplay: string;
  counterStr: string;
  expandedIl: number;
  expandedInner: number;
  expandedTopLineStr: string;
  expandedTopOverlays: MuxotronBorderOverlay[];
  expandedWidth: number;
  hasAnyAgent: boolean;
  hasUnansweredElsewhere: boolean;
  hmPad: number;
  honeymuxState: HoneymuxState;
  isDashed: boolean;
  labelColor: string;
  /** When true (marquee-bottom), flip the interior vertically: session/label
   *  header sits on the bottom border, button strip on the top border, and
   *  the mascot/divider/content-zoom rows are mirrored top↔bottom. */
  labelOnBottom?: boolean;
  onInteractiveScrollSequence?: (sequence: string) => void;
  onMouseDown?: (event: MouseEvent) => void;
  onMouseScroll?: (event: MouseEvent) => void;
  realBg: string;
  sideBar: string;
  sineWaveLastOutputTickAt?: null | number;
  /** Number of content rows the agentTerminalNode should occupy. */
  terminalContentRows?: number;
  /** Row offset from the parent's top. Defaults to 0 (anchor at top). For
   *  marquee-bottom, the parent passes termHeight - totalHeight so the box
   *  anchors from the bottom of the screen. */
  top?: number;
  totalHeight: number;
  truncatedInfo: string;
  wrappedLines: string[];
  zIndex: number;
}

export function MuxotronExpandedView({
  agentTerminalNode,
  borderColor,
  bottomNode,
  bx,
  centeredLeft,
  counterDisplay,
  counterStr,
  expandedIl,
  expandedInner,
  expandedTopLineStr,
  expandedTopOverlays,
  expandedWidth,
  hasAnyAgent,
  hasUnansweredElsewhere,
  hmPad,
  honeymuxState,
  isDashed,
  labelColor,
  labelOnBottom = false,
  onInteractiveScrollSequence,
  onMouseDown,
  onMouseScroll,
  realBg,
  sideBar,
  sineWaveLastOutputTickAt,
  terminalContentRows = 0,
  top = 0,
  totalHeight,
  truncatedInfo,
  wrappedLines,
  zIndex,
}: MuxotronExpandedViewProps) {
  const showInteractiveTerminal = agentTerminalNode != null && terminalContentRows > 0;
  // Row layout. In normal (label-on-top) orientation:
  //   row 0             = header (session name + unanswered/total)
  //   row 1             = mascot + tool info + counter
  //   row 2             = divider (only when zoom/terminal rows exist)
  //   rows 3..3+N-1     = zoom / interactive terminal content
  //   row totalHeight-1 = button strip (baked into bottomNode by the parent)
  // In label-on-bottom orientation (marquee-bottom) the interior mirrors,
  // so the button strip lands on row 0 and the header on row totalHeight-1.
  const headerRow = labelOnBottom ? totalHeight - 1 : 0;
  const mascotRow = labelOnBottom ? totalHeight - 2 : 1;
  const dividerRow = labelOnBottom ? totalHeight - 3 : 2;
  const contentTop = labelOnBottom ? 1 : 3;
  const interactiveFrame = {
    height: terminalContentRows,
    left: expandedIl + bx + 1,
    top: contentTop,
    width: expandedInner,
  };
  // When dashed, replace the vertical side char on every 4th absolute row
  // with an opaque space — mirrors the horizontal 3-on/1-off gap pattern.
  const sideBarAt = (absRow: number) => (isDashed && absRow > 0 && absRow % 4 === 0 ? " " : sideBar);
  return (
    <box
      height={totalHeight}
      id="honeyshots:muxotron-expanded"
      left={expandedIl}
      onMouseDown={onMouseDown}
      onMouseScroll={onMouseScroll}
      position="absolute"
      selectable={false}
      top={top}
      width={expandedWidth}
      zIndex={zIndex}
    >
      <box backgroundColor={realBg} height={totalHeight} left={0} position="absolute" top={0} width={expandedWidth} />
      <text
        bg={realBg}
        content={expandedTopLineStr}
        fg={borderColor}
        left={bx}
        position="absolute"
        selectable={false}
        top={headerRow}
      />
      {expandedTopOverlays.map((overlay, idx) => (
        <text
          bg={realBg}
          content={overlay.content}
          fg={labelColor}
          key={`etop-ov-${idx}`}
          left={bx + overlay.left}
          position="absolute"
          selectable={false}
          top={headerRow}
        />
      ))}
      <text
        bg={realBg}
        content={sideBarAt(mascotRow)}
        fg={borderColor}
        left={bx}
        position="absolute"
        selectable={false}
        top={mascotRow}
      />
      <MuxotronMascotOverlay
        honeymuxState={honeymuxState}
        left={bx + 1 + hmPad}
        sineWaveLastOutputTickAt={sineWaveLastOutputTickAt}
        top={mascotRow}
      />
      {truncatedInfo && (
        <text
          attributes={TextAttributes.BOLD}
          bg={realBg}
          content={truncatedInfo}
          fg="#ffffff"
          left={bx + centeredLeft}
          position="absolute"
          selectable={false}
          top={mascotRow}
        />
      )}
      {hasAnyAgent && (
        <text
          bg={realBg}
          content={counterDisplay}
          fg={hasUnansweredElsewhere ? theme.statusWarning : theme.textSecondary}
          left={bx + expandedInner - counterStr.length}
          position="absolute"
          selectable={false}
          top={mascotRow}
        />
      )}
      <text
        bg={realBg}
        content={sideBarAt(mascotRow)}
        fg={borderColor}
        left={bx + expandedInner + 1}
        position="absolute"
        selectable={false}
        top={mascotRow}
      />
      {(wrappedLines.length > 0 || showInteractiveTerminal) && (
        <text
          bg={realBg}
          content={"\u251C" + "\u2500".repeat(expandedInner) + "\u2524"}
          fg={borderColor}
          left={bx}
          position="absolute"
          selectable={false}
          top={dividerRow}
        />
      )}
      {showInteractiveTerminal && (
        <>
          {Array.from({ length: terminalContentRows }, (_, row) => (
            <box key={`agent-row-${row}`}>
              <text
                bg={realBg}
                content={sideBarAt(contentTop + row)}
                fg={borderColor}
                left={bx}
                position="absolute"
                selectable={false}
                top={contentTop + row}
              />
              <text
                bg={realBg}
                content={sideBarAt(contentTop + row)}
                fg={borderColor}
                left={bx + expandedInner + 1}
                position="absolute"
                selectable={false}
                top={contentTop + row}
              />
            </box>
          ))}
          <box
            height={terminalContentRows}
            left={bx + 1}
            onMouse={
              onInteractiveScrollSequence
                ? (event: MouseEvent) => {
                    const sequence = buildInteractiveScrollSequence(event, interactiveFrame);
                    if (!sequence) return;
                    event.stopPropagation();
                    onInteractiveScrollSequence(sequence);
                  }
                : undefined
            }
            position="absolute"
            top={contentTop}
            width={expandedInner}
          >
            {agentTerminalNode}
          </box>
        </>
      )}
      {!showInteractiveTerminal &&
        wrappedLines.map((line, row) => (
          <box key={`wrap-${row}`}>
            <text
              bg={realBg}
              content={sideBarAt(contentTop + row)}
              fg={borderColor}
              left={bx}
              position="absolute"
              selectable={false}
              top={contentTop + row}
            />
            <text
              attributes={TextAttributes.BOLD}
              bg={realBg}
              content={line}
              fg="#ffffff"
              left={bx + 2}
              position="absolute"
              selectable={false}
              top={contentTop + row}
            />
            <text
              bg={realBg}
              content={sideBarAt(contentTop + row)}
              fg={borderColor}
              left={bx + expandedInner + 1}
              position="absolute"
              selectable={false}
              top={contentTop + row}
            />
          </box>
        ))}
      {bottomNode}
    </box>
  );
}
