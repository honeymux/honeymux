import type { MouseEvent } from "@opentui/core";

import { theme } from "../themes/theme.ts";
import { isDismissKey } from "../util/keybindings.ts";

export interface DisablePaneTabsDialogProps {
  buttonCol: number; // 0=Disable, 1=Cancel
  inactivePaneCount: number;
  onCancel: () => void;
  onDisable: () => void;
}

export function DisablePaneTabsDialog({
  buttonCol,
  inactivePaneCount,
  onCancel,
  onDisable,
}: DisablePaneTabsDialogProps) {
  const boxWidth = 48;
  const boxHeight = 8;

  const disableSelected = buttonCol === 0;
  const cancelSelected = buttonCol === 1;

  const disableLabel = disableSelected ? "\u25b8 [ Disable ]" : "  [ Disable ]";
  const cancelLabel = cancelSelected ? "\u25b8 [ Cancel ]" : "  [ Cancel ]";

  const disableColor = disableSelected ? theme.statusWarning : theme.textDim;
  const cancelColor = cancelSelected ? theme.text : theme.textDim;

  const paneWord = inactivePaneCount === 1 ? "pane" : "panes";

  return (
    <>
      {/* Backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onCancel();
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
        borderColor={theme.statusWarning}
        borderStyle="rounded"
        flexDirection="column"
        height={boxHeight}
        id="honeyshots:disable-pane-tabs-dialog"
        justifyContent="center"
        left="50%"
        marginLeft={-Math.floor(boxWidth / 2)}
        marginTop={-Math.floor(boxHeight / 2)}
        position="absolute"
        top="50%"
        width={boxWidth}
        zIndex={20}
      >
        <text content="Disable pane tabs?" fg={theme.statusWarning} />
        <text content="" />
        <text content={`${inactivePaneCount} inactive ${paneWord} will be closed.`} fg={theme.textSecondary} />
        <text content="" />
        <box flexDirection="row" gap={2}>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onDisable();
            }}
            width={14}
          >
            <text content={disableLabel} fg={disableColor} />
          </box>
          <box
            alignItems="center"
            height={1}
            justifyContent="center"
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) onCancel();
            }}
            width={14}
          >
            <text content={cancelLabel} fg={cancelColor} />
          </box>
        </box>
      </box>
    </>
  );
}

/**
 * Handle keyboard input for the disable-pane-tabs confirmation dialog.
 * Returns updated buttonCol, "handled" if an action was taken, or null.
 */
export function handleDisablePaneTabsDialogInput(
  data: string,
  buttonCol: number,
  onDisable: () => void,
  onCancel: () => void,
): "handled" | null | number {
  if (isDismissKey(data)) {
    onCancel();
    return "handled";
  }

  // Left arrow / Shift+Tab
  if (data === "\x1b[D" || data === "\x1b[Z") {
    return buttonCol === 0 ? 1 : 0;
  }

  // Right arrow / Tab
  if (data === "\x1b[C" || data === "\t") {
    return buttonCol === 0 ? 1 : 0;
  }

  // Enter or Space
  if (data === "\r" || data === "\n" || data === " ") {
    if (buttonCol === 0) onDisable();
    else onCancel();
    return "handled";
  }

  return null;
}
