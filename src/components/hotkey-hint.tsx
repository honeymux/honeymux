import { type MouseEvent, type RGBA, TextAttributes, parseColor } from "@opentui/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { useImperativeAnimation } from "../app/hooks/use-imperative-animation.ts";
import { theme } from "../themes/theme.ts";

// Fade in then out over ~1s
const STEP_MS = 166;

const SHIMMER_COLORS = ["#555555", "#777777", "#aaaaaa", "#dddddd", "#aaaaaa", "#777777"];
const SHIMMER_MS = 200;

// Cached parsed-color objects so the renderAfter path doesn't call
// parseColor on every paint.
const SHIMMER_RGBA: RGBA[] = SHIMMER_COLORS.map((hex) => parseColor(hex));

interface HotkeyHintProps {
  /** "center" (default) or "right" text alignment */
  align?: "center" | "right";
  /** Background color when colorMode="fg" */
  bg?: string;
  /** "bg" = fade color as background (default), "fg" = fade color as foreground text */
  colorMode?: "bg" | "fg";
  hint: null | string;
  /** Background color for idle content */
  idleBg?: string;
  /** Whether idle content is bold */
  idleBold?: boolean;
  /** Text shown when no transient hint is active */
  idleContent?: string;
  /** Foreground color for idle content */
  idleFg?: string;
  left?: number;
  /** Click handler for idle content */
  onIdleClick?: () => void;
  /** Continuously shimmer the idle content color */
  shimmer?: boolean;
  top: number;
  width: number;
}

/**
 * Imperative shimmer-animated idle text.  Uses useImperativeAnimation so
 * the color cycle repaints via a renderAfter callback instead of driving
 * a React re-render at 5 Hz.  Only the fg color changes per tick; all
 * other attributes (content, position, bg, bold) are stable.
 */
interface ShimmerIdleTextProps {
  bg: string | undefined;
  bold: boolean;
  content: string;
  left: number | undefined;
  onMouseDown?: (event: MouseEvent) => void;
  right: number | undefined;
  top: number;
  width: number;
}

/**
 * Renders a keybinding hint that fades in then out.
 * When no hint is active and idleContent is set, shows persistent idle text.
 * Positioned absolutely within the parent container.
 */
export function HotkeyHint({
  align = "center",
  bg,
  colorMode = "bg",
  hint,
  idleBg,
  idleBold,
  idleContent,
  idleFg,
  left,
  onIdleClick,
  shimmer,
  top,
  width,
}: HotkeyHintProps) {
  const [display, setDisplay] = useState<null | string>(null);
  const [colorIdx, setColorIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(0);

  // Shimmer animation is handled imperatively by <ShimmerIdleText> below —
  // it reads performance.now() in a renderAfter callback so the color cycle
  // doesn't trigger any React re-renders.  See useImperativeAnimation.

  // Skip initial mount — prevents stale hints from re-appearing when
  // the component remounts with the parent's old hint prop.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!hint) return;
    // Start new hint — strip unique key suffix used for re-triggering
    const text = hint.indexOf("\0") >= 0 ? hint.slice(0, hint.indexOf("\0")) : hint;
    setDisplay(text);
    setColorIdx(0);
    stepRef.current = 0;

    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current);

    const tick = () => {
      stepRef.current++;
      if (stepRef.current >= theme.hintFadeSequence.length) {
        setDisplay(null);
        return;
      }
      setColorIdx(stepRef.current);
      timerRef.current = setTimeout(tick, STEP_MS);
    };

    timerRef.current = setTimeout(tick, STEP_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hint]);

  // Pad text for alignment
  const padText = (text: string) => {
    if (align === "right") {
      const pl = Math.max(0, width - text.length - 1);
      return " ".repeat(pl) + text + " ";
    }
    const pl = Math.max(0, Math.floor((width - text.length) / 2));
    const pr = Math.max(0, width - pl - text.length);
    return " ".repeat(pl) + text + " ".repeat(pr);
  };

  // Show idle content when no transient hint is active
  if (!display) {
    if (!idleContent || width < idleContent.length + 2) return null;
    // When idleBg is set, render with tight width centered in the area
    // so the background only covers the text, not the full hint region.
    const tightContent = ` ${idleContent} `;
    const useContent = idleBg ? tightContent : padText(idleContent);
    const useWidth = idleBg ? tightContent.length : width;
    const useLeft = idleBg ? (left ?? 0) + Math.floor((width - tightContent.length) / 2) : left;
    const handleMouseDown = onIdleClick
      ? (event: MouseEvent) => {
          if (event.button === 0) onIdleClick();
        }
      : undefined;

    if (shimmer) {
      return (
        <ShimmerIdleText
          bg={idleBg}
          bold={!!idleBold}
          content={useContent}
          left={useLeft}
          onMouseDown={handleMouseDown}
          right={!idleBg && left == null ? 0 : undefined}
          top={top}
          width={useWidth}
        />
      );
    }

    return (
      <text
        attributes={idleBold ? TextAttributes.BOLD : undefined}
        bg={idleBg}
        content={useContent}
        fg={idleFg ?? theme.textDim}
        left={useLeft}
        onMouseDown={handleMouseDown}
        position="absolute"
        right={!idleBg && left == null ? 0 : undefined}
        selectable={false}
        top={top}
        width={useWidth}
      />
    );
  }

  const color = theme.hintFadeSequence[colorIdx] ?? theme.hintFadeSequence[theme.hintFadeSequence.length - 1]!;
  const padded = padText(display);
  const fgColor = colorMode === "fg" ? color : theme.textOnBright;
  const bgColor = colorMode === "fg" ? (bg ?? undefined) : color;

  return (
    <text
      bg={bgColor}
      content={padded}
      fg={fgColor}
      left={left}
      position="absolute"
      right={left == null ? 0 : undefined}
      selectable={false}
      top={top}
      width={width}
    />
  );
}

/**
 * Hook that manages hint state. Returns [currentHint, showHint].
 * Each call to showHint replaces the current hint and restarts the fade.
 * The hint value changes identity on each call to trigger the effect.
 */
export function useHotkeyHint(): [null | string, (hint: string) => void] {
  // Use a counter to ensure each trigger creates a new reference
  const [state, setState] = useState<{ key: number; text: string } | null>(null);
  const keyRef = useRef(0);

  const showHint = useCallback((text: string) => {
    keyRef.current++;
    setState({ key: keyRef.current, text });
  }, []);

  // Return a unique string per trigger so the effect re-fires
  const hint = state ? `${state.text}\0${state.key}` : null;
  return [hint, showHint];
}

function ShimmerIdleText({ bg, bold, content, left, onMouseDown, right, top, width }: ShimmerIdleTextProps) {
  const attributes = bold ? TextAttributes.BOLD : 0;
  const { ref, renderAfter } = useImperativeAnimation({
    // Shimmer is a constant-cadence color cycle — always refresh on the
    // SHIMMER_MS beat while mounted.
    getRefreshDelay: () => SHIMMER_MS,
    paint(buffer, state, now) {
      const idx = Math.floor(now / SHIMMER_MS) % SHIMMER_RGBA.length;
      const fg = SHIMMER_RGBA[idx] ?? SHIMMER_RGBA[0]!;
      // drawText writes the text into the buffer starting at this.x, this.y.
      // The bg parameter (optional) applies behind the text cells.
      const bgRgba = state.bg ? parseColor(state.bg) : undefined;
      buffer.drawText(state.content, this.x, this.y, fg, bgRgba, state.attributes);
    },
    state: { attributes, bg, content },
  });

  return (
    <box
      height={1}
      left={left}
      onMouseDown={onMouseDown}
      position="absolute"
      ref={ref}
      renderAfter={renderAfter}
      right={right}
      selectable={false}
      top={top}
      width={width}
    />
  );
}
