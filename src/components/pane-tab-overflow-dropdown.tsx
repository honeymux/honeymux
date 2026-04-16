import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useRef } from "react";

import type { PaneTab } from "../app/pane-tabs/types.ts";
import type { PaneTabsApi } from "../app/pane-tabs/use-pane-tabs.ts";

import { theme } from "../themes/theme.ts";
import { fitToWidth, stringWidth, stripNonPrintingControlChars, truncateToWidth } from "../util/text.ts";
import { DropdownFrame } from "./dropdown-shell.tsx";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

interface PaneTabOverflowDropdownProps {
  dropdownInputRef?: React.MutableRefObject<((data: string) => boolean) | null>;
  paneTabsApi: PaneTabsApi;
  width: number;
}

export function PaneTabOverflowDropdown({ dropdownInputRef, paneTabsApi, width }: PaneTabOverflowDropdownProps) {
  const { closePaneTabOverflow, handleSwitchPaneTab, paneTabGroups, paneTabOverflow } = paneTabsApi;

  const group = paneTabOverflow ? paneTabGroups.get(paneTabOverflow.slotKey) : undefined;

  const allTabs = group?.tabs ?? [];
  const visibleCount = paneTabOverflow?.visibleCount ?? 0;
  const overflowTabs = computeOverflowTabs(allTabs, visibleCount, group?.activeIndex ?? 0);

  // Store original indices in a ref so the callback stays stable
  const overflowIndicesRef = useRef<number[]>([]);
  overflowIndicesRef.current = overflowTabs.map((e) => e.originalIndex);

  const handleSelect = useCallback(
    (index: number) => {
      const origIdx = overflowIndicesRef.current[index];
      if (!group || origIdx === undefined) return;
      handleSwitchPaneTab(group.slotKey, origIdx);
      closePaneTabOverflow();
    },
    [group, handleSwitchPaneTab, closePaneTabOverflow],
  );

  const handleClose = useCallback(() => {
    closePaneTabOverflow();
  }, [closePaneTabOverflow]);

  const overflowDropdownInputRef = useRef<((data: string) => boolean) | null>(null);

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef: overflowDropdownInputRef,
    isOpen: !!paneTabOverflow && !!group && overflowTabs.length > 0,
    itemCount: overflowTabs.length,
    onClose: handleClose,
    onSelect: handleSelect,
  });

  // Wire input through the shared dropdownInputRef
  useEffect(() => {
    if (!paneTabOverflow || !group || !dropdownInputRef) return;
    const handler = (data: string): boolean => {
      return overflowDropdownInputRef.current?.(data) ?? true;
    };
    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [paneTabOverflow, group, dropdownInputRef]);

  if (!paneTabOverflow || !group || overflowTabs.length === 0) return null;

  const maxNameLen = Math.max(...overflowTabs.map((e) => stringWidth(stripNonPrintingControlChars(e.tab.label))), 0);
  const itemWidth = Math.max(Math.min(maxNameLen + 6, 40), 20);
  const menuWidth = itemWidth + 2;
  const menuLeft = Math.max(0, Math.min(paneTabOverflow.screenX - 1, width - menuWidth));
  const menuTop = paneTabOverflow.screenY;

  return (
    <DropdownFrame
      height={Math.min(overflowTabs.length, 20) + 2}
      left={menuLeft}
      onClickOutside={closePaneTabOverflow}
      top={menuTop}
      width={menuWidth}
      zIndex={60}
    >
      {overflowTabs.map(({ originalIndex, tab }, i) => {
        const isFocused = i === focusedIndex;
        const isActive = originalIndex === group.activeIndex;
        const bg = isFocused ? theme.bgFocused : theme.bgSurface;
        const itemFg = isActive ? theme.accent : isFocused ? theme.textBright : theme.text;
        const prefix = isFocused ? " ▸ " : "   ";
        const safeLabel = stripNonPrintingControlChars(tab.label);
        const displayName = truncateToWidth(safeLabel, itemWidth - 4);
        return (
          <text
            bg={bg}
            content={fitToWidth(prefix + displayName, itemWidth)}
            fg={itemFg}
            key={tab.paneId}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) handleSelect(i);
            }}
          />
        );
      })}
    </DropdownFrame>
  );
}

/** Compute which tabs are NOT visible in the border (overflow tabs only).
 *  Mirrors the active-tab swap from buildBorderFormat: when the active tab
 *  is in the overflow region it's swapped into the last visible slot, pushing
 *  the tab that was there into the overflow set. */
function computeOverflowTabs(
  allTabs: PaneTab[],
  visibleCount: number,
  activeIndex: number,
): { originalIndex: number; tab: PaneTab }[] {
  const hasSwap = visibleCount < allTabs.length && activeIndex >= visibleCount;
  const result: { originalIndex: number; tab: PaneTab }[] = [];
  for (let i = 0; i < allTabs.length; i++) {
    const isVisible = hasSwap ? i < visibleCount - 1 || i === activeIndex : i < visibleCount;
    if (!isVisible) {
      result.push({ originalIndex: i, tab: allTabs[i]! });
    }
  }
  return result;
}
