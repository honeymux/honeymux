import type { MouseEvent } from "@opentui/core";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import type { Base16SchemeName, RGB } from "../themes/theme.ts";

import {
  BASE16_SCHEME_NAMES,
  getSchemePaletteColors,
  hsvToRgb,
  isBright,
  paletteColors,
  rgbToHex,
  theme,
} from "../themes/theme.ts";
import { isDismissKey } from "../util/keybindings.ts";
import { DropdownFrame, DropdownSeparator } from "./dropdown-shell.tsx";

interface WheelCell {
  bg: string;
  char: string;
  color: null | string;
  fg: string;
}

// ---------------------------------------------------------------------------
// Color wheel rendering
// ---------------------------------------------------------------------------

function buildWheelGrid(diameter: number, bgHex: string): WheelCell[][] {
  const radius = diameter / 2;
  const termRows = Math.ceil(diameter / 2);
  const rows: WheelCell[][] = [];

  for (let row = 0; row < termRows; row++) {
    const cells: WheelCell[] = [];
    const topVR = row * 2;
    const botVR = row * 2 + 1;

    for (let col = 0; col < diameter; col++) {
      const top = wheelPixelColor(col, topVR, radius, bgHex);
      const bot = wheelPixelColor(col, botVR, radius, bgHex);

      if (top.inCircle && bot.inCircle) {
        cells.push({ bg: bot.hex, char: "▀", color: top.hex, fg: top.hex });
      } else if (top.inCircle) {
        cells.push({ bg: bgHex, char: "▀", color: top.hex, fg: top.hex });
      } else if (bot.inCircle) {
        cells.push({ bg: bgHex, char: "▄", color: bot.hex, fg: bot.hex });
      } else {
        cells.push({ bg: bgHex, char: " ", color: null, fg: bgHex });
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** Pick black or white foreground for maximum contrast against a hex background. */
function contrastFg(hex: string): string {
  return isBright(hex) ? "#000000" : "#ffffff";
}

function wheelPixelColor(
  col: number,
  virtualRow: number,
  radius: number,
  bgHex: string,
): { hex: string; inCircle: boolean } {
  const cx = col + 0.5 - radius;
  const cy = virtualRow + 0.5 - radius;
  const dist = Math.sqrt(cx * cx + cy * cy);
  if (dist > radius) return { hex: bgHex, inCircle: false };
  const hue = ((Math.atan2(-cy, cx) * 180) / Math.PI + 360) % 360;
  const sat = Math.min(dist / radius, 1);
  const rgb = hsvToRgb(hue, sat, 1.0);
  return { hex: rgbToHex(rgb), inCircle: true };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE_COLS = 8;
const SWATCH_WIDTH = 5;
export const COLOR_PICKER_MIN_WIDTH = SWATCH_WIDTH * PALETTE_COLS + 4; // 44 (content + padding + border)
const SCHEME_OPTIONS: readonly ("current" | Base16SchemeName)[] = ["current", ...BASE16_SCHEME_NAMES] as const;

const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
const ARROW_RIGHT = "\x1b[C";
const ARROW_LEFT = "\x1b[D";

interface ColorPickerProps {
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  onClose: () => void;
  onSelect: (color: null | string) => void;
  selectedColor?: null | string;
  width: number;
}

type FocusSection = "palette" | "reset" | "scheme" | "value";

// ---------------------------------------------------------------------------
// ColorPicker component
// ---------------------------------------------------------------------------

export function ColorPicker({
  dropdownInputRef,
  onClose,
  onSelect,
  selectedColor,
  width: dropdownWidth,
}: ColorPickerProps) {
  const effectiveWidth = Math.max(dropdownWidth, COLOR_PICKER_MIN_WIDTH);
  const itemWidth = effectiveWidth - 2;
  const contentWidth = itemWidth - 2; // 1-col padding each side

  // --- Wheel/slider sizing ---
  const wheelDiameter = Math.min(contentWidth, 24);
  const valueSteps = wheelDiameter;

  // --- State ---
  const [schemeIndex, setSchemeIndex] = useState(0);
  const [focusSection, setFocusSection] = useState<FocusSection>("palette");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [valueIndex, setValueIndex] = useState(valueSteps - 1);

  // --- Refs for handler closure ---
  const schemeIndexRef = useRef(schemeIndex);
  schemeIndexRef.current = schemeIndex;
  const focusSectionRef = useRef(focusSection);
  focusSectionRef.current = focusSection;
  const paletteIndexRef = useRef(paletteIndex);
  paletteIndexRef.current = paletteIndex;
  const valueIndexRef = useRef(valueIndex);
  valueIndexRef.current = valueIndex;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // --- Scheme palette colors ---
  const currentScheme = SCHEME_OPTIONS[schemeIndex]!;
  const displayColors: RGB[] = useMemo(() => {
    if (currentScheme === "current") return paletteColors.map((c) => [...c] as RGB);
    return getSchemePaletteColors(currentScheme);
  }, [currentScheme]);

  const displayColorsRef = useRef(displayColors);
  displayColorsRef.current = displayColors;

  // --- Keyboard handler ---
  useEffect(() => {
    const handler = (data: string): boolean => {
      const section = focusSectionRef.current;
      const pIdx = paletteIndexRef.current;
      const sIdx = schemeIndexRef.current;

      if (section === "scheme") {
        if (data === ARROW_LEFT) {
          const next = (sIdx - 1 + SCHEME_OPTIONS.length) % SCHEME_OPTIONS.length;
          schemeIndexRef.current = next;
          setSchemeIndex(next);
          return true;
        }
        if (data === ARROW_RIGHT) {
          const next = (sIdx + 1) % SCHEME_OPTIONS.length;
          schemeIndexRef.current = next;
          setSchemeIndex(next);
          return true;
        }
        if (data === ARROW_DOWN) {
          focusSectionRef.current = "palette";
          setFocusSection("palette");
          return true;
        }
        if (data === ARROW_UP) {
          focusSectionRef.current = "reset";
          setFocusSection("reset");
          return true;
        }
        if (data === "\r" || data === "\n") {
          focusSectionRef.current = "palette";
          setFocusSection("palette");
          return true;
        }
      } else if (section === "palette") {
        if (data === ARROW_LEFT) {
          const next = (pIdx - 1 + 16) % 16;
          paletteIndexRef.current = next;
          setPaletteIndex(next);
          return true;
        }
        if (data === ARROW_RIGHT) {
          const next = (pIdx + 1) % 16;
          paletteIndexRef.current = next;
          setPaletteIndex(next);
          return true;
        }
        if (data === ARROW_UP) {
          if (pIdx < PALETTE_COLS) {
            focusSectionRef.current = "scheme";
            setFocusSection("scheme");
          } else {
            const next = pIdx - PALETTE_COLS;
            paletteIndexRef.current = next;
            setPaletteIndex(next);
          }
          return true;
        }
        if (data === ARROW_DOWN) {
          if (pIdx >= PALETTE_COLS) {
            focusSectionRef.current = "value";
            setFocusSection("value");
          } else {
            const next = pIdx + PALETTE_COLS;
            paletteIndexRef.current = next;
            setPaletteIndex(next);
          }
          return true;
        }
        if (data === "\r" || data === "\n") {
          dropdownInputRef.current = null;
          onSelectRef.current(rgbToHex(displayColorsRef.current[pIdx]!));
          return true;
        }
      } else if (section === "value") {
        if (data === ARROW_LEFT) {
          const next = Math.max(0, valueIndexRef.current - 1);
          valueIndexRef.current = next;
          setValueIndex(next);
          return true;
        }
        if (data === ARROW_RIGHT) {
          const next = Math.min(valueSteps - 1, valueIndexRef.current + 1);
          valueIndexRef.current = next;
          setValueIndex(next);
          return true;
        }
        if (data === ARROW_UP) {
          focusSectionRef.current = "palette";
          setFocusSection("palette");
          if (paletteIndexRef.current < PALETTE_COLS) {
            const next = paletteIndexRef.current + PALETTE_COLS;
            paletteIndexRef.current = next;
            setPaletteIndex(next);
          }
          return true;
        }
        if (data === ARROW_DOWN) {
          focusSectionRef.current = "reset";
          setFocusSection("reset");
          return true;
        }
        if (data === "\r" || data === "\n") {
          dropdownInputRef.current = null;
          onSelectRef.current(greyAtIndex(valueIndexRef.current, valueSteps));
          return true;
        }
      } else if (section === "reset") {
        if (data === ARROW_UP) {
          focusSectionRef.current = "value";
          setFocusSection("value");
          return true;
        }
        if (data === ARROW_DOWN) {
          focusSectionRef.current = "scheme";
          setFocusSection("scheme");
          return true;
        }
        if (data === "\r" || data === "\n") {
          dropdownInputRef.current = null;
          onSelectRef.current(null);
          return true;
        }
      }

      if (isDismissKey(data)) {
        dropdownInputRef.current = null;
        onCloseRef.current();
        return true;
      }

      // Consume all input while open
      return true;
    };

    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) dropdownInputRef.current = null;
    };
  }, [dropdownInputRef]);

  // --- Wheel layout ---
  const wheelTermRows = Math.ceil(wheelDiameter / 2);
  const wheelPadLeft = Math.floor((contentWidth - wheelDiameter) / 2);

  const wheelGrid = useMemo(() => buildWheelGrid(wheelDiameter, theme.bgSurface), [wheelDiameter]);

  // Height: scheme(1) + sep(1) + palette(2) + sep(1) + wheel(wheelTermRows) + pad(1) + slider(1) + pad(1) + sep(1) + reset(1) + border(2)
  const dropdownHeight = 1 + 1 + 2 + 1 + wheelTermRows + 1 + 1 + 1 + 1 + 1 + 2;

  const paletteRows = [displayColors.slice(0, 8), displayColors.slice(8, 16)];

  // --- Scheme selector layout ---
  const arrowColWidth = 3; // " ◂ " / " ▸ "
  const nameSpace = contentWidth - arrowColWidth * 2;
  const schemeName = formatSchemeName(SCHEME_OPTIONS[schemeIndex]!);
  const truncName = schemeName.length > nameSpace ? schemeName.slice(0, nameSpace) : schemeName;
  const namePadL = Math.floor((nameSpace - truncName.length) / 2);
  const namePadR = nameSpace - namePadL - truncName.length;
  const schemeFocused = focusSection === "scheme";
  const schemeBg = schemeFocused ? theme.bgFocused : theme.bgSurface;

  return (
    <DropdownFrame height={dropdownHeight} id="honeyshots:color-picker" onClickOutside={onClose} width={effectiveWidth}>
      {/* Scheme selector */}
      <box flexDirection="row" height={1} width={itemWidth}>
        <text bg={theme.bgSurface} content=" " selectable={false} />
        <text
          bg={schemeBg}
          content=" ◂ "
          fg={schemeFocused ? theme.accent : theme.textDim}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) {
              const next = (schemeIndex - 1 + SCHEME_OPTIONS.length) % SCHEME_OPTIONS.length;
              setSchemeIndex(next);
              setFocusSection("scheme");
            }
          }}
          selectable={false}
        />
        <text
          bg={schemeBg}
          content={" ".repeat(namePadL) + truncName + " ".repeat(namePadR)}
          fg={schemeFocused ? theme.textBright : theme.text}
          selectable={false}
        />
        <text
          bg={schemeBg}
          content=" ▸ "
          fg={schemeFocused ? theme.accent : theme.textDim}
          onMouseDown={(event: MouseEvent) => {
            if (event.button === 0) {
              const next = (schemeIndex + 1) % SCHEME_OPTIONS.length;
              setSchemeIndex(next);
              setFocusSection("scheme");
            }
          }}
          selectable={false}
        />
        <text bg={theme.bgSurface} content=" " selectable={false} />
      </box>

      {/* Separator */}
      <DropdownSeparator width={itemWidth} />

      {/* Palette swatches */}
      {paletteRows.map((row, rowIdx) => (
        <box flexDirection="row" height={1} key={`p${rowIdx}`} width={itemWidth}>
          <text bg={theme.bgSurface} content=" " selectable={false} />
          {row.map((rgb, colIdx) => {
            const idx = rowIdx * PALETTE_COLS + colIdx;
            const hex = rgbToHex(rgb);
            const isFocused = focusSection === "palette" && idx === paletteIndex;
            const isSelected = selectedColor === hex;
            const handleClick = (event: MouseEvent) => {
              if (event.button === 0) onSelect(hex);
            };

            if (isFocused) {
              const leftW = Math.floor(SWATCH_WIDTH / 2);
              const rightW = SWATCH_WIDTH - leftW - 1;
              return (
                <Fragment key={idx}>
                  <text
                    bg={theme.bgFocused}
                    content={"█".repeat(leftW)}
                    fg={hex}
                    onMouseDown={handleClick}
                    selectable={false}
                  />
                  <text bg={hex} content="▸" fg={contrastFg(hex)} onMouseDown={handleClick} selectable={false} />
                  <text
                    bg={theme.bgFocused}
                    content={"█".repeat(rightW)}
                    fg={hex}
                    onMouseDown={handleClick}
                    selectable={false}
                  />
                </Fragment>
              );
            }

            const content = isSelected
              ? "▐" + "█".repeat(Math.max(0, SWATCH_WIDTH - 2)) + "▌"
              : "█".repeat(SWATCH_WIDTH);
            return (
              <text
                bg={isSelected ? theme.textBright : theme.bgSurface}
                content={content}
                fg={hex}
                key={idx}
                onMouseDown={handleClick}
                selectable={false}
              />
            );
          })}
          <text bg={theme.bgSurface} content=" " selectable={false} />
        </box>
      ))}

      {/* Separator */}
      <DropdownSeparator width={itemWidth} />

      {/* Color wheel (mouse-only) */}
      {wheelGrid.map((row, rowIdx) => (
        <box flexDirection="row" height={1} key={`w${rowIdx}`} width={itemWidth}>
          <text bg={theme.bgSurface} content=" " selectable={false} />
          {wheelPadLeft > 0 && <text bg={theme.bgSurface} content={" ".repeat(wheelPadLeft)} selectable={false} />}
          {row.map((cell, colIdx) => (
            <text
              bg={cell.bg}
              content={cell.char}
              fg={cell.fg}
              key={colIdx}
              onMouseDown={
                cell.color
                  ? (event: MouseEvent) => {
                      if (event.button === 0) onSelect(cell.color!);
                    }
                  : undefined
              }
              selectable={false}
            />
          ))}
          <text
            bg={theme.bgSurface}
            content={"".padEnd(Math.max(0, contentWidth - wheelPadLeft - wheelDiameter))}
            selectable={false}
          />
          <text bg={theme.bgSurface} content=" " selectable={false} />
        </box>
      ))}

      {/* Padding above slider */}
      <box flexDirection="row" height={1} width={itemWidth}>
        <text bg={theme.bgSurface} content={" ".repeat(itemWidth)} selectable={false} />
      </box>

      {/* Grey ramp (click any cell to pick that grey) */}
      <box flexDirection="row" height={1} width={itemWidth}>
        <text bg={theme.bgSurface} content=" " selectable={false} />
        {wheelPadLeft > 0 && <text bg={theme.bgSurface} content={" ".repeat(wheelPadLeft)} selectable={false} />}
        {Array.from({ length: valueSteps }, (_, i) => {
          const grey = greyAtIndex(i, valueSteps);
          const sliderFocused = focusSection === "value";
          const isCursor = sliderFocused && i === valueIndex;
          const handleSliderClick = (event: MouseEvent) => {
            if (event.button === 0) onSelect(grey);
          };
          return (
            <text
              bg={isCursor ? theme.accent : theme.bgSurface}
              content={isCursor ? "▀" : "█"}
              fg={grey}
              key={i}
              onMouseDown={handleSliderClick}
              selectable={false}
            />
          );
        })}
        <text
          bg={theme.bgSurface}
          content={"".padEnd(Math.max(0, contentWidth - wheelPadLeft - wheelDiameter))}
          selectable={false}
        />
        <text bg={theme.bgSurface} content=" " selectable={false} />
      </box>

      {/* Padding below slider */}
      <box flexDirection="row" height={1} width={itemWidth}>
        <text bg={theme.bgSurface} content={" ".repeat(itemWidth)} selectable={false} />
      </box>

      {/* Separator */}
      <DropdownSeparator width={itemWidth} />

      {/* "Reset to Default" button */}
      {(() => {
        const isFocused = focusSection === "reset";
        const label = " Reset to Default ";
        const padL = Math.max(0, Math.floor((contentWidth - label.length) / 2));
        const padR = Math.max(0, contentWidth - padL - label.length);
        return (
          <box flexDirection="row" height={1} width={itemWidth}>
            <text bg={theme.bgSurface} content=" " selectable={false} />
            <text bg={theme.bgSurface} content={" ".repeat(padL)} selectable={false} />
            <text
              bg={isFocused ? theme.accent : theme.textDim}
              content={label}
              fg={isFocused ? theme.bgSurface : theme.textBright}
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0) onSelect(null);
              }}
              selectable={false}
            />
            <text bg={theme.bgSurface} content={" ".repeat(padR)} selectable={false} />
            <text bg={theme.bgSurface} content=" " selectable={false} />
          </box>
        );
      })()}
    </DropdownFrame>
  );
}

function formatSchemeName(name: string): string {
  if (name === "current") return "Current Theme";
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function greyAtIndex(i: number, steps: number): string {
  const v = steps <= 1 ? 1 : i / (steps - 1);
  return rgbToHex(hsvToRgb(0, 0, v));
}

