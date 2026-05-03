import type { MouseEvent } from "@opentui/core";

import { useEffect } from "react";

import { theme } from "../themes/theme.ts";

/** Absolute-positioned rounded box at top=3, right=1 with zIndex=10.
 *  Internally renders a DropdownBackdrop (zIndex 9) + the positioned box (zIndex 10). */
export function DropdownFrame({
  backgroundColor = theme.bgSurface,
  children,
  height,
  id,
  left,
  onClickOutside,
  opaqueTopRow = false,
  right,
  top = 3,
  width,
  zIndex = 10,
}: {
  backgroundColor?: string;
  children: React.ReactNode;
  height: number;
  id?: string;
  left?: number;
  onClickOutside: () => void;
  opaqueTopRow?: boolean;
  right?: number;
  top?: number;
  width: number;
  zIndex?: number;
}) {
  const resolvedRight = left === undefined ? (right ?? 1) : undefined;
  const topBorder = `╭${"─".repeat(Math.max(0, width - 2))}╮`;
  return (
    <>
      <DropdownBackdrop onClickOutside={onClickOutside} zIndex={Math.max(0, zIndex - 1)} />
      <box
        backgroundColor={backgroundColor}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={height}
        id={id}
        left={left}
        position="absolute"
        right={resolvedRight}
        top={top}
        width={width}
        zIndex={zIndex}
      >
        {opaqueTopRow && (
          <>
            <text
              bg={backgroundColor}
              content={" ".repeat(width)}
              left={0}
              position="absolute"
              selectable={false}
              top={0}
              width={width}
            />
            <text
              bg={backgroundColor}
              content={topBorder}
              fg={theme.accent}
              left={0}
              position="absolute"
              selectable={false}
              top={0}
            />
          </>
        )}
        {children}
      </box>
    </>
  );
}

/** Title + focused textarea + hint row (the "create/rename/save" input panel). */
export function DropdownInputPanel({
  hint,
  initialValue,
  itemWidth,
  onSubmit,
  placeholder,
  textareaRef,
  title,
}: {
  hint: string;
  initialValue?: string;
  itemWidth: number;
  onSubmit: () => void;
  placeholder?: string;
  textareaRef: React.RefObject<any>;
  title: string;
}) {
  useEffect(() => {
    if (initialValue) {
      textareaRef.current?.gotoBufferEnd();
    }
  }, []);

  return (
    <>
      <text bg={theme.bgSurface} content={title.padEnd(itemWidth)} fg={theme.textBright} selectable={false} />
      <box backgroundColor={theme.bgSurface} flexDirection="row" height={1} width={itemWidth}>
        <text bg={theme.bgSurface} content=" " selectable={false} />
        <textarea
          backgroundColor={theme.bgSurface}
          focused={true}
          focusedBackgroundColor={theme.bgSurface}
          focusedTextColor={theme.text}
          height={1}
          initialValue={initialValue}
          keyBindings={[{ action: "submit", name: "return" }]}
          onSubmit={onSubmit}
          placeholder={placeholder}
          placeholderColor={theme.textDim}
          ref={textareaRef}
          textColor={theme.text}
          width={itemWidth - 1}
        />
      </box>
      <text
        bg={theme.bgSurface}
        content={hint.slice(0, itemWidth).padEnd(itemWidth)}
        fg={theme.textDim}
        selectable={false}
      />
    </>
  );
}

/** Horizontal separator line. */
export function DropdownSeparator({ width }: { width: number }) {
  return <text content={(" " + "─".repeat(width - 2) + " ").slice(0, width)} fg={theme.border} />;
}

/** Full-screen backdrop that calls onClickOutside on left-click. */
function DropdownBackdrop({ onClickOutside, zIndex = 9 }: { onClickOutside: () => void; zIndex?: number }) {
  return (
    <box
      height="100%"
      left={0}
      onMouseDown={(event: MouseEvent) => {
        if (event.button === 0) onClickOutside();
      }}
      position="absolute"
      top={0}
      width="100%"
      zIndex={zIndex}
    />
  );
}
