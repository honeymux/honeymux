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
  onInteractiveScrollSequence?: (sequence: string) => void;
  onMouseScroll?: (event: MouseEvent) => void;
  realBg: string;
  sideBar: string;
  sineWaveLastOutputTickAt?: null | number;
  /** Number of content rows the agentTerminalNode should occupy. */
  terminalContentRows?: number;
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
  onInteractiveScrollSequence,
  onMouseScroll,
  realBg,
  sideBar,
  sineWaveLastOutputTickAt,
  terminalContentRows = 0,
  totalHeight,
  truncatedInfo,
  wrappedLines,
  zIndex,
}: MuxotronExpandedViewProps) {
  const showInteractiveTerminal = agentTerminalNode != null && terminalContentRows > 0;
  const interactiveFrame = {
    height: terminalContentRows,
    left: expandedIl + bx + 1,
    top: 3,
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
      onMouseScroll={onMouseScroll}
      position="absolute"
      selectable={false}
      top={0}
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
        top={0}
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
          top={0}
        />
      ))}
      <text
        bg={realBg}
        content={sideBarAt(1)}
        fg={borderColor}
        left={bx}
        position="absolute"
        selectable={false}
        top={1}
      />
      <MuxotronMascotOverlay
        honeymuxState={honeymuxState}
        left={bx + 1 + hmPad}
        sineWaveLastOutputTickAt={sineWaveLastOutputTickAt}
        top={1}
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
          top={1}
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
          top={1}
        />
      )}
      <text
        bg={realBg}
        content={sideBarAt(1)}
        fg={borderColor}
        left={bx + expandedInner + 1}
        position="absolute"
        selectable={false}
        top={1}
      />
      {(wrappedLines.length > 0 || showInteractiveTerminal) && (
        <text
          bg={realBg}
          content={"\u251C" + "\u2500".repeat(expandedInner) + "\u2524"}
          fg={borderColor}
          left={bx}
          position="absolute"
          selectable={false}
          top={2}
        />
      )}
      {showInteractiveTerminal && (
        <>
          {Array.from({ length: terminalContentRows }, (_, row) => (
            <box key={`agent-row-${row}`}>
              <text
                bg={realBg}
                content={sideBarAt(3 + row)}
                fg={borderColor}
                left={bx}
                position="absolute"
                selectable={false}
                top={3 + row}
              />
              <text
                bg={realBg}
                content={sideBarAt(3 + row)}
                fg={borderColor}
                left={bx + expandedInner + 1}
                position="absolute"
                selectable={false}
                top={3 + row}
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
            top={3}
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
              content={sideBarAt(3 + row)}
              fg={borderColor}
              left={bx}
              position="absolute"
              selectable={false}
              top={3 + row}
            />
            <text
              attributes={TextAttributes.BOLD}
              bg={realBg}
              content={line}
              fg="#ffffff"
              left={bx + 2}
              position="absolute"
              selectable={false}
              top={3 + row}
            />
            <text
              bg={realBg}
              content={sideBarAt(3 + row)}
              fg={borderColor}
              left={bx + expandedInner + 1}
              position="absolute"
              selectable={false}
              top={3 + row}
            />
          </box>
        ))}
      {bottomNode}
    </box>
  );
}
