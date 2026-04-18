import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";

interface HistoryConsentDialogProps {
  onAllow: () => void;
  onDeny: () => void;
  selected?: "allow" | "deny";
}

export function HistoryConsentDialog({ onAllow, onDeny, selected = "allow" }: HistoryConsentDialogProps) {
  const boxWidth = 58;
  const boxHeight = 16;

  const allowSelected = selected === "allow";

  return (
    <>
      {/* Backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onDeny();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      {/* Dialog */}
      <box
        alignItems="center"
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        id="honeyshots:history-consent-dialog"
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
        {/* Title */}
        <text content="Conversation History Access" fg={theme.textBright} />
        <text content="" />

        {/* Description */}
        <text content="Find conversations across Claude, Codex," fg={theme.text} />
        <text content="Gemini, and OpenCode by reading local files:" fg={theme.text} />
        <text content="" />

        {/* File paths */}
        <text content="~/.claude/history.jsonl" fg={theme.textSecondary} />
        <text content="~/.codex/sessions/**/*.jsonl" fg={theme.textSecondary} />
        <text content="~/.gemini/tmp/*/chats/*.json" fg={theme.textSecondary} />
        <text content="~/.local/state/opencode/prompt-history.jsonl" fg={theme.textSecondary} />
        <text content="" />

        {/* Privacy note */}
        <text content="No data leaves your device." fg={theme.textDim} />
        <text content="" />

        {/* Buttons */}
        <box flexDirection="row" gap={4}>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onAllow();
            }}
            width={13}
          >
            <text
              content={allowSelected ? "▸ [ Allow ]" : "  [ Allow ]"}
              fg={allowSelected ? theme.statusSuccess : theme.textDim}
            />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onDeny();
            }}
            width={11}
          >
            <text
              content={!allowSelected ? "▸ [ Deny ]" : "  [ Deny ]"}
              fg={!allowSelected ? theme.statusError : theme.textDim}
            />
          </box>
        </box>
      </box>
    </>
  );
}
