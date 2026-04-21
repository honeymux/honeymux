import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";

interface AgentInstallDialogProps {
  agentName: string;
  docsUrl: string;
  /** When set, labels the dialog as targeting a remote host (e.g. an SSH server name). */
  host?: string;
  installLabel?: "hooks" | "plugin";
  /** "install" = fresh install prompt; "upgrade" = hooks present but consent not recorded (e.g. outdated script). */
  mode?: "install" | "upgrade";
  noBackdrop?: boolean;
  onInstall: () => void;
  onNever?: () => void;
  onSkip: () => void;
  selected?: "install" | "never" | "skip";
}

export function AgentInstallDialog({
  agentName,
  docsUrl,
  host,
  installLabel = "hooks",
  mode = "install",
  noBackdrop = false,
  onInstall,
  onNever,
  onSkip,
  selected = "install",
}: AgentInstallDialogProps) {
  const name = agentName;
  const hasNever = !!onNever;
  const isUpgrade = mode === "upgrade";
  const actionLabel = isUpgrade ? "Upgrade" : "Install";
  // Upgrade mode has a longer "Found existing..." detected line that would
  // crowd the 52/58 install-mode box widths.
  const boxWidth = isUpgrade ? (hasNever ? 66 : 60) : hasNever ? 58 : 52;
  const boxHeight = host ? 13 : 12;
  const detectedLine = isUpgrade
    ? host
      ? `Found existing ${installLabel} installation for ${name} on ${host}.`
      : `Found existing ${installLabel} installation for ${name}.`
    : host
      ? `${name} detected on ${host}.`
      : `${name} detected.`;
  const promptLine = isUpgrade
    ? host
      ? `Upgrade ${installLabel} on ${host} to the latest version?`
      : `Upgrade ${installLabel} to the latest version?`
    : host
      ? `Install ${installLabel} on ${host} for real-time monitoring?`
      : `Install ${installLabel} for real-time monitoring?`;

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
        id="honeyshots:agent-install-dialog"
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
        <text content={detectedLine} fg={theme.text} />
        <text content={promptLine} fg={theme.text} />
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
              content={selected === "install" ? `▸ [ ${actionLabel} ]` : `  [ ${actionLabel} ]`}
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
