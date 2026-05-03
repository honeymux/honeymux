import { type MouseEvent, TextAttributes } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useRef } from "react";

import type { MainMenuSelectedCol } from "../app/hooks/use-app-state-groups.ts";
import type { KeyAction, KeybindingConfig } from "../util/keybindings.ts";

import { version } from "../../package.json";
import { theme } from "../themes/theme.ts";
import { MODIFIER_KEY_NAMES, ZOOM_HOLD_ACTIONS, formatBinding } from "../util/keybindings.ts";
import { hasCap } from "../util/terminal-caps.ts";
import { terminalName } from "../util/terminal-detect.ts";
import { tmuxVersion } from "../util/tmux-server.ts";
import { useCaptureGlow } from "./use-capture-glow.ts";

export type MainMenuTab = "about" | "agents" | "functions" | "navigation";
export const MAIN_MENU_TAB_ORDER: MainMenuTab[] = ["functions", "navigation", "agents", "about"];
const MAIN_MENU_TAB_LABELS: Record<MainMenuTab, string> = {
  about: "About",
  agents: "Agent Actions",
  functions: "Functions",
  navigation: "Navigation",
};

// Letter → KeyAction mapping for command palette dispatch
export const LETTER_MAP: Record<string, KeyAction> = {
  a: "agents",
  b: "bufferZoom",
  c: "conversations",

  e: "sidebar",
  f: "favoriteProfile",
  h: "screenshot",
  i: "notifications",
  m: "mobile",
  n: "newPaneTab",
  o: "options",
  p: "profiles",
  q: "quickTerminal",
  r: "review",
  s: "sessions",
  t: "toolbar",
  v: "activateMenu",
  w: "redraw",
};

// Functions tab: left column entries (letter + action + display name)
const FUNC_LEFT: { action: KeyAction; desc: string; letter: string }[] = [
  { action: "agents", desc: "Agents", letter: "A" },
  { action: "bufferZoom", desc: "Buffer zoom", letter: "B" },
  { action: "conversations", desc: "Conversations", letter: "C" },

  { action: "sidebar", desc: "Sidebar", letter: "E" },
  { action: "favoriteProfile", desc: "Fav profile", letter: "F" },
  { action: "screenshot", desc: "Screenshot", letter: "H" },
  { action: "notifications", desc: "Notifications", letter: "I" },
  { action: "mainMenu", desc: "Main Menu", letter: "-" },
  { action: "mobile", desc: "Mobile UI", letter: "M" },
];

const FUNC_RIGHT: { action: KeyAction; desc: string; letter: string }[] = [
  { action: "newPaneTab", desc: "New pane tab", letter: "N" },
  { action: "options", desc: "Options", letter: "O" },
  { action: "profiles", desc: "Profiles", letter: "P" },
  { action: "quickTerminal", desc: "Quick terminal", letter: "Q" },
  { action: "review", desc: "Review", letter: "R" },
  { action: "sessions", desc: "Sessions", letter: "S" },
  { action: "toolbar", desc: "Toolbar", letter: "T" },
  { action: "activateMenu", desc: "Activate menu", letter: "V" },
  { action: "redraw", desc: "Redraw", letter: "W" },
];

// Agents tab: single centered "Global" column. Review workflow bindings
// (agentReview*) still live in the keybindings config with defaults but
// are intentionally not exposed in the UI to keep this tab simple — only
// the global-scope actions are user-configurable here.
const AGENT_ROWS_DATA: { action: KeyAction; desc: string }[] = [
  { action: "agentLatch", desc: "Latch" },
  { action: "agentPermApprove", desc: "Approve" },
  { action: "agentPermDeny", desc: "Deny" },
  { action: "agentPermGoto", desc: "Go to" },
  { action: "agentPermDismiss", desc: "Dismiss" },
];
const AGENT_HEADER = "Global";

// Navigation tab: paired prev/next rows
const NAV_PAIRS: { left: { action: KeyAction; desc: string }; right: { action: KeyAction; desc: string } }[] = [
  { left: { action: "prevPaneTab", desc: "Prev pane" }, right: { action: "nextPaneTab", desc: "Next pane" } },
  { left: { action: "prevWindow", desc: "Prev window" }, right: { action: "nextWindow", desc: "Next window" } },
  { left: { action: "prevSession", desc: "Prev session" }, right: { action: "nextSession", desc: "Next session" } },
  { left: { action: "sidebarFocus", desc: "Sidebar focus" }, right: { action: "toolbarFocus", desc: "Toolbar focus" } },
];

const FUNC_ROWS = Math.max(FUNC_LEFT.length, FUNC_RIGHT.length); // 10
/** Row index (in selection space) for the zoom modifier row. */
export const ZOOM_ROW_IDX = FUNC_ROWS; // 10
const ZOOM_LEFT = { action: "zoomAgentsView" as KeyAction, desc: "Zoom agents view" };
const ZOOM_RIGHT = { action: "zoomServerView" as KeyAction, desc: "Zoom server view" };
/** Total selectable rows in the functions tab (10 functions + 1 zoom). */
const TOTAL_FUNC_ROWS = FUNC_ROWS + 1; // 11
export const AGENT_ROWS = AGENT_ROWS_DATA.length; // 5 single-column rows
const NAV_ROWS = NAV_PAIRS.length; // 4

const PANE_TAB_ACTIONS = new Set<KeyAction>(["newPaneTab"]);

/** Human-readable label for each bindable action (used in conflict error messages). */
export const ACTION_LABELS: Record<KeyAction, string> = Object.fromEntries([
  ...FUNC_LEFT.map((e) => [e.action, e.desc]),
  ...FUNC_RIGHT.map((e) => [e.action, e.desc]),
  ...AGENT_ROWS_DATA.map((e) => [e.action, e.desc]),
  // Review workflow actions are config-only (no UI), but they still need
  // labels for conflict error messages.
  ["agentReviewGoto", "Review go to"],
  ["agentReviewNext", "Review next"],
  ["agentReviewPrev", "Review prev"],
  ...NAV_PAIRS.flatMap((p) => [
    [p.left.action, p.left.desc],
    [p.right.action, p.right.desc],
  ]),
  [ZOOM_LEFT.action, ZOOM_LEFT.desc],
  [ZOOM_RIGHT.action, ZOOM_RIGHT.desc],
]) as Record<KeyAction, string>;
const ALWAYS_DISABLED_ACTIONS = new Set<KeyAction>(["mainMenu"]);

interface MainMenuDialogProps {
  captureError?: string;
  capturing: boolean;
  hasFavoriteProfile?: boolean;
  keybindings: KeybindingConfig;
  mainMenuTab: MainMenuTab;
  onClose: () => void;
  onTabChange: (tab: MainMenuTab) => void;
  onToggleZoomSticky?: (action: "zoomAgentsView" | "zoomServerView") => void;
  paneTabsEnabled?: boolean;
  selectedCol: MainMenuSelectedCol;
  selectedRow: number;
  termHeight?: number;
  termWidth?: number;
  toolbarOpen: boolean;
  zoomAgentsViewStickyKey?: boolean;
  zoomServerViewStickyKey?: boolean;
}
export function getActionForSlot(
  tab: MainMenuTab,
  row: number,
  col: MainMenuSelectedCol,
  paneTabsEnabled = true,
): KeyAction | null {
  // Sticky toggle columns have no associated action
  if (col === "left-sticky" || col === "right-sticky") return null;
  const funcLeft = FUNC_LEFT;
  const funcRight = FUNC_RIGHT;
  const navPairs = paneTabsEnabled
    ? NAV_PAIRS
    : NAV_PAIRS.filter((p) => !PANE_TAB_ACTIONS.has(p.left.action) && !PANE_TAB_ACTIONS.has(p.right.action));
  if (tab === "functions") {
    if (row === ZOOM_ROW_IDX) return col === "left" ? ZOOM_LEFT.action : ZOOM_RIGHT.action;
    const entry = col === "left" ? funcLeft[row] : funcRight[row];
    return entry?.action ?? null;
  }
  if (tab === "agents") {
    const entry = AGENT_ROWS_DATA[row];
    return entry?.action ?? null;
  }
  const pair = navPairs[row];
  if (!pair) return null;
  return col === "left" ? pair.left.action : pair.right.action;
}

export function getEffectiveFuncRows(_paneTabsEnabled: boolean): number {
  return TOTAL_FUNC_ROWS;
}

export function getEffectiveNavRows(paneTabsEnabled: boolean): number {
  return paneTabsEnabled
    ? NAV_ROWS
    : NAV_PAIRS.filter((p) => !PANE_TAB_ACTIONS.has(p.left.action) && !PANE_TAB_ACTIONS.has(p.right.action)).length;
}

// Toolbar button labels in display order
const TOOLBAR_BUTTON_LABELS = ["vSplit", "hSplit", "bZoom", "mobile", "detach"];

// Column widths for the layout (binding column is dynamic, see getDialogCombinedW)
const MIN_BIND_W = 8; // minimum binding width (length of "unmapped")
const MAX_BIND_W = 17; // maximum binding width (length of "ctrl+shift+alt+lt")
const DESC_W = 17; // description width (longest: "Sidebar nav right" = 17)

const BASE_COMBINED_W = 80; // base dialog + sidecar width at MIN_BIND_W
const BASE_TERM_W = 80; // terminal width at which dialog uses base width

const MAX_LABEL_LEN = 6; // "vSplit" / "hSplit"
const SIDECAR_W_CONST = MAX_LABEL_LEN + 4; // border + pad + label + pad + border = 10
const TOOLBAR_WIDTH_CONST = 7;

const DIALOG_HEIGHT = 22;

export function MainMenuDialog({
  captureError,
  capturing,
  hasFavoriteProfile,
  keybindings,
  mainMenuTab,
  onClose,
  onTabChange,
  onToggleZoomSticky,
  paneTabsEnabled = true,
  selectedCol,
  selectedRow,
  termHeight,
  termWidth,
  toolbarOpen,
  zoomAgentsViewStickyKey = true,
  zoomServerViewStickyKey = true,
}: MainMenuDialogProps) {
  const renderer = useRenderer();
  const configPath = "~/.config/honeymux/keybindings.json";

  const effectiveNavPairs = paneTabsEnabled
    ? NAV_PAIRS
    : NAV_PAIRS.filter((p) => !PANE_TAB_ACTIONS.has(p.left.action) && !PANE_TAB_ACTIONS.has(p.right.action));
  // ── dynamic binding column width (8..16 depending on terminal width) ──────
  const tw = termWidth ?? 80;
  const th = termHeight ?? 40;
  const bindExtra = Math.min(MAX_BIND_W - MIN_BIND_W, Math.max(0, Math.floor((tw - BASE_TERM_W) / 2)));
  const bindW = MIN_BIND_W + bindExtra;
  const subInnerW = 2 * bindW + 49;
  const subOuterW = subInnerW + 2;
  const colDivPos = bindW + 24;
  const combinedW = getDialogCombinedW(tw);
  const fullDialogW = combinedW - SIDECAR_W_CONST + 1;

  // ── sub-box helpers ───────────────────────────────────────────────────────

  const subTopDiv = `╭${"─".repeat(colDivPos)}┬${"─".repeat(subInnerW - colDivPos - 1)}╮`;
  const subTopPlain = `╭${"─".repeat(subInnerW)}╮`;
  const hasDivider = mainMenuTab === "functions" || mainMenuTab === "navigation";
  const subTop = hasDivider ? subTopDiv : subTopPlain;
  const subBot = `╰${"─".repeat(subInnerW)}╯`;
  const subSepDiv = `├${"─".repeat(colDivPos)}┴${"─".repeat(subInnerW - colDivPos - 1)}┤`;
  const subSepPlain = `├${"─".repeat(subInnerW)}┤`;
  const subSep = mainMenuTab === "navigation" ? subSepDiv : subSepPlain;

  // Extra content rows from layout compaction (1 from top padding, 1 from bottom padding)
  const BOX_CONTENT_ROWS = FUNC_ROWS + 2;
  // Agents tab visual layout: header + blank + AGENT_ROWS data rows.
  const agentVisualRows = 1 + 1 + AGENT_ROWS;
  const agentTopPad = Math.max(0, Math.floor((BOX_CONTENT_ROWS - agentVisualRows) / 2));
  // Navigation tab: center rows vertically with a gap before the focus group
  const navPrevNextCount = effectiveNavPairs.length - 1;
  const navVisualRows = navPrevNextCount + 1 + 1; // prev/next + gap + focus
  const navTopPad = Math.floor((BOX_CONTENT_ROWS - navVisualRows) / 2);
  // About tab row content — extra 2 rows since we skip subSep + cfgRow
  const ABOUT_ROWS = BOX_CONTENT_ROWS + 2;
  const capEntries: { altCap?: string; cap: string; label: string }[] = [
    { cap: "Be", label: "Bracketed paste" },
    { cap: "Setulc", label: "Colored underlines" },
    { cap: "Ss", label: "Cursor styles" },
    { cap: "KittyKbd", label: "Kitty keyboard protocol" },
    { cap: "Ms", label: "OSC 52 clipboard" },
    { cap: "Smulx", label: "Styled underlines" },
    { cap: "Sync", label: "Synchronized output" },
    { altCap: "RGB", cap: "Tc", label: "True color" },
  ];
  // Column widths: " " + desc:24 + "  " + cap:8 + "  " + status:1 + " "
  const CAP_DESC_W = 24;
  const CAP_NAME_W = 8;
  // Total: 1 + 24 + 2 + 8 + 2 + 1 + 1 = 39; remaining padding = subInnerW - 39
  const CAP_PAD_R = subInnerW - 1 - CAP_DESC_W - 2 - CAP_NAME_W - 2 - 1 - 1;

  type AboutLine = { align?: "left"; kind: "text"; text: string } | { entry: (typeof capEntries)[number]; kind: "cap" };
  const aboutLines: AboutLine[] = [
    { kind: "text", text: `Version ${version}` },
    ...(tmuxVersion ? [{ kind: "text" as const, text: tmuxVersion }] : []),
    ...(terminalName ? [{ kind: "text" as const, text: `Terminal: ${terminalName}` }] : []),
    { kind: "text", text: "" },
    ...capEntries.map((e) => ({ entry: e, kind: "cap" as const })),
  ];

  const aboutRow = (rowIdx: number) => {
    const line = aboutLines[rowIdx];
    if (!line) return null;
    if (line.kind === "text") {
      const padded =
        line.align === "left"
          ? (" " + line.text).padEnd(subInnerW).slice(0, subInnerW)
          : (" ".repeat(Math.floor((subInnerW - line.text.length) / 2)) + line.text)
              .padEnd(subInnerW)
              .slice(0, subInnerW);
      return (
        <>
          <text content="│" fg={theme.textDim} />
          <text content={padded} fg={theme.textSecondary} />
          <text content="│" fg={theme.textDim} />
        </>
      );
    }
    const { entry } = line;
    const supported = hasCap(entry.cap) || (entry.altCap ? hasCap(entry.altCap) : false);
    const fg = supported ? theme.statusSuccess : theme.textDim;
    const inner = `${entry.label.padEnd(CAP_DESC_W)}  ${entry.cap.padEnd(CAP_NAME_W)}${" ".repeat(CAP_PAD_R + 2)}${supported ? "✓" : "✗"}`;
    return (
      <>
        <text content="│ " fg={theme.textDim} />
        <text content={inner} fg={fg} />
        <text content=" │" fg={theme.textDim} />
      </>
    );
  };
  const aboutLineCount = aboutLines.length;

  const formatBind = (action: KeyAction, { holdPrefix = true }: { holdPrefix?: boolean } = {}): string => {
    const raw = keybindings[action];
    if (!raw) return "";
    const name = formatBinding(raw);
    if (!name) return "";
    // hold/tap prefix only for modifier-only bindings (combos don't have release events)
    if (holdPrefix && ZOOM_HOLD_ACTIONS.has(action) && MODIFIER_KEY_NAMES.has(raw)) {
      const sticky = action === "zoomAgentsView" ? zoomAgentsViewStickyKey : zoomServerViewStickyKey;
      return sticky ? `tap ${name}` : `hold ${name}`;
    }
    return name;
  };

  // Render a binding slot
  const bindSlot = (action: KeyAction, col: MainMenuSelectedCol, rowIdx: number, align: "left" | "right") => {
    const isSelected = rowIdx === selectedRow && col === selectedCol;
    const isCapturing = isSelected && capturing;
    if (isCapturing) {
      const formatted = formatBind(action, { holdPrefix: false });
      if (!formatted) {
        // No binding — show full-width underline placeholder
        return (
          <text
            attributes={TextAttributes.UNDERLINE}
            bg={theme.accent}
            content={" ".repeat(bindW)}
            fg={theme.bgSurface}
          />
        );
      }
      const text = formatted.length <= bindW ? formatted : formatted.slice(formatted.length - bindW);
      const pad = bindW - text.length;
      if (align === "right") {
        return (
          <>
            {pad > 0 && <text content={" ".repeat(pad)} />}
            <text attributes={TextAttributes.UNDERLINE} bg={theme.accent} content={text} fg={theme.bgSurface} />
          </>
        );
      }
      return (
        <>
          <text attributes={TextAttributes.UNDERLINE} bg={theme.accent} content={text} fg={theme.bgSurface} />
          {pad > 0 && <text content={" ".repeat(pad)} />}
        </>
      );
    }
    const formatted = formatBind(action);
    const display = formatted
      ? formatted.length <= bindW
        ? formatted
        : formatted.slice(0, bindW - 1) + "…"
      : "unmapped";
    const padded = align === "right" ? display.padStart(bindW) : display.padEnd(bindW);
    const fg = isSelected ? theme.bgSurface : theme.textDim;
    const bg = isSelected ? theme.accent : undefined;
    return <text bg={bg} content={padded} fg={fg} />;
  };

  // Render a description with the hotkey letter bolded (skip empty text nodes to avoid phantom spacing)
  const styledDesc = (desc: string, letter: string, width: number, align: "left" | "right", disabled = false) => {
    const fg = disabled ? theme.textDim : theme.textSecondary;
    const idx = desc.toLowerCase().indexOf(letter.toLowerCase());
    if (idx === -1) {
      const padded = align === "right" ? desc.padStart(width) : desc.padEnd(width);
      return <text content={padded} fg={fg} />;
    }
    // Pad first, then find the match position in the padded string
    const padded = align === "right" ? desc.padStart(width) : desc.padEnd(width);
    const paddedIdx = align === "right" ? idx + (width - desc.length) : idx;
    const before = padded.slice(0, paddedIdx);
    const match = padded[paddedIdx]!;
    const after = padded.slice(paddedIdx + 1);
    return (
      <>
        {before && <text content={before} fg={fg} />}
        <text attributes={disabled ? 0 : TextAttributes.BOLD} content={match} fg={disabled ? fg : theme.textBright} />
        {after && <text content={after} fg={fg} />}
      </>
    );
  };

  // Functions tab row
  const funcRow = (rowIdx: number) => {
    const left = FUNC_LEFT[rowIdx];
    const right = FUNC_RIGHT[rowIdx];
    const leftDisabled =
      left &&
      (ALWAYS_DISABLED_ACTIONS.has(left.action) ||
        (!paneTabsEnabled && PANE_TAB_ACTIONS.has(left.action)) ||
        (left.action === "favoriteProfile" && !hasFavoriteProfile));
    const rightDisabled =
      right &&
      (ALWAYS_DISABLED_ACTIONS.has(right.action) ||
        (!paneTabsEnabled && PANE_TAB_ACTIONS.has(right.action)) ||
        (right.action === "favoriteProfile" && !hasFavoriteProfile));
    return (
      <>
        <text content="│ " fg={theme.textDim} />
        {left ? (
          <>
            {bindSlot(left.action, "left", rowIdx, "left")}
            <text content="  " />
            {styledDesc(left.desc, left.letter, DESC_W, "left", leftDisabled)}
            <text content="  " />
            <text
              attributes={leftDisabled ? TextAttributes.UNDERLINE : TextAttributes.BOLD | TextAttributes.UNDERLINE}
              content={left.letter}
              fg={leftDisabled ? theme.textDim : theme.textBright}
            />
          </>
        ) : (
          <text content={" ".repeat(colDivPos - 2)} />
        )}
        <text content=" │ " fg={theme.textDim} />
        {right ? (
          <>
            <text
              attributes={rightDisabled ? TextAttributes.UNDERLINE : TextAttributes.BOLD | TextAttributes.UNDERLINE}
              content={right.letter}
              fg={rightDisabled ? theme.textDim : theme.textBright}
            />
            <text content="  " />
            {styledDesc(right.desc, right.letter, DESC_W, "right", rightDisabled)}
            <text content="  " />
            {bindSlot(right.action, "right", rowIdx, "right")}
            <text content=" " />
          </>
        ) : (
          <text content={" ".repeat(subInnerW - colDivPos - 2)} />
        )}
        <text content="│" fg={theme.textDim} />
      </>
    );
  };

  // Zoom modifier row (bottom of Functions tab, ⊙ toggle for sticky mode)
  const zoomRow = () => {
    const leftDesc = ZOOM_LEFT.desc.padEnd(DESC_W);
    const rightDesc = ZOOM_RIGHT.desc.padStart(DESC_W);
    const isZoomRow = selectedRow === ZOOM_ROW_IDX;
    const leftStickySelected = isZoomRow && selectedCol === "left-sticky";
    const rightStickySelected = isZoomRow && selectedCol === "right-sticky";
    // Sticky toggle only applies to modifier-only bindings (combos have no
    // release event), and modifier-only key codes are only emitted when the
    // kitty keyboard protocol is active. Without it the toggle has no effect.
    const hasKittyKbd = hasCap("KittyKbd");
    const leftCanToggle = MODIFIER_KEY_NAMES.has(keybindings.zoomAgentsView ?? "") && hasKittyKbd;
    const rightCanToggle = MODIFIER_KEY_NAMES.has(keybindings.zoomServerView ?? "") && hasKittyKbd;
    const leftStickyChar = leftCanToggle ? "⊙" : "-";
    const rightStickyChar = rightCanToggle ? "⊙" : "-";
    const leftStickyFg = !leftCanToggle
      ? theme.textDim
      : leftStickySelected
        ? theme.bgSurface
        : zoomAgentsViewStickyKey
          ? theme.statusSuccess
          : theme.statusError;
    const rightStickyFg = !rightCanToggle
      ? theme.textDim
      : rightStickySelected
        ? theme.bgSurface
        : zoomServerViewStickyKey
          ? theme.statusSuccess
          : theme.statusError;
    return (
      <>
        <text content="│ " fg={theme.textDim} />
        {bindSlot(ZOOM_LEFT.action, "left", ZOOM_ROW_IDX, "left")}
        <text content="  " />
        <text content={leftDesc} fg={theme.textSecondary} />
        <text content="  " />
        <text
          bg={leftStickySelected ? theme.accent : undefined}
          content={leftStickyChar}
          fg={leftStickyFg}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0 && leftCanToggle) onToggleZoomSticky?.("zoomAgentsView");
          }}
        />
        <text content=" │ " fg={theme.textDim} />
        <text
          bg={rightStickySelected ? theme.accent : undefined}
          content={rightStickyChar}
          fg={rightStickyFg}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0 && rightCanToggle) onToggleZoomSticky?.("zoomServerView");
          }}
        />
        <text content="  " />
        <text content={rightDesc} fg={theme.textSecondary} />
        <text content="  " />
        {bindSlot(ZOOM_RIGHT.action, "right", ZOOM_ROW_IDX, "right")}
        <text content=" │" fg={theme.textDim} />
      </>
    );
  };

  // Navigation tab row
  const navRow = (rowIdx: number) => {
    const pair = effectiveNavPairs[rowIdx]!;
    const leftDesc = pair.left.desc;
    const rightDesc = pair.right.desc;
    return (
      <>
        <text content="│ " fg={theme.textDim} />
        {bindSlot(pair.left.action, "left", rowIdx, "left")}
        <text content="  " />
        <text content={leftDesc.padEnd(DESC_W)} fg={theme.textSecondary} />
        <text content="    │ " fg={theme.textDim} />
        <text content={"   "} />
        <text content={rightDesc.padStart(DESC_W)} fg={theme.textSecondary} />
        <text content="  " />
        {bindSlot(pair.right.action, "right", rowIdx, "right")}
        <text content=" │" fg={theme.textDim} />
      </>
    );
  };

  // Agents tab header row (centered single column label)
  const agentHeaderRow = () => {
    const padded = AGENT_HEADER.padStart(Math.floor((subInnerW + AGENT_HEADER.length) / 2)).padEnd(subInnerW);
    return (
      <>
        <text content="│" fg={theme.textDim} />
        <text content={padded} fg={theme.accent} />
        <text content="│" fg={theme.textDim} />
      </>
    );
  };

  // Agents tab row — single centered binding slot and description.
  const agentRow = (rowIdx: number) => {
    const entry = AGENT_ROWS_DATA[rowIdx]!;
    const innerWidth = bindW + 2 + DESC_W;
    const leftPad = Math.floor((subInnerW - innerWidth) / 2);
    const rightPad = subInnerW - innerWidth - leftPad;
    return (
      <>
        <text content="│" fg={theme.textDim} />
        <text content={" ".repeat(leftPad)} />
        {bindSlot(entry.action, "left", rowIdx, "right")}
        <text content="  " />
        <text content={entry.desc.padEnd(DESC_W)} fg={theme.textSecondary} />
        <text content={" ".repeat(rightPad)} />
        <text content="│" fg={theme.textDim} />
      </>
    );
  };

  const { glowColor } = useCaptureGlow(capturing);

  // Position real terminal cursor at the capture slot.
  // Must use a post-process function so it runs AFTER the ghostty terminal
  // renderable's renderSelf (which hides the cursor when dialogs are open).
  // Use a ref so the post-process function reads live state — no delay when
  // capturing is turned off between the state change and the next useEffect.
  const captureCursorRef = useRef<{ x: number; y: number } | null>(null);
  if (capturing && mainMenuTab !== "about") {
    const action = getActionForSlot(mainMenuTab, selectedRow, selectedCol, paneTabsEnabled);
    if (action) {
      const showSc = toolbarOpen;
      const dlgW = showSc ? fullDialogW : combinedW;
      const dlgLeft = Math.max(0, Math.floor((tw - combinedW) / 2));
      const dlgTop = Math.max(0, Math.floor((th - DIALOG_HEIGHT) / 2));
      const indent = Math.floor((dlgW - 2 - subOuterW) / 2);

      const formatted = formatBind(action, { holdPrefix: false });
      const contentLen = !formatted ? 0 : Math.min(formatted.length, bindW);
      const isRight = selectedCol === "right" || selectedCol === "right-sticky";
      const isFuncTab = mainMenuTab === "functions";
      const isAgentsTab = mainMenuTab === "agents";
      // Agents tab uses a single centered binding column (right-aligned).
      const agentsInnerWidth = bindW + 2 + DESC_W;
      const agentsLeftPad = Math.floor((subInnerW - agentsInnerWidth) / 2);
      const bindOff = isAgentsTab ? agentsLeftPad + 1 : isRight ? bindW + 49 : 2;
      const cursorInSlot = isAgentsTab ? bindW : isRight ? bindW : contentLen;
      // Functions tab: rows shifted up (no top padding), zoom row has a gap before it.
      // Agents tab: header row plus one blank row before the first binding row.
      // Navigation tab: centered vertically with gap before focus group.
      const visualRow = isFuncTab
        ? selectedRow >= ZOOM_ROW_IDX
          ? selectedRow + 1
          : selectedRow // +1 for gap before zoom
        : isAgentsTab
          ? agentTopPad + 2 + selectedRow
          : selectedRow < navPrevNextCount
            ? navTopPad + selectedRow
            : navTopPad + navPrevNextCount + 1;
      captureCursorRef.current = {
        x: dlgLeft + 2 + indent + bindOff + cursorInSlot,
        y: dlgTop + 6 + visualRow,
      };
    } else {
      captureCursorRef.current = null;
    }
  } else {
    captureCursorRef.current = null;
  }
  useEffect(() => {
    const postProcess = () => {
      const pos = captureCursorRef.current;
      if (pos) renderer.setCursorPosition(pos.x, pos.y, true);
    };
    renderer.addPostProcessFn(postProcess);
    return () => {
      renderer.removePostProcessFn(postProcess);
    };
  }, []);

  const captureHint = "press key combo or modifier to bind";
  const cfgContent = mainMenuTab === "about" ? "" : capturing ? captureError || captureHint : configPath;
  const cfgPadLeft = Math.floor((subInnerW - cfgContent.length) / 2);
  const cfgCentered = (" ".repeat(cfgPadLeft) + cfgContent).padEnd(subInnerW).slice(0, subInnerW);
  const cfgFg = capturing ? (captureError ? theme.statusError : glowColor) : theme.textDim;
  const cfgRowEl = (
    <>
      <text content="│" fg={theme.textDim} />
      <text content={cfgCentered} fg={cfgFg} />
      <text content="│" fg={theme.textDim} />
    </>
  );

  // ── positioning ───────────────────────────────────────────────────────────

  const TOOLBAR_WIDTH = TOOLBAR_WIDTH_CONST;
  const SIDECAR_W = SIDECAR_W_CONST;

  const showSidecar = toolbarOpen;
  const DIALOG_WIDTH = showSidecar ? fullDialogW : combinedW;
  const dialogLeft = Math.max(0, Math.floor((tw - combinedW) / 2));

  const subIndent = " ".repeat(Math.floor((DIALOG_WIDTH - 2 - subOuterW) / 2));

  // Center dialog in the full terminal — matches Options dialog positioning
  const dialogTopScreen = Math.max(0, Math.floor((th - DIALOG_HEIGHT) / 2));

  // Real toolbar vertical position (for arrow alignment)
  const toolbarStackHeight = TOOLBAR_BUTTON_LABELS.length * 3;
  const realToolbarTopPad = Math.max(0, Math.floor((th - 3 - toolbarStackHeight) / 2));
  const toolbarTopScreen = 3 + realToolbarTopPad;

  // Border title
  const borderTitle = " Main Menu ";
  const borderTitleLeft = dialogLeft + Math.floor(DIALOG_WIDTH / 2) - Math.floor(borderTitle.length / 2);

  // Sidecar box attached to dialog's right edge with toolbar labels.
  // Position labels to match real toolbar button rows so arrows align at both ends.
  const sidecarLeft = dialogLeft + DIALOG_WIDTH - 1; // overlap right border of dialog
  const sidecarLabelTopPad = Math.max(0, toolbarTopScreen - (dialogTopScreen + 1));
  const sidecar = showSidecar ? (
    <box
      backgroundColor={theme.bgSurface}
      border={true}
      borderColor={theme.accent}
      borderStyle="rounded"
      flexDirection="column"
      height={DIALOG_HEIGHT}
      left={sidecarLeft}
      position="absolute"
      top={dialogTopScreen}
      width={SIDECAR_W}
      zIndex={20}
    >
      <box height={sidecarLabelTopPad} />
      {TOOLBAR_BUTTON_LABELS.map((label, idx) => (
        <box alignItems="center" height={3} justifyContent="center" key={`sidecar-${idx}`}>
          <text content={label} fg={theme.textSecondary} />
        </box>
      ))}
    </box>
  ) : null;

  const arrowStartCol = sidecarLeft + SIDECAR_W;
  const arrowEndCol = tw - TOOLBAR_WIDTH + 1;
  const toolbarLeftCol = tw - TOOLBAR_WIDTH;
  const toolbarArrows =
    showSidecar && arrowEndCol > arrowStartCol
      ? TOOLBAR_BUTTON_LABELS.flatMap((_, idx) => {
          const buttonScreenRow = toolbarTopScreen + idx * 3 + 1;
          const dimLen = toolbarLeftCol - arrowStartCol;
          const accentLen = arrowEndCol - toolbarLeftCol;
          if (accentLen <= 0) return [];
          return [
            ...(dimLen > 0
              ? [
                  <text
                    content={"─".repeat(dimLen)}
                    fg={theme.textDim}
                    key={`arrow-${idx}`}
                    left={arrowStartCol}
                    position="absolute"
                    top={buttonScreenRow}
                    zIndex={21}
                  />,
                ]
              : []),
            <text
              content={"─".repeat(accentLen)}
              fg={theme.accent}
              key={`arrow-accent-${idx}`}
              left={toolbarLeftCol}
              position="absolute"
              top={buttonScreenRow}
              zIndex={22}
            />,
            <text
              content="□"
              fg={theme.accent}
              key={`arrow-head-${idx}`}
              left={arrowEndCol}
              position="absolute"
              top={buttonScreenRow}
              zIndex={22}
            />,
          ];
        })
      : null;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <box height="100%" left={0} position="absolute" top={0} width="100%" zIndex={19}>
      {/* backdrop */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onClose();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />

      {/* dialog */}
      <box
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={DIALOG_HEIGHT}
        id="honeyshots:main-menu"
        left={dialogLeft}
        position="absolute"
        top={dialogTopScreen}
        width={DIALOG_WIDTH}
        zIndex={20}
      >
        <box height={1} />
        {/* Tab bar */}
        <box flexDirection="row" gap={2} height={1} justifyContent="center">
          {MAIN_MENU_TAB_ORDER.map((t) => {
            const active = t === mainMenuTab;
            return (
              <text
                attributes={active ? TextAttributes.BOLD : 0}
                bg={active ? theme.accent : theme.textDim}
                content={` ${MAIN_MENU_TAB_LABELS[t]} `}
                fg={active ? theme.bgSurface : theme.text}
                key={t}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onTabChange(t);
                }}
              />
            );
          })}
        </box>
        <box height={1} />

        {/* hotkey sub-box */}
        <box flexDirection="row" height={1}>
          <text content={subIndent} />
          <text content={subTop} fg={theme.textDim} />
        </box>
        {mainMenuTab === "about" ? (
          Array.from({ length: ABOUT_ROWS }, (_, idx) => (
            <box flexDirection="row" height={1} key={idx}>
              <text content={subIndent} />
              {idx < aboutLineCount ? (
                aboutRow(idx)
              ) : (
                <>
                  <text content="│" fg={theme.textDim} />
                  <text content={" ".repeat(subInnerW)} />
                  <text content="│" fg={theme.textDim} />
                </>
              )}
            </box>
          ))
        ) : (
          <>
            {Array.from({ length: BOX_CONTENT_ROWS }, (_, idx) => {
              // Functions tab: rows shifted up (no top padding), zoom row at bottom
              const isFuncTab = mainMenuTab === "functions";
              const isAgentsTab = mainMenuTab === "agents";
              const hasRow = isFuncTab
                ? idx < FUNC_ROWS || idx === FUNC_ROWS + 1
                : isAgentsTab
                  ? idx === agentTopPad || (idx >= agentTopPad + 2 && idx - agentTopPad - 2 < AGENT_ROWS)
                  : (idx >= navTopPad && idx < navTopPad + navPrevNextCount) ||
                    idx === navTopPad + navPrevNextCount + 1;
              const rowEl = hasRow
                ? isFuncTab
                  ? idx < FUNC_ROWS
                    ? funcRow(idx)
                    : zoomRow()
                  : isAgentsTab
                    ? idx === agentTopPad
                      ? agentHeaderRow()
                      : agentRow(idx - agentTopPad - 2)
                    : idx < navTopPad + navPrevNextCount
                      ? navRow(idx - navTopPad)
                      : navRow(effectiveNavPairs.length - 1)
                : null;
              const emptyRow = hasDivider ? (
                <>
                  <text content="│" fg={theme.textDim} />
                  <text content={" ".repeat(colDivPos)} />
                  <text content="│" fg={theme.textDim} />
                  <text content={" ".repeat(subInnerW - colDivPos - 1)} />
                  <text content="│" fg={theme.textDim} />
                </>
              ) : (
                <>
                  <text content="│" fg={theme.textDim} />
                  <text content={" ".repeat(subInnerW)} />
                  <text content="│" fg={theme.textDim} />
                </>
              );
              return (
                <box flexDirection="row" height={1} key={idx}>
                  <text content={subIndent} />
                  {rowEl ?? emptyRow}
                </box>
              );
            })}
            <box flexDirection="row" height={1}>
              <text content={subIndent} />
              <text content={subSep} fg={theme.textDim} />
            </box>
            <box flexDirection="row" height={1}>
              <text content={subIndent} />
              {cfgRowEl}
            </box>
          </>
        )}
        <box flexDirection="row" height={1}>
          <text content={subIndent} />
          <text content={subBot} fg={theme.textDim} />
        </box>

        {/* navigation hints */}
        <box flexDirection="row" gap={1} height={1} justifyContent="center">
          {capturing ? (
            <>
              <text content="esc" fg={theme.accent} />
              <text content="cancel" fg={theme.textDim} />
            </>
          ) : (
            <>
              {mainMenuTab !== "about" && (
                <>
                  <text content="↑↓←→" fg={theme.accent} />
                  <text content="nav" fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              <text content="tab" fg={theme.accent} />
              <text content="switch page" fg={theme.textDim} />
              <text content=" " />
              {mainMenuTab !== "about" && (
                <>
                  <text content="↵" fg={theme.accent} />
                  <text content="map" fg={theme.textDim} />
                </>
              )}
              {mainMenuTab !== "about" && (
                <>
                  <text content=" del" fg={theme.accent} />
                  <text content="unmap" fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              {mainMenuTab === "functions" && (
                <>
                  <text attributes={TextAttributes.UNDERLINE} content="A‑Z" fg={theme.accent} />
                  <text content="exec" fg={theme.textDim} />
                  <text content=" " />
                </>
              )}
              <text content="esc" fg={theme.accent} />
              <text content="close" fg={theme.textDim} />
            </>
          )}
        </box>
      </box>

      {/* sidecar: toolbar labels attached to dialog right edge */}
      {sidecar}

      {/* Border title overlay */}
      <text
        bg={theme.bgSurface}
        content={borderTitle}
        fg={theme.textBright}
        left={borderTitleLeft}
        position="absolute"
        top={dialogTopScreen}
        zIndex={21}
      />

      {/* Bottom border hint overlay */}
      {(() => {
        const mainMenuCombo = formatBinding(keybindings.mainMenu);
        if (!mainMenuCombo) return null;
        const hintText = ` press ${mainMenuCombo.toLowerCase()} again to send to terminal `;
        const hintLeft = dialogLeft + Math.floor(DIALOG_WIDTH / 2) - Math.floor(hintText.length / 2);
        return (
          <text
            bg={theme.bgSurface}
            content={hintText}
            fg={theme.textDim}
            left={hintLeft}
            position="absolute"
            top={dialogTopScreen + DIALOG_HEIGHT - 1}
            zIndex={21}
          />
        );
      })()}

      {/* horizontal arrows to toolbar buttons */}
      {toolbarArrows}
    </box>
  );
}

/** Shared dialog width for Main Menu and Options dialogs. Grows when terminal is wide enough to show full key bindings. */
export function getDialogCombinedW(termWidth: number): number {
  const extra = Math.min(MAX_BIND_W - MIN_BIND_W, Math.max(0, Math.floor((termWidth - BASE_TERM_W) / 2)));
  return BASE_COMBINED_W + extra * 2;
}
