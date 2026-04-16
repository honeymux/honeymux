import { useEffect, useRef, useState } from "react";

import { isDismissKey } from "../util/keybindings.ts";

// ANSI escape sequences for arrow keys
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
const ARROW_RIGHT = "\x1b[C";
const ARROW_LEFT = "\x1b[D";

interface UseDropdownKeyboardOptions {
  /** When set, enables grid navigation: left/right move within a row of this many columns. */
  columns?: number;
  /** Indices that should be skipped during keyboard navigation (e.g. disabled items). */
  disabledIndices?: ReadonlySet<number>;
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  /** Index to focus when the dropdown opens. Defaults to 0. Disabled indices advance to the next enabled item. */
  initialIndex?: number;
  isOpen: boolean;
  itemCount: number;
  onClose: () => void;
  onLeft?: (index: number) => void;
  onRight?: (index: number) => void;
  onSelect: (index: number) => void;
}

/**
 * Reusable hook for dropdown keyboard navigation.
 * Manages focusedIndex state and registers a handler on dropdownInputRef
 * so the input router can dispatch keystrokes to the dropdown.
 *
 * - Up/Down arrows move focusedIndex (wrapping)
 * - Enter calls onSelect(focusedIndex)
 * - Escape calls onClose()
 * - All input is consumed while open (prevents PTY leakage)
 */
export function useDropdownKeyboard({
  columns,
  disabledIndices,
  dropdownInputRef,
  initialIndex,
  isOpen,
  itemCount,
  onClose,
  onLeft,
  onRight,
  onSelect,
}: UseDropdownKeyboardOptions): { focusedIndex: number; setFocusedIndex: (i: number) => void } {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const initialIndexRef = useRef(initialIndex);
  initialIndexRef.current = initialIndex;

  // Use refs for callbacks to avoid stale closures
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onRightRef = useRef(onRight);
  onRightRef.current = onRight;
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;
  const disabledRef = useRef(disabledIndices);
  disabledRef.current = disabledIndices;

  // Advance index in a direction, skipping disabled indices. Returns the
  // original index if every item is disabled (shouldn't happen in practice).
  const advance = (from: number, delta: number, count: number): number => {
    const disabled = disabledRef.current;
    if (!disabled || disabled.size === 0) return (((from + delta) % count) + count) % count;
    let next = from;
    for (let i = 0; i < count; i++) {
      next = (((next + delta) % count) + count) % count;
      if (!disabled.has(next)) return next;
    }
    return from;
  };

  // Reset focused index when dropdown opens, skipping disabled items
  useEffect(() => {
    if (!isOpen) return;
    const disabled = disabledRef.current;
    const requested = initialIndexRef.current;
    const start = requested != null && requested >= 0 && requested < itemCount ? requested : 0;
    if (disabled && disabled.has(start)) {
      const next = advance(start, 1, itemCount);
      setFocusedIndex(next);
    } else {
      setFocusedIndex(start);
    }
  }, [isOpen]);

  // Register/unregister handler on the shared ref
  useEffect(() => {
    if (!isOpen) return;

    const handler = (data: string): boolean => {
      const count = itemCountRef.current;
      if (count === 0) return true;

      const cols = columnsRef.current;
      if (cols) {
        // Grid navigation mode
        if (data === ARROW_UP) {
          const next = focusedRef.current - cols;
          if (next >= 0) {
            focusedRef.current = next;
            setFocusedIndex(next);
          }
          return true;
        }
        if (data === ARROW_DOWN) {
          const next = focusedRef.current + cols;
          if (next < count) {
            focusedRef.current = next;
            setFocusedIndex(next);
          }
          return true;
        }
        if (data === ARROW_RIGHT) {
          const next = (focusedRef.current + 1) % count;
          focusedRef.current = next;
          setFocusedIndex(next);
          return true;
        }
        if (data === ARROW_LEFT) {
          const next = (focusedRef.current - 1 + count) % count;
          focusedRef.current = next;
          setFocusedIndex(next);
          return true;
        }
      } else {
        // List navigation mode
        if (data === ARROW_UP) {
          const next = advance(focusedRef.current, -1, count);
          focusedRef.current = next;
          setFocusedIndex(next);
          return true;
        }
        if (data === ARROW_DOWN) {
          const next = advance(focusedRef.current, 1, count);
          focusedRef.current = next;
          setFocusedIndex(next);
          return true;
        }
        if (data === ARROW_RIGHT) {
          onRightRef.current?.(focusedRef.current);
          return true;
        }
        if (data === ARROW_LEFT) {
          onLeftRef.current?.(focusedRef.current);
          return true;
        }
      }
      if (data === "\r" || data === "\n") {
        dropdownInputRef.current = null; // eagerly clear before callback
        onSelectRef.current(focusedRef.current);
        return true;
      }
      if (isDismissKey(data)) {
        dropdownInputRef.current = null; // eagerly clear before callback
        onCloseRef.current();
        return true;
      }

      // Consume all other input while dropdown is open
      return true;
    };

    dropdownInputRef.current = handler;
    return () => {
      // Only clear if we're still the registered handler
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [isOpen, dropdownInputRef]);

  return { focusedIndex, setFocusedIndex };
}
