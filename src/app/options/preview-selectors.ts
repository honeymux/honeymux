import { type OptionsTab, type RowKind, TAB_ROWS } from "./model.ts";

export function isAgentWatermarkPreviewFocused(optionsDialogOpen: boolean, tab: OptionsTab, row: number): boolean {
  return optionsDialogOpen && getFocusedRowKind(tab, row) === "agentAlertWatermark";
}

export function isQuickTerminalSizePreviewFocused(optionsDialogOpen: boolean, tab: OptionsTab, row: number): boolean {
  return optionsDialogOpen && getFocusedRowKind(tab, row) === "quickTerminalSize";
}

function getFocusedRowKind(tab: OptionsTab, row: number): RowKind | null {
  return TAB_ROWS[tab][row] ?? null;
}
