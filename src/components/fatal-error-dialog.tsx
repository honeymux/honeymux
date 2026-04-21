import type { MouseEvent } from "@opentui/core";

import { useEffect } from "react";

import type { FatalReport } from "../util/fatal-report.ts";

import { theme } from "../themes/theme.ts";
import { parseRawKeyEvent } from "../util/keybindings.ts";
import { shortenPath, stripAnsiEscapes, stripNonPrintingControlChars } from "../util/text.ts";

interface FatalErrorDialogProps {
  onDismiss: () => void;
  report: FatalReport;
}

const INNER_WIDTH = 64;

export function FatalErrorDialog({ onDismiss, report }: FatalErrorDialogProps) {
  useEffect(() => {
    const onData = (data: Buffer) => {
      // Kitty keyboard protocol delivers key releases as eventType 3 — ignore
      // them so a trailing release from the keystroke that triggered the
      // fatal doesn't instantly dismiss the dialog.
      const event = parseRawKeyEvent(data.toString("utf8"));
      if (event && event.eventType !== 1) return;

      const byte = data[0];
      if (byte === 0x0a || byte === 0x0d || byte === 0x1b || byte === 0x20) {
        onDismiss();
      }
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
    };
  }, [onDismiss]);

  const kindLine = sanitizeLine(report.kind);
  const headlineLines = wrapText(sanitizeLine(report.headline), INNER_WIDTH);
  const reportPathLine = report.path ? shortenPath(report.path) : "(not written)";
  const logPathLine = shortenPath(report.logPath);

  // 1 (title) + 1 (blank) + 1 (kind) + 1 (blank) + headlineLines + 1 (blank)
  // + 1 (report label) + 1 (report path) + 1 (log label) + 1 (log path)
  // + 1 (blank) + 1 (button)
  const contentRows = 11 + headlineLines.length;
  const boxHeight = contentRows + 2;
  const boxWidth = INNER_WIDTH + 4;

  return (
    <>
      <box height="100%" left={0} position="absolute" top={0} width="100%" zIndex={29} />
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.statusError}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        id="honeyshots:fatal-error-dialog"
        justifyContent="flex-start"
        left="50%"
        marginLeft={-Math.floor(boxWidth / 2)}
        marginTop={-Math.floor(boxHeight / 2)}
        position="absolute"
        top="50%"
        width={boxWidth}
        zIndex={30}
      >
        <text content="Honeymux encountered a fatal error" fg={theme.statusError} />
        <text content="" />
        <text content={kindLine} fg={theme.textBright} />
        <text content="" />
        {headlineLines.map((line, i) => (
          <text content={line} fg={theme.text} key={i} />
        ))}
        <text content="" />
        <text content="Crash report:" fg={theme.textDim} />
        <text content={reportPathLine} fg={theme.text} />
        <text content="Log:" fg={theme.textDim} />
        <text content={logPathLine} fg={theme.text} />
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

export function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxWidth) {
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}

function sanitizeLine(text: string): string {
  return stripNonPrintingControlChars(stripAnsiEscapes(text)).replace(/\s+/g, " ").trim();
}
