import type { ReactNode } from "react";

import { rgbToHex, terminalBgRgb, theme } from "../themes/theme.ts";

interface NotificationsReviewFrameProps {
  children: ReactNode;
  currentIndex: number;
  innerHeight: number;
  innerWidth: number;
  isInfo?: boolean;
  totalCount: number;
}

export function NotificationsReviewFrame({
  children,
  currentIndex,
  innerHeight,
  innerWidth,
  isInfo,
  totalCount,
}: NotificationsReviewFrameProps) {
  const borderWidth = innerWidth + 6; // border + 2 chars inner padding each side
  const borderHeight = innerHeight + 4; // border + 1 char inner padding top/bottom
  const outerWidth = borderWidth + 4; // +2 chars opaque perimeter left/right
  const outerHeight = borderHeight + 2; // +1 char opaque perimeter top/bottom
  const borderColor = isInfo ? theme.statusInfo : theme.statusWarning;
  const termBg = rgbToHex(terminalBgRgb);

  // Build top border with centered label in inverse video
  const frameLabel = "Notifications";
  const labelText = ` ${frameLabel} (${currentIndex + 1}/${totalCount}) `;
  const innerW = borderWidth - 2; // chars between corners
  // Account for regular space padding on each side of the inverse label
  const totalLabelWidth = labelText.length + 2; // +2 for regular spaces
  const labelStart = Math.floor((innerW - totalLabelWidth) / 2);
  const leftBorder = "┏" + "━".repeat(labelStart) + " ";
  const rightBorder = " " + "━".repeat(Math.max(0, innerW - labelStart - totalLabelWidth)) + "┓";
  const bottomBorder = "┗" + "━".repeat(innerW) + "┛";

  // Side borders
  const sides: ReactNode[] = [];
  for (let i = 0; i < borderHeight - 2; i++) {
    sides.push(
      <text content="┃" fg={borderColor} key={`l${i}`} left={0} position="absolute" selectable={false} top={i + 1} />,
      <text
        content="┃"
        fg={borderColor}
        key={`r${i}`}
        left={borderWidth - 1}
        position="absolute"
        selectable={false}
        top={i + 1}
      />,
    );
  }

  const perimX = 2; // horizontal perimeter padding
  const perimY = 1; // vertical perimeter padding
  const centerTop = -Math.floor(outerHeight / 2);
  const centerLeft = -Math.floor(outerWidth / 2);

  return (
    <>
      {/* Opaque outer perimeter (terminal bg) */}
      <box
        backgroundColor={termBg}
        height={outerHeight}
        left="50%"
        marginLeft={centerLeft}
        marginTop={centerTop}
        position="absolute"
        top="50%"
        width={outerWidth}
        zIndex={19}
      />
      {/* Opaque inner fill (terminal bg) */}
      <box
        backgroundColor={termBg}
        height={borderHeight - 2}
        left="50%"
        marginLeft={centerLeft + perimX + 1}
        marginTop={centerTop + perimY + 1}
        position="absolute"
        top="50%"
        width={borderWidth - 2}
        zIndex={19}
      />
      {/* Border frame */}
      <box
        height={borderHeight}
        id="honeyshots:notifications-review"
        left="50%"
        marginLeft={centerLeft + perimX}
        marginTop={centerTop + perimY}
        position="absolute"
        top="50%"
        width={borderWidth}
        zIndex={19}
      >
        <text content={leftBorder} fg={borderColor} left={0} position="absolute" selectable={false} top={0} />
        <text
          bg={borderColor}
          content={labelText}
          fg={termBg}
          left={leftBorder.length}
          position="absolute"
          selectable={false}
          top={0}
        />
        <text
          bg={termBg}
          content={rightBorder}
          fg={borderColor}
          left={leftBorder.length + labelText.length}
          position="absolute"
          selectable={false}
          top={0}
        />
        {sides}
        <text
          content={bottomBorder}
          fg={borderColor}
          left={0}
          position="absolute"
          selectable={false}
          top={borderHeight - 1}
        />
      </box>
      {/* Inner dialog content */}
      {children}
    </>
  );
}
