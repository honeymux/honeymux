import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";

interface AgentInstallDialogProps {
  agentName: string;
  docsUrl: string;
  installLabel?: "hooks" | "plugin";
  noBackdrop?: boolean;
  onInstall: () => void;
  onNever?: () => void;
  onSkip: () => void;
  selected?: "install" | "never" | "skip";
}

export function AgentInstallDialog({
  agentName,
  docsUrl,
  installLabel = "hooks",
  noBackdrop = false,
  onInstall,
  onNever,
  onSkip,
  selected = "install",
}: AgentInstallDialogProps) {
  const name = agentName;
  const hasNever = !!onNever;
  const boxWidth = hasNever ? 58 : 52;
  const boxHeight = 12;

  return (
    <>
      {/* Backdrop */}
      {!noBackdrop && (
        <box
          height="100%"
          left={0}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) onSkip();
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
        borderColor={theme.accent}
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
        <text content={`${name} detected.`} fg={theme.text} />
        <text content={`Install ${installLabel} for real-time monitoring?`} fg={theme.text} />
        <text content="" />
        <text content={docsUrl} fg={theme.textDim} />
        <text content="" />
        <box flexDirection="row" gap={2}>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onInstall();
            }}
            width={14}
          >
            <text
              content={selected === "install" ? "▸ [ Install ]" : "  [ Install ]"}
              fg={selected === "install" ? theme.statusSuccess : theme.textDim}
            />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onSkip();
            }}
            width={14}
          >
            <text
              content={selected === "skip" ? "▸ [ Not Now ]" : "  [ Not Now ]"}
              fg={selected === "skip" ? theme.text : theme.textDim}
            />
          </box>
          {hasNever && (
            <box
              alignItems="center"
              height={1}
              justifyContent="center"
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0) onNever!();
              }}
              width={14}
            >
              <text
                content={selected === "never" ? "▸ [ Never ]" : "  [ Never ]"}
                fg={selected === "never" ? theme.textDim : theme.textDim}
              />
            </box>
          )}
        </box>
      </box>
    </>
  );
}
