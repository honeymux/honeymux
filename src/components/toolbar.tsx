import type { MouseEvent } from "@opentui/core";

import { type MutableRefObject, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { TmuxKeyBindings } from "../tmux/types.ts";

import { theme } from "../themes/theme.ts";

const FLASH_MS = 150;
const HINT_STEP_MS = 166;

interface ToolBarProps {
  /** Bottom offset (3 for marquee-bottom, 0 otherwise). */
  bottomOffset?: number;
  /** Formatted display string for the user's "bufferZoom" keybinding. */
  bufferZoomBinding?: string;
  /** Ref that external code (e.g. keyboard activation) can call to trigger a flash on a button. */
  flashTriggerRef?: MutableRefObject<((index: number) => void) | null>;
  focused?: boolean;
  focusedIndex?: number;
  height: number;
  keyBindings?: TmuxKeyBindings | null;
  onBufferZoom: () => void;
  onClosePane: () => void;
  onDetach: () => void;
  onMobileToggle?: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  /** Show key hints inline next to toolbar buttons. */
  tmuxKeyBindingHints?: boolean;
  /** Top offset (3 for full/marquee-top, 0 for raw/marquee-bottom). */
  topOffset?: number;
}

export const TOOLBAR_WIDTH = 7;

export function ToolBar({
  bottomOffset = 0,
  bufferZoomBinding,
  flashTriggerRef,
  focused: toolbarFocused,
  focusedIndex,
  height,
  keyBindings,
  onBufferZoom,
  onClosePane,
  onDetach,
  onMobileToggle,
  onSplitHorizontal,
  onSplitVertical,
  tmuxKeyBindingHints,
  topOffset = 3,
}: ToolBarProps) {
  const [flashIndex, setFlashIndex] = useState<null | number>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerFlash = useCallback((buttonIndex: number) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashIndex(buttonIndex);
    flashTimerRef.current = setTimeout(() => setFlashIndex(null), FLASH_MS);
  }, []);

  useEffect(() => {
    if (flashTriggerRef) flashTriggerRef.current = triggerFlash;
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (flashTriggerRef) flashTriggerRef.current = null;
    };
  }, [triggerFlash, flashTriggerRef]);

  // --- Inline hint fade state ---
  const [inlineHint, setInlineHint] = useState<{ buttonIndex: number; text: string } | null>(null);
  const [hintColorIdx, setHintColorIdx] = useState(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintStepRef = useRef(0);

  const showInlineHint = useCallback((text: string, buttonIndex: number) => {
    // Clear any existing hint timer
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setInlineHint({ buttonIndex, text });
    setHintColorIdx(0);
    hintStepRef.current = 0;

    const tick = () => {
      hintStepRef.current++;
      if (hintStepRef.current >= theme.hintFadeSequence.length) {
        setInlineHint(null);
        return;
      }
      setHintColorIdx(hintStepRef.current);
      hintTimerRef.current = setTimeout(tick, HINT_STEP_MS);
    };
    hintTimerRef.current = setTimeout(tick, HINT_STEP_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  // Build per-button hint texts
  const mobileHintText = onMobileToggle ? undefined : keyBindings?.closePane;
  const bufferZoomHintText = bufferZoomBinding || "unmapped";

  const buttonHintTexts: (string | undefined)[] = [
    keyBindings?.splitVertical,
    keyBindings?.splitHorizontal,
    bufferZoomHintText,
    mobileHintText,
    undefined,
  ];

  const withHint = (action: () => void, buttonIndex: number) => () => {
    if (tmuxKeyBindingHints) {
      const hintText = buttonHintTexts[buttonIndex];
      if (hintText) showInlineHint(hintText, buttonIndex);
    }
    triggerFlash(buttonIndex);
    action();
  };

  const buttons: { action: () => void; symbol: string }[] = [
    { action: withHint(onSplitVertical, 0), symbol: "│" },
    { action: withHint(onSplitHorizontal, 1), symbol: "─" },
    { action: withHint(onBufferZoom, 2), symbol: "⌕" },
    {
      action: onMobileToggle ? withHint(onMobileToggle, 3) : withHint(onClosePane, 3),
      symbol: "\u25AE",
    },
    { action: withHint(onDetach, 4), symbol: "⏏" },
  ];

  const toolbarTop = topOffset;
  const toolbarHeight = height - topOffset - bottomOffset;
  const innerWidth = TOOLBAR_WIDTH;
  const innerHeight = toolbarHeight;
  const stackHeight = buttons.length * 3;
  const topPad = Math.max(0, Math.floor((innerHeight - stackHeight) / 2));
  const bottomPad = innerHeight - topPad - stackHeight;

  const isFocusActive = toolbarFocused && focusedIndex != null && focusedIndex >= 0;

  // Build flat text rows for the toolbar interior
  const rows: { action?: () => void; content: string; dimmed?: boolean; focused?: boolean }[] = [];
  for (let i = 0; i < topPad; i++) rows.push({ content: " ".repeat(innerWidth) });
  for (let bi = 0; bi < buttons.length; bi++) {
    const btn = buttons[bi]!;
    const isFocused = isFocusActive && bi === focusedIndex;
    const dimmed = flashIndex === bi;
    if (isFocused) {
      rows.push({ action: btn.action, content: ` ╭───╮ `, dimmed, focused: true });
      rows.push({ action: btn.action, content: `▸│ ${btn.symbol} │ `, dimmed, focused: true });
      rows.push({ action: btn.action, content: ` ╰───╯ `, dimmed, focused: true });
    } else {
      rows.push({ action: btn.action, content: ` ╭───╮ `, dimmed });
      rows.push({ action: btn.action, content: ` │ ${btn.symbol} │ `, dimmed });
      rows.push({ action: btn.action, content: ` ╰───╯ `, dimmed });
    }
  }
  for (let i = 0; i < bottomPad; i++) rows.push({ content: " ".repeat(innerWidth) });

  // Compute inline hint element
  let hintElement: ReactNode = null;
  if (tmuxKeyBindingHints && inlineHint) {
    const hintContent = ` ${inlineHint.text} `;
    const hintWidth = hintContent.length;
    // Button center row: toolbarTop + topPad + buttonIndex * 3 + 1
    const hintTop = toolbarTop + topPad + inlineHint.buttonIndex * 3 + 1;
    const hintRight = TOOLBAR_WIDTH + 1;
    const color = theme.hintFadeSequence[hintColorIdx] ?? theme.hintFadeSequence[theme.hintFadeSequence.length - 1]!;
    hintElement = (
      <text
        bg={color}
        content={hintContent}
        fg={theme.textOnBright}
        position="absolute"
        right={hintRight}
        selectable={false}
        top={hintTop}
        width={hintWidth}
        zIndex={11}
      />
    );
  }

  return (
    <>
      <box
        backgroundColor={theme.bgChrome}
        flexDirection="column"
        height={toolbarHeight}
        id="honeyshots:toolbar"
        position="absolute"
        right={0}
        top={toolbarTop}
        width={TOOLBAR_WIDTH}
        zIndex={10}
      >
        {rows.map((row, i) => (
          <text
            bg={row.focused ? theme.bgFocused : theme.bgChrome}
            content={row.content}
            fg={row.dimmed ? theme.textDim : row.focused ? theme.textBright : theme.textSecondary}
            key={i}
            onMouseDown={
              row.action
                ? (event: MouseEvent) => {
                    if (event.button === 0) row.action!();
                  }
                : undefined
            }
          />
        ))}
      </box>
      {hintElement}
      {toolbarFocused &&
        (() => {
          const escLabel = " esc to unfocus ";
          // Vertically centered beside the buffer zoom button (index 2)
          const escTop = toolbarTop + topPad + 2 * 3 + 1;
          const escRight = TOOLBAR_WIDTH + 1;
          return (
            <text
              bg={theme.textBright}
              content={escLabel}
              fg={theme.bgChrome}
              position="absolute"
              right={escRight}
              selectable={false}
              top={escTop}
              width={escLabel.length}
              zIndex={11}
            />
          );
        })()}
    </>
  );
}
