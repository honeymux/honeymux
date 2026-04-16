import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";
import { stripAnsiEscapes, stripNonPrintingControlChars } from "../util/text.ts";

interface SshErrorDialogProps {
  error: string;
  errorAt: number;
  noBackdrop?: boolean;
  onDismiss: () => void;
  serverName: string;
}

export function SshErrorDialog({ error, errorAt, noBackdrop = false, onDismiss, serverName }: SshErrorDialogProps) {
  const innerWidth = 54;
  const errorLines = wrapText(error, innerWidth);
  // 2 (title + blank) + errorLines + 1 (blank) + 1 (ago) + 1 (blank) + 1 (button)
  const contentRows = 7 + errorLines.length;
  // +2 for border
  const boxHeight = contentRows + 2;
  const boxWidth = innerWidth + 4; // +4 for border + padding

  return (
    <>
      {/* Backdrop */}
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
      {/* Dialog */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.statusWarning}
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
        <text content={`SSH connection failed: ${serverName}`} fg={theme.statusWarning} />
        <text content="" />
        {errorLines.map((line, i) => (
          <text content={line} fg={theme.text} key={i} />
        ))}
        <text content="" />
        <text content={timeAgo(errorAt)} fg={theme.textDim} />
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
      </box>
    </>
  );
}

export function sanitizeSshErrorText(text: string): string {
  return stripNonPrintingControlChars(stripAnsiEscapes(text)).replace(/\s+/g, " ").trim();
}

export function wrapText(text: string, maxWidth: number): string[] {
  const safe = sanitizeSshErrorText(text);
  const lines: string[] = [];
  let remaining = safe;
  while (remaining.length > maxWidth) {
    // Try to break at a space
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
