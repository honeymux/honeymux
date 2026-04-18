import type { MutableRefObject } from "react";

import { type MouseEvent, TextAttributes } from "@opentui/core";
import { useEffect, useRef } from "react";

import type { HistoryEntry } from "../agents/history-search.ts";

import { compileHistorySearchMatcher } from "../agents/history-search-query.ts";
import { AGENT_COLORS } from "../agents/types.ts";
import { theme } from "../themes/theme.ts";
import {
  fitToWidth,
  midTruncatePath,
  padEndToWidth,
  splitAtColumn,
  stringWidth,
  stripNonPrintingControlChars,
  truncateToWidth,
} from "../util/text.ts";
import { DropdownFrame } from "./dropdown-shell.tsx";

interface ConversationsDialogProps {
  caseSensitiveSearch: boolean;
  closeMenu: () => void;
  cursor: number;
  focusedIndex: number;
  hasMoreResults: boolean;
  menuFocusedIndex: number;
  menuOpen: boolean;
  menuToggleRef?: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onFocusIndex: (index: number) => void;
  onMenuItemSelect: (index: number) => void;
  onNavigateDown: () => void;
  onNavigateUp: () => void;
  onSelect: (entry: HistoryEntry) => void;
  onToggleMenu: () => void;
  query: string;
  regexSearch: boolean;
  resultOffset: number;
  results: HistoryEntry[];
  searchError?: string;
  termHeight: number;
  termWidth: number;
  totalResults: number;
}

export function ConversationsDialog({
  caseSensitiveSearch,
  closeMenu,
  cursor,
  focusedIndex,
  hasMoreResults,
  menuFocusedIndex,
  menuOpen,
  menuToggleRef,
  onClose,
  onFocusIndex,
  onMenuItemSelect,
  onNavigateDown,
  onNavigateUp,
  onSelect,
  onToggleMenu,
  query,
  regexSearch,
  resultOffset,
  results,
  searchError,
  termHeight,
  termWidth,
  totalResults,
}: ConversationsDialogProps) {
  // Register/unregister menu toggle on the shared ref so the activateMenu
  // hotkey can reach this dialog's hamburger menu from the keyboard router.
  useEffect(() => {
    if (!menuToggleRef) return;
    menuToggleRef.current = onToggleMenu;
    return () => {
      if (menuToggleRef.current) menuToggleRef.current = null;
    };
  }, [menuToggleRef, onToggleMenu]);

  // Double-click detection: track last click slot and time
  const lastClickRef = useRef<{ slot: number; time: number }>({ slot: -1, time: 0 });
  const DOUBLE_CLICK_MS = 400;

  // 80% of terminal, min 78 wide
  const dialogWidth = Math.min(termWidth - 2, Math.max(78, Math.floor(termWidth * 0.85)));
  const innerWidth = dialogWidth - 2;
  const resultRowWidth = Math.max(0, innerWidth - 1);
  const textIndent = 2;
  const textWidth = resultRowWidth - textIndent;

  // Constrain to pane content area (below 3-row tab bar, above 1-row status bar)
  const paneTop = 3;
  const paneHeight = termHeight - 4;
  // 80% of terminal height, min 22
  const dialogHeight = Math.max(22, Math.floor(termHeight * 0.85));
  const dialogTop = paneTop + Math.max(0, Math.floor((paneHeight - dialogHeight) / 2));
  const dialogLeft = Math.floor((termWidth - dialogWidth) / 2);
  const menuItems = buildConversationsMenuItems(caseSensitiveSearch, regexSearch);
  const menuItemWidth = Math.min(innerWidth - 2, Math.max(24, ...menuItems.map((item) => stringWidth(item) + 4)));
  const menuWidth = menuItemWidth + 2;
  const menuTop = dialogTop + 1;
  const menuLeft = dialogLeft + dialogWidth - menuWidth - 1;
  const hamburgerLabel = menuOpen ? "▸≡ " : " ≡ ";
  const hamburgerLeft = dialogLeft + dialogWidth - stringWidth(hamburgerLabel) - 2;
  const searchMatcher = compileHistorySearchMatcher(query, {
    caseSensitive: caseSensitiveSearch,
    regex: regexSearch,
  });

  // Chrome: 2 borders + 1 query + 2 seps + 1 status + 1 hint = 7
  const resultAreaRows = dialogHeight - 7;

  // Reserve room for at least one other 3-row entry alongside the focused item.
  // Extra -1 to account for possible project line on the focused item.
  const maxFocusedTextLines = Math.max(1, resultAreaRows - 6);

  // Item height: unfocused = 3 or 4 (with project), focused = header + text + project? + sep
  function itemHeight(idx: number): number {
    if (idx < 0 || idx >= results.length) return 3;
    const entry = results[idx]!;
    const hasProject = !!entry.project;
    if (idx !== focusedIndex) return hasProject ? 4 : 3;
    const lines = wrapLines(entry.text, textWidth);
    return (hasProject ? 3 : 2) + Math.min(lines.length, maxFocusedTextLines);
  }

  // Calculate scroll offset to keep focused item visible
  let scrollOffset = 0;
  if (results.length > 0) {
    // Walk forward until the focused item fits in view
    while (scrollOffset < focusedIndex) {
      let usedRows = 0;
      for (let i = scrollOffset; i <= focusedIndex; i++) {
        usedRows += itemHeight(i);
      }
      if (usedRows <= resultAreaRows) break;
      scrollOffset++;
    }
  }

  // Query display — styled as a distinct input field, with a visible cursor
  // at `cursor` (codepoint index). The query is horizontally scrolled so the
  // cursor stays in view for long queries.
  const queryPrompt = "> ";
  const queryField = buildConversationsQueryField(query, cursor, innerWidth - stringWidth(queryPrompt));
  const statusLine = buildConversationsStatusLine(results.length, totalResults, hasMoreResults, innerWidth);
  const statusColor = getConversationsStatusColor(searchError);

  // Build result rows filling exactly resultAreaRows
  const resultRows: React.ReactNode[] = [];
  let rowsUsed = 0;
  let slot = scrollOffset;

  while (rowsUsed < resultAreaRows && slot < results.length) {
    const entry = results[slot]!;
    const isFocused = slot === focusedIndex;
    const bg = isFocused ? theme.bgFocused : theme.bgSurface;
    const agentColor = AGENT_COLORS[entry.agentType] ?? theme.text;
    const age = formatConversationTimestamp(entry.timestamp);
    const rawProject = entry.project
      ? stripNonPrintingControlChars(entry.project.replace(process.env.HOME ?? "", "~"))
      : "";

    // Header row: agent name, centered session id, right-aligned age
    const focusMark = isFocused ? "\u25b6 " : "  ";
    const agentPart = `${focusMark}${entry.agentType}`;
    const idText = entry.sessionId ?? "";
    const rightPart = age;
    if (rowsUsed >= resultAreaRows) break;
    const entrySlot = slot;
    const handleEntryClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const now = Date.now();
      const last = lastClickRef.current;
      if (last.slot === entrySlot && now - last.time < DOUBLE_CLICK_MS) {
        // Double-click: open/resume
        lastClickRef.current = { slot: -1, time: 0 };
        onSelect(entry);
      } else {
        // Single click: focus
        lastClickRef.current = { slot: entrySlot, time: now };
        onFocusIndex(entrySlot);
      }
    };
    if (idText) {
      const row = buildConversationsHeaderParts(agentPart, idText, rightPart, resultRowWidth);
      resultRows.push(
        <box flexDirection="row" height={1} key={`${slot}-h`} onMouseDown={handleEntryClick}>
          <text bg={bg} content={row.left} fg={agentColor} selectable={false} />
          <text bg={bg} content={row.center} fg={theme.textDim} selectable={false} />
          <text bg={bg} content={row.right} fg={agentColor} selectable={false} />
          <text bg={bg} content=" " selectable={false} />
        </box>,
      );
    } else {
      const row = buildConversationsHeaderParts(agentPart, "", rightPart, resultRowWidth);
      const row1 = fitToWidth(row.left + row.right, resultRowWidth) + " ";
      resultRows.push(
        <text
          bg={bg}
          content={row1}
          fg={agentColor}
          key={`${slot}-h`}
          onMouseDown={handleEntryClick}
          selectable={false}
        />,
      );
    }
    rowsUsed++;

    // Text rows — build highlight mask on the full text, then slice per line
    const cleanText = stripNonPrintingControlChars(entry.text).replace(/\n/g, " ");
    const textMask = searchMatcher.buildHighlightMask(cleanText);

    if (isFocused) {
      const lines = wrapLines(cleanText, textWidth);
      const maxLines = Math.min(lines.length, maxFocusedTextLines, resultAreaRows - rowsUsed - (rawProject ? 2 : 1));
      const truncated = lines.length > maxLines;
      let charOffset = 0;
      for (let li = 0; li < maxLines; li++) {
        let lineText = lines[li]!;
        const lineLen = lineText.length;
        // Last visible line of a truncated entry: replace end with " …"
        if (truncated && li === maxLines - 1 && lineLen >= 2) {
          lineText = lineText.slice(0, lineLen - 2) + " …";
        }
        const lineMask = [
          ...new Array(textIndent).fill(false),
          ...textMask.slice(charOffset, charOffset + lineLen),
          ...new Array(Math.max(0, resultRowWidth - textIndent - lineLen)).fill(false),
          false,
        ];
        // Clear highlight on the " …" suffix so it's visually distinct
        if (truncated && li === maxLines - 1 && lineLen >= 2) {
          for (let k = textIndent + lineLen - 2; k < textIndent + lineLen; k++) {
            if (k < lineMask.length) lineMask[k] = false;
          }
        }
        const padded = fitToWidth(" ".repeat(textIndent) + lineText, resultRowWidth) + " ";
        resultRows.push(renderHighlightedLine(padded, lineMask, theme.text, bg, `${slot}-t${li}`, handleEntryClick));
        charOffset += lines[li]!.length;
        rowsUsed++;
      }
    } else {
      if (rowsUsed < resultAreaRows) {
        const preview = cleanText.slice(0, textWidth);
        const lineMask = [
          ...new Array(textIndent).fill(false),
          ...textMask.slice(0, preview.length),
          ...new Array(Math.max(0, resultRowWidth - textIndent - preview.length)).fill(false),
          false,
        ];
        const row2 = fitToWidth(" ".repeat(textIndent) + preview, resultRowWidth) + " ";
        resultRows.push(renderHighlightedLine(row2, lineMask, theme.text, bg, `${slot}-t`, handleEntryClick));
        rowsUsed++;
      }
    }

    // Project/folder row (own line, mid-truncated)
    if (rawProject && rowsUsed < resultAreaRows) {
      const label = entry.agentType === "gemini" ? "Project: " : "Folder: ";
      const projectDisplay = midTruncatePath(rawProject, textWidth - label.length);
      const projectRow = fitToWidth(" ".repeat(textIndent) + label + projectDisplay, resultRowWidth) + " ";
      resultRows.push(
        <text
          bg={bg}
          content={projectRow}
          fg={theme.textDim}
          key={`${slot}-p`}
          onMouseDown={handleEntryClick}
          selectable={false}
        />,
      );
      rowsUsed++;
    }

    // Separator row
    if (rowsUsed < resultAreaRows) {
      const isLast = slot >= results.length - 1;
      const sep = isLast
        ? " ".repeat(innerWidth)
        : " ".repeat(textIndent) + "\u2500".repeat(Math.max(0, resultRowWidth - textIndent)) + " ";
      resultRows.push(<text bg={theme.bgSurface} content={sep} fg={theme.border} key={`${slot}-s`} />);
      rowsUsed++;
    }
    slot++;
  }

  // Empty state
  if (results.length === 0 && rowsUsed < resultAreaRows) {
    const msg = searchError
      ? `  Invalid regex: ${searchError}`
      : query.trim()
        ? "  No results found"
        : "  No conversation history found";
    resultRows.push(
      <text
        bg={theme.bgSurface}
        content={fitToWidth(msg, innerWidth)}
        fg={searchError ? statusColor : theme.textDim}
        key="empty-msg"
      />,
    );
    rowsUsed++;
  }

  // Fill remaining rows
  while (rowsUsed < resultAreaRows) {
    resultRows.push(<text bg={theme.bgSurface} content={" ".repeat(innerWidth)} key={`pad-${rowsUsed}`} />);
    rowsUsed++;
  }

  return (
    <>
      {/* Backdrop */}
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
      {/* Dialog */}
      <box
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={dialogHeight}
        id="honeyshots:conversations"
        left={dialogLeft}
        onMouse={(event: MouseEvent) => {
          if (!event.scroll || results.length === 0) return;
          if (event.scroll.direction === "up") {
            onNavigateUp();
          } else if (event.scroll.direction === "down") {
            onNavigateDown();
          }
        }}
        position="absolute"
        top={dialogTop}
        width={dialogWidth}
        zIndex={20}
      >
        {/* Query input */}
        <box flexDirection="row" height={1}>
          <text bg={theme.bgFocused} content={queryPrompt} fg={theme.accent} />
          <text bg={theme.bgFocused} content={queryField.before} fg={theme.textBright} />
          <text bg={theme.textBright} content={queryField.atCursor} fg={theme.bgFocused} />
          <text bg={theme.bgFocused} content={queryField.after} fg={theme.textBright} />
        </box>
        {/* Separator */}
        <text bg={theme.bgSurface} content={"\u2500".repeat(innerWidth)} fg={theme.border} />
        {/* Results */}
        {resultRows}
        {/* Separator */}
        <text bg={theme.bgSurface} content={"\u2500".repeat(innerWidth)} fg={theme.border} />
        {/* Status */}
        <text bg={theme.bgSurface} content={statusLine} fg={theme.textDim} />
        {/* Hint */}
        <box flexDirection="row" gap={1} height={1} justifyContent="center">
          <text content="↑↓" fg={theme.accent} />
          <text content="nav" fg={theme.textDim} />
          <text content=" " />
          <text content="pgup/dn" fg={theme.accent} />
          <text content="page" fg={theme.textDim} />
          <text content=" " />
          <text content="tab" fg={theme.accent} />
          <text content="menu" fg={theme.textDim} />
          <text content=" " />
          <text content="enter" fg={theme.accent} />
          <text content="open" fg={theme.textDim} />
          <text content=" " />
          <text content="esc" fg={theme.accent} />
          <text content="close" fg={theme.textDim} />
        </box>
      </box>
      {/* Border label centered on top border */}
      <text
        bg={theme.bgSurface}
        content={" Conversations "}
        fg={theme.textBright}
        left={dialogLeft + Math.floor((dialogWidth - stringWidth(" Conversations ")) / 2)}
        position="absolute"
        selectable={false}
        top={dialogTop}
        zIndex={21}
      />
      <text
        bg={theme.bgSurface}
        content={hamburgerLabel}
        fg={theme.accent}
        left={hamburgerLeft}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) onToggleMenu();
        }}
        position="absolute"
        selectable={false}
        top={dialogTop}
        zIndex={23}
      />
      {menuOpen && (
        <DropdownFrame
          height={menuItems.length + 2}
          left={menuLeft}
          onClickOutside={closeMenu}
          top={menuTop}
          width={menuWidth}
          zIndex={22}
        >
          {menuItems.map((item, index) => {
            const focused = index === menuFocusedIndex;
            const prefix = focused ? " ▸ " : "   ";
            return (
              <text
                bg={focused ? theme.bgFocused : theme.bgSurface}
                content={fitToWidth(prefix + item, menuItemWidth)}
                fg={focused ? theme.textBright : theme.text}
                key={item}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onMenuItemSelect(index);
                }}
                selectable={false}
              />
            );
          })}
        </DropdownFrame>
      )}
      {/* Position indicator on bottom border */}
      {results.length > 0 &&
        (() => {
          const label = buildConversationsPositionLabel(focusedIndex, totalResults, resultOffset);
          return (
            <text
              bg={theme.bgSurface}
              content={label}
              fg={theme.accent}
              left={dialogLeft + dialogWidth - stringWidth(label) - 2}
              position="absolute"
              selectable={false}
              top={dialogTop + dialogHeight - 1}
              zIndex={21}
            />
          );
        })()}
    </>
  );
}

export function buildConversationsMenuItems(caseSensitiveSearch: boolean, regexSearch: boolean): string[] {
  return [`[${caseSensitiveSearch ? "x" : " "}] Case-sensitive search`, `[${regexSearch ? "x" : " "}] Regex search`];
}

export function buildConversationsPositionLabel(
  focusedIndex: number,
  totalResults: number,
  resultOffset: number,
): string {
  const absolutePosition = totalResults <= 0 ? 0 : Math.min(totalResults, resultOffset + focusedIndex + 1);
  return ` ${absolutePosition}/${totalResults} `;
}

/**
 * Lay out the query field around a cursor position so the cursor cell stays
 * visible even when the query exceeds the field width. Widths are measured in
 * terminal cells; `cursor` is a codepoint index in [0, codepoints(query)].
 *
 * Returns three pieces: text before the cursor, the single cell under the
 * cursor (rendered inverted by the caller), and text after the cursor padded
 * to fill the remaining field width.
 */
export function buildConversationsQueryField(
  query: string,
  cursor: number,
  availWidth: number,
): { after: string; atCursor: string; before: string } {
  if (availWidth <= 0) return { after: "", atCursor: "", before: "" };
  const cps = [...query];
  const cursorCp = Math.max(0, Math.min(cps.length, cursor));
  const beforeText = cps.slice(0, cursorCp).join("");
  const atText = cps[cursorCp] ?? " ";
  const afterText = cps.slice(cursorCp + 1).join("");
  const atWidth = Math.max(1, stringWidth(atText));

  // If the cursor cell itself is wider than the field there is nothing we can
  // show without clipping the cursor; fall back to a single-space cursor.
  if (atWidth >= availWidth) {
    return { after: "", atCursor: " ", before: "" };
  }

  const beforeWidth = stringWidth(beforeText);
  const scroll = Math.max(0, beforeWidth + atWidth - availWidth);
  const [, visibleBeforeRaw] = splitAtColumn(beforeText, scroll);
  const visibleBeforeWidth = stringWidth(visibleBeforeRaw);
  const remainingForAfter = Math.max(0, availWidth - visibleBeforeWidth - atWidth);
  const visibleAfterRaw = truncateToWidth(afterText, remainingForAfter);
  const visibleAfterWidth = stringWidth(visibleAfterRaw);
  const paddingWidth = Math.max(0, availWidth - visibleBeforeWidth - atWidth - visibleAfterWidth);

  return {
    after: visibleAfterRaw + " ".repeat(paddingWidth),
    atCursor: atText,
    before: visibleBeforeRaw,
  };
}

export function buildConversationsStatusLine(shown: number, total: number, hasMore: boolean, width: number): string {
  const noun = total === 1 ? "conversation" : "conversations";
  const status = ` Showing ${shown} of ${total} ${noun}${hasMore ? "  ↓ loads more" : ""}`;
  return fitToWidth(status, width);
}

export function formatConversationTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours24 = date.getHours();
  const hour12 = hours24 % 12 || 12;
  const hours = String(hour12).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  return `${year}/${month}/${day} ${hours}:${minutes}${meridiem}`;
}

export function getConversationsStatusColor(searchError?: string): string {
  return searchError ? theme.statusError : theme.textDim;
}

function buildConversationsHeaderParts(
  agentPart: string,
  idText: string,
  rightPart: string,
  width: number,
): { center: string; left: string; right: string } {
  const rightWidth = stringWidth(rightPart);
  if (!idText) {
    const leftWidth = Math.max(0, width - rightWidth);
    return {
      center: "",
      left: padEndToWidth(truncateToWidth(agentPart, leftWidth), leftWidth),
      right: rightPart,
    };
  }

  const minPadWidth = 1;
  const availableIdWidth = Math.max(0, width - stringWidth(agentPart) - rightWidth - minPadWidth * 2);
  const safeIdText = truncateToWidth(idText, availableIdWidth);
  const freeWidth = Math.max(0, width - stringWidth(agentPart) - stringWidth(safeIdText) - rightWidth);
  let leftPad = Math.floor(freeWidth / 2);
  let rightPad = freeWidth - leftPad;

  if (leftPad < minPadWidth) {
    const deficit = minPadWidth - leftPad;
    leftPad = minPadWidth;
    rightPad = Math.max(minPadWidth, rightPad - deficit);
  }
  if (rightPad < minPadWidth) {
    const deficit = minPadWidth - rightPad;
    rightPad = minPadWidth;
    leftPad = Math.max(minPadWidth, leftPad - deficit);
  }

  return {
    center: safeIdText,
    left: agentPart + " ".repeat(leftPad),
    right: " ".repeat(rightPad) + rightPart,
  };
}

/** Render a single line with highlight segments driven by a pre-built mask. */
function renderHighlightedLine(
  content: string,
  mask: boolean[],
  fg: string,
  bg: string,
  key: string,
  onMouseDown?: (event: MouseEvent) => void,
): React.ReactNode {
  if (!mask.some(Boolean)) {
    return <text bg={bg} content={content} fg={fg} key={key} onMouseDown={onMouseDown} selectable={false} />;
  }
  const segments: React.ReactNode[] = [];
  let si = 0;
  let i = 0;
  while (i < content.length) {
    const hl = mask[i]!;
    let j = i + 1;
    while (j < content.length && mask[j] === hl) j++;
    const slice = content.slice(i, j);
    if (hl) {
      segments.push(
        <text
          attributes={TextAttributes.UNDERLINE}
          bg={bg}
          content={slice}
          fg={theme.statusWarning}
          key={`${key}-${si++}`}
        />,
      );
    } else {
      segments.push(<text bg={bg} content={slice} fg={fg} key={`${key}-${si++}`} />);
    }
    i = j;
  }
  if (segments.length <= 1) {
    return (
      segments[0] ?? <text bg={bg} content={content} fg={fg} key={key} onMouseDown={onMouseDown} selectable={false} />
    );
  }
  return (
    <box flexDirection="row" height={1} key={key} onMouseDown={onMouseDown}>
      {segments}
    </box>
  );
}

function wrapLines(text: string, width: number): string[] {
  const clean = text.replace(/\n/g, " ");
  if (clean.length === 0) return [""];
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += width) {
    lines.push(clean.slice(i, i + width));
  }
  return lines;
}
