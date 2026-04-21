import type { ReactNode } from "react";

import { type MouseEvent, TextAttributes } from "@opentui/core";

import type { HoneymuxState } from "../../agents/types.ts";

import { rgbToHex, terminalBgRgb, theme } from "../../themes/theme.ts";
import { stringWidth, truncateToWidth } from "../../util/text.ts";
import { MuxotronMascotOverlay } from "./muxotron-mascot-overlay.tsx";
import { type MuxotronBorderOverlay, toSuperscript } from "./muxotron-model.ts";
import { MuxotronSineWaveOverlay } from "./muxotron-sine-wave-overlay.tsx";

interface MuxotronCollapsedViewProps {
  agentsDialogOpen?: boolean;
  borderColor: string;
  bottomNode: ReactNode;
  counterDisplay: string;
  hasAnyAgent: boolean;
  hasUnansweredElsewhere: boolean;
  hmPad: number;
  hmW: number;
  honeymuxState: HoneymuxState;
  il: number;
  infoCount?: number;
  inner: number;
  isDashed: boolean;
  isMarquee: boolean;
  labelColor: string;
  marqueeToolInfo: string;
  onNotificationsClick?: () => void;
  realBg: string;
  showNoAgents: boolean;
  sineWaveHasConnectedAgent: boolean;
  sineWaveLastOutputTickAt: null | number;
  topLineStr: string;
  topTextOverlays: MuxotronBorderOverlay[];
  vBar: string;
  warningCount?: number;
}

export function MuxotronCollapsedView({
  agentsDialogOpen,
  borderColor,
  bottomNode,
  counterDisplay,
  hasAnyAgent,
  hasUnansweredElsewhere,
  hmPad,
  hmW,
  honeymuxState,
  il,
  infoCount,
  inner,
  isDashed,
  isMarquee,
  labelColor,
  marqueeToolInfo,
  onNotificationsClick,
  realBg,
  showNoAgents,
  sineWaveHasConnectedAgent,
  sineWaveLastOutputTickAt,
  topLineStr,
  topTextOverlays,
  vBar,
  warningCount,
}: MuxotronCollapsedViewProps) {
  const hasWarning = !!warningCount && warningCount > 0;
  const hasInfo = !!infoCount && infoCount > 0;
  const showBadge = hasWarning || hasInfo;
  const rightContent = hasAnyAgent ? counterDisplay : showNoAgents ? "no agents" : "";
  const renderCenteredMiddleDisplay = (content: string, fg: string) => {
    const availStart = il + 1 + hmPad + hmW + 1;
    const availEnd = il + 1 + inner - stringWidth(rightContent);
    const availWidth = availEnd - availStart;
    if (availWidth <= 0) return null;

    const truncated = truncateToWidth(content, availWidth);
    const truncatedWidth = stringWidth(truncated);
    if (truncatedWidth <= 0) return null;

    const centeredLeft = availStart + Math.floor((availWidth - truncatedWidth) / 2);
    return <text content={truncated} fg={fg} left={centeredLeft} position="absolute" selectable={false} top={1} />;
  };
  const getSlottedMiddleDisplayMetrics = () => {
    const rightSlotWidth = stringWidth(counterDisplay);
    // Mascot and badge occupy the same fixed-width slot so the sine wave's
    // left anchor stays stable across state changes.
    const left = il + 1 + hmPad + hmW + 1;
    const availEnd = il + inner - rightSlotWidth - 1;
    const availWidth = availEnd - left;
    if (availWidth <= 0) return null;

    return { availWidth, left };
  };

  return (
    <>
      <box
        height={3}
        id="honeyshots:muxotron"
        left={il}
        position="absolute"
        selectable={false}
        top={0}
        width={inner + 2}
      />
      <text
        bg={isDashed ? realBg : undefined}
        content={topLineStr}
        fg={borderColor}
        left={il}
        position="absolute"
        selectable={false}
        top={0}
      />
      {topTextOverlays.map((overlay, idx) => (
        <text
          bg={isDashed ? realBg : undefined}
          content={overlay.content}
          fg={labelColor}
          key={`top-ov-${idx}`}
          left={overlay.left}
          position="absolute"
          selectable={false}
          top={0}
        />
      ))}
      <text
        bg={isDashed ? realBg : undefined}
        content={vBar}
        fg={borderColor}
        left={il}
        position="absolute"
        selectable={false}
        top={1}
      />
      <text
        bg={isDashed ? realBg : undefined}
        content={vBar}
        fg={borderColor}
        left={il + inner + 1}
        position="absolute"
        selectable={false}
        top={1}
      />
      {(() => {
        if (!showBadge) {
          return (
            <MuxotronMascotOverlay
              honeymuxState={honeymuxState}
              left={il + 1 + hmPad}
              sineWaveLastOutputTickAt={sineWaveLastOutputTickAt}
              top={1}
            />
          );
        }
        const bothActive = hasWarning && hasInfo;
        const showWarningIcon = bothActive ? Math.floor(Date.now() / 5000) % 2 === 0 : hasWarning;
        const displayCount = (warningCount ?? 0) + (infoCount ?? 0);
        const icon = showWarningIcon ? `\u26a0\ufe0f` : `\u2139\ufe0f`;
        const badgeColor = showWarningIcon ? theme.statusWarning : theme.statusInfo;
        const countStr = displayCount >= 10 ? "⁹⁺" : toSuperscript(displayCount);
        const badgeLeft = il + 1 + hmPad;
        const badgeWidth = hmW;
        return (
          <>
            <box
              backgroundColor={rgbToHex(terminalBgRgb)}
              height={1}
              left={badgeLeft}
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0) onNotificationsClick?.();
              }}
              position="absolute"
              top={1}
              width={badgeWidth}
            />
            <text content={icon} fg={badgeColor} left={badgeLeft + 1} position="absolute" selectable={false} top={1} />
            <text
              attributes={TextAttributes.BOLD}
              content={countStr}
              fg="white"
              left={badgeLeft + 4}
              position="absolute"
              selectable={false}
              top={1}
            />
          </>
        );
      })()}
      {isMarquee &&
        !sineWaveHasConnectedAgent &&
        !agentsDialogOpen &&
        hasUnansweredElsewhere &&
        marqueeToolInfo &&
        renderCenteredMiddleDisplay(marqueeToolInfo, theme.statusWarning)}
      {(() => {
        if (!sineWaveHasConnectedAgent) return null;
        const metrics = getSlottedMiddleDisplayMetrics();
        if (metrics == null) return null;

        return (
          <MuxotronSineWaveOverlay
            hasConnectedAgent={sineWaveHasConnectedAgent}
            lastOutputTickAt={sineWaveLastOutputTickAt}
            left={metrics.left}
            maxWidth={metrics.availWidth}
            top={1}
          />
        );
      })()}
      {hasAnyAgent && (
        <text
          content={counterDisplay}
          fg={hasUnansweredElsewhere ? theme.statusWarning : theme.textSecondary}
          left={il + inner - stringWidth(counterDisplay)}
          position="absolute"
          selectable={false}
          top={1}
        />
      )}
      {showNoAgents && (
        <text
          content="no agents"
          fg={theme.textDim}
          left={il + inner - stringWidth("no agents")}
          position="absolute"
          selectable={false}
          top={1}
        />
      )}
      {bottomNode}
    </>
  );
}
