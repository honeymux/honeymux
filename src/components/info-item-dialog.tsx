import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";

interface InfoItemDialogProps {
  message: string | string[];
  noBackdrop?: boolean;
  onDismiss: () => void;
}

const INFO_INNER_WIDTH = 54;

export function InfoItemDialog({ message, noBackdrop = false, onDismiss }: InfoItemDialogProps) {
  const lines = Array.isArray(message) ? message : [message];
  const boxHeight = infoItemDialogHeight(message);
  const boxWidth = INFO_INNER_WIDTH + 4; // +4 for border + padding

  return (
    <>
      {!noBackdrop && (
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
      )}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.statusInfo}
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
        <text content="" />
        <text content="ʕ·ᴥ·ʔ" fg={theme.statusWarning} />
        <text content="" />
        {lines.map((line, i) => (
          <text content={line} fg={line === "" ? undefined : theme.statusInfo} key={i} />
        ))}
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
          <text content="▸ [ OK ]" fg={theme.text} />
        </box>
        <text content="" />
      </box>
    </>
  );
}

/** Compute the outer box height for a given message (for review-frame sizing). */
export function infoItemDialogHeight(message: string | string[]): number {
  const lines = Array.isArray(message) ? message : [message];
  // 1 (blank) + 1 (bear) + 1 (blank) + N (message lines) + 1 (blank) + 1 (button) + 1 (blank) + 2 (border)
  return lines.length + 8;
}
