import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TmuxSession } from "../tmux/types.ts";

import { SESSION_PALETTE, theme } from "../themes/theme.ts";
import { fitToWidth, padEndToWidth, stringWidth, stripNonPrintingControlChars, truncateName } from "../util/text.ts";
import { COLOR_PICKER_MIN_WIDTH, ColorPicker } from "./color-picker.tsx";
import { DropdownFrame, DropdownInputPanel, DropdownSeparator } from "./dropdown-shell.tsx";
import {
  SESSION_DELETE_CONFIRM_DEFAULT_FOCUS,
  type SessionDeleteConfirmFocus,
  handleSessionDeleteConfirmInput,
} from "./session-dropdown-delete.ts";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

interface SessionDropdownProps {
  currentSession: string;
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  maxWidth: number;
  onClose: () => void;
  onCreateSession: (name: string) => void;
  onDeleteSession?: (name: string) => void;
  onGetSessionInfo?: (name: string) => Promise<{ paneTabsEnabled: number; panes: number; windows: number }>;
  onRenameSession?: (oldName: string, newName: string) => void;
  onSelect: (sessionName: string) => void;
  onSetSessionColor?: (sessionName: string, color: null | string) => void;
  onTextInputActive?: (active: boolean) => void;
  sessions: TmuxSession[];
}

export function SessionDropdown({
  currentSession,
  dropdownInputRef,
  maxWidth,
  onClose,
  onCreateSession,
  onDeleteSession,
  onGetSessionInfo,
  onRenameSession,
  onSelect,
  onSetSessionColor,
  onTextInputActive,
  sessions,
}: SessionDropdownProps) {
  const [mode, setMode] = useState<"color" | "confirm-delete" | "input" | "list" | "rename">("list");
  const [renameTarget, setRenameTarget] = useState("");
  const [deleteTarget, setDeleteTarget] = useState("");
  const [deleteInfo, setDeleteInfo] = useState<{ paneTabsEnabled: number; panes: number; windows: number } | null>(
    null,
  );
  const [deleteFocused, setDeleteFocused] = useState<SessionDeleteConfirmFocus>(SESSION_DELETE_CONFIRM_DEFAULT_FOCUS);
  const deleteFocusedRef = useRef(deleteFocused);
  deleteFocusedRef.current = deleteFocused;
  const [colorTarget, setColorTarget] = useState("");
  const [saveError, setSaveError] = useState("");
  const [focusedCol, setFocusedCol] = useState(0); // 0 = name, 1..N = icons
  const textareaRef = useRef<any>(null);

  // Sort sessions alphabetically (case-sensitive); hide internal __hmx- sessions
  const sortedSessions = useMemo(
    () => sessions.filter((s) => !s.name.startsWith("__hmx-")).sort((a, b) => a.name.localeCompare(b.name)),
    [sessions],
  );

  // Notify parent when text input mode changes
  useEffect(() => {
    onTextInputActive?.(mode === "input" || mode === "rename");
    return () => onTextInputActive?.(false);
  }, [mode]);

  // Build ordered list of icon actions
  type IconAction = "color" | "delete" | "name" | "pencil";
  const iconActions: IconAction[] = [];
  if (onSetSessionColor) iconActions.push("color");
  if (onRenameSession) iconActions.push("pencil");
  if (onDeleteSession) iconActions.push("delete");
  const maxCol = iconActions.length;

  const getColAction = (col: number): IconAction => {
    if (col === 0) return "name";
    return iconActions[col - 1] ?? "name";
  };

  const initiateDelete = useCallback(
    (name: string) => {
      setDeleteTarget(name);
      setDeleteInfo(null);
      setDeleteFocused(SESSION_DELETE_CONFIRM_DEFAULT_FOCUS);
      setMode("confirm-delete");
      onGetSessionInfo?.(name).then((info) => setDeleteInfo(info));
    },
    [onGetSessionInfo],
  );

  // Keyboard navigation in list mode
  // Items: sortedSessions[0..n-1] + "New session" at index n
  const handleKeySelect = useCallback(
    (index: number) => {
      const action = getColAction(focusedCol);
      if (index < sortedSessions.length) {
        const session = sortedSessions[index]!;
        if (action === "color") {
          setColorTarget(session.name);
          setMode("color");
          return;
        }
        if (action === "pencil") {
          setRenameTarget(session.name);
          setMode("rename");
          return;
        }
        if (action === "delete" && session.name !== currentSession) {
          initiateDelete(session.name);
          return;
        }
        onSelect(session.name);
      } else {
        setMode("input");
      }
    },
    [sortedSessions, onSelect, focusedCol, initiateDelete],
  );

  const effectiveMaxCol = useCallback(
    (index: number) => {
      if (index >= sortedSessions.length) return 0;
      const isActiveRow = sortedSessions[index]?.name === currentSession;
      return isActiveRow && iconActions.includes("delete") ? maxCol - 1 : maxCol;
    },
    [sortedSessions, currentSession, maxCol, iconActions],
  );

  const handleRight = useCallback(
    (index: number) => {
      const eff = effectiveMaxCol(index);
      if (eff > 0) {
        setFocusedCol((prev) => (prev + 1) % (eff + 1));
      }
    },
    [effectiveMaxCol],
  );

  const handleLeft = useCallback(
    (index: number) => {
      const eff = effectiveMaxCol(index);
      if (eff > 0) {
        setFocusedCol((prev) => (prev - 1 + eff + 1) % (eff + 1));
      }
    },
    [effectiveMaxCol],
  );

  const currentSessionIndex = useMemo(() => {
    const idx = sortedSessions.findIndex((s) => s.name === currentSession);
    return idx >= 0 ? idx : 0;
  }, [sortedSessions, currentSession]);

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef,
    initialIndex: currentSessionIndex,
    isOpen: mode === "list",
    itemCount: sortedSessions.length + 1,
    onClose,
    onLeft: handleLeft,
    onRight: handleRight,
    onSelect: handleKeySelect,
  });

  // Reset focusedCol when focusedIndex changes (arrow up/down)
  const prevFocusedIndex = useRef(focusedIndex);
  if (prevFocusedIndex.current !== focusedIndex) {
    prevFocusedIndex.current = focusedIndex;
    if (focusedCol !== 0) setFocusedCol(0);
  }

  // Max name length for display — leave room for prefix, swatch, icons, id, and borders
  const swatchReserve = onSetSessionColor ? 4 : 0; // " ●  "
  const nonColorIcons = iconActions.filter((a) => a !== "color").length;
  const iconReserve = nonColorIcons * 3; // " ✎ ", " ✕ "
  const maxIdLen = Math.max(...sortedSessions.map((s) => stringWidth(s.id)), 0);
  const idReserve = maxIdLen + 1; // " $1"
  const maxNameDisplay = Math.min(maxWidth - 5 - swatchReserve - iconReserve - idReserve, 40);
  const maxNameLen = Math.max(
    ...sortedSessions.map((s) => Math.min(stringWidth(stripNonPrintingControlChars(s.name)), maxNameDisplay)),
    0,
  );
  const minWidth = 32;
  const itemWidth = Math.max(maxNameLen + 4 + swatchReserve + iconReserve + idReserve, minWidth - 2);
  const dropdownWidth = itemWidth + 2; // +2 for left/right borders

  if (mode === "input") {
    const inputHeight = 5;
    return (
      <DropdownFrame
        height={inputHeight}
        onClickOutside={() => {
          setSaveError("");
          setMode("list");
        }}
        width={dropdownWidth}
      >
        <DropdownInputPanel
          hint={saveError || " Enter ↵ create · Esc cancel"}
          itemWidth={itemWidth}
          onSubmit={() => {
            const text = textareaRef.current?.plainText?.trim() ?? "";
            if (text) {
              const validationError = isValidSessionName(text);
              if (validationError) {
                setSaveError(validationError);
                return;
              }
              if (sessions.some((s) => s.name === text)) {
                setSaveError(" Name already exists");
                return;
              }
            }
            setSaveError("");
            onCreateSession(text);
          }}
          placeholder="name (optional)"
          textareaRef={textareaRef}
          title=" New session"
        />
      </DropdownFrame>
    );
  }

  if (mode === "rename") {
    const inputHeight = 5;
    return (
      <DropdownFrame
        height={inputHeight}
        onClickOutside={() => {
          setSaveError("");
          setMode("list");
        }}
        width={dropdownWidth}
      >
        <DropdownInputPanel
          hint={saveError || " Enter ↵ rename · Esc cancel"}
          initialValue={stripNonPrintingControlChars(renameTarget)}
          itemWidth={itemWidth}
          onSubmit={() => {
            const text = textareaRef.current?.plainText?.trim() ?? "";
            if (text && text !== stripNonPrintingControlChars(renameTarget)) {
              const validationError = isValidSessionName(text);
              if (validationError) {
                setSaveError(validationError);
                return;
              }
              if (sessions.some((s) => s.name === text)) {
                setSaveError(" Name already exists");
                return;
              }
              setSaveError("");
              onRenameSession?.(renameTarget, text);
            } else {
              setMode("list");
            }
          }}
          textareaRef={textareaRef}
          title=" Rename session"
        />
      </DropdownFrame>
    );
  }

  if (mode === "confirm-delete") {
    dropdownInputRef.current = (data: string) => {
      const next = handleSessionDeleteConfirmInput(data, deleteFocusedRef.current);
      if (next.focused !== deleteFocusedRef.current) {
        setDeleteFocused(next.focused);
      }
      if (next.action === "delete") {
        onDeleteSession?.(deleteTarget);
        setMode("list");
        return true;
      }
      if (next.action === "close") {
        setMode("list");
        return true;
      }
      return true;
    };
    const truncatedTarget = truncateName(stripNonPrintingControlChars(deleteTarget), maxNameDisplay);
    let infoText = "loading...";
    if (deleteInfo) {
      const parts: string[] = [];
      parts.push(`${deleteInfo.windows} window${deleteInfo.windows !== 1 ? "s" : ""}`);
      parts.push(`${deleteInfo.panes} pane${deleteInfo.panes !== 1 ? "s" : ""}`);
      if (deleteInfo.paneTabsEnabled > 0) {
        parts.push(`${deleteInfo.paneTabsEnabled} pane tab${deleteInfo.paneTabsEnabled !== 1 ? "s" : ""}`);
      }
      infoText = parts.join(", ");
    }
    const message = `Delete "${truncatedTarget}"?`;
    const detail = ` ${infoText}`;
    const hintText = " ◂ ▸ select · Enter ↵ confirm";
    const confirmWidth = Math.max(stringWidth(message) + 4, stringWidth(detail) + 4, stringWidth(hintText) + 2, 20);
    const confirmHeight = 6;
    return (
      <DropdownFrame height={confirmHeight} onClickOutside={() => setMode("list")} width={confirmWidth}>
        <text content={padEndToWidth(` ${message}`, confirmWidth - 2)} fg={theme.text} selectable={false} />
        <text content={padEndToWidth(detail, confirmWidth - 2)} fg={theme.textDim} selectable={false} />
        <text content={padEndToWidth(hintText, confirmWidth - 2)} fg={theme.textDim} selectable={false} />
        <box flexDirection="row" height={1} width={confirmWidth - 2}>
          <text
            bg={deleteFocused === 0 ? theme.statusError : undefined}
            content="  Yes  "
            fg={deleteFocused === 0 ? theme.bgSurface : theme.statusError}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) {
                onDeleteSession?.(deleteTarget);
                setMode("list");
              }
            }}
          />
          <text
            bg={deleteFocused === 1 ? theme.bgFocused : undefined}
            content="  No  "
            fg={deleteFocused === 1 ? theme.textBright : theme.textSecondary}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) setMode("list");
            }}
          />
        </box>
      </DropdownFrame>
    );
  }

  if (mode === "color") {
    const session = sortedSessions.find((s) => s.name === colorTarget);
    return (
      <ColorPicker
        dropdownInputRef={dropdownInputRef}
        onClose={() => {
          setFocusedCol(0);
          setMode("list");
        }}
        onSelect={(color) => {
          onSetSessionColor?.(colorTarget, color);
          setFocusedCol(0);
          setMode("list");
        }}
        selectedColor={session?.color ?? null}
        width={COLOR_PICKER_MIN_WIDTH}
      />
    );
  }

  // List mode
  const separatorRow = 1;
  const newSessionRow = 1;
  const dropdownHeight = sortedSessions.length + separatorRow + newSessionRow + 2;

  return (
    <DropdownFrame
      height={dropdownHeight}
      id="honeyshots:session-dropdown"
      onClickOutside={onClose}
      width={dropdownWidth}
    >
      {sortedSessions.map((session, i) => {
        const isActive = session.name === currentSession;
        const isFocused = i === focusedIndex;
        const prefix = isFocused ? " ▸ " : "   ";
        const displayName = truncateName(stripNonPrintingControlChars(session.name), maxNameDisplay);
        const bg = isFocused ? theme.bgFocused : theme.bgSurface;
        const fg = isFocused ? theme.textBright : isActive ? theme.accent : theme.text;
        const namePartWidth = itemWidth - iconReserve;
        const swatchChar = onSetSessionColor ? " ●  " : "";
        const nameStr = prefix + swatchChar + displayName;
        const idStr = session.id;
        const nameColWidth = namePartWidth - stringWidth(idStr) - 1;
        const label = fitToWidth(nameStr, nameColWidth);
        const colAction = getColAction(focusedCol);
        return (
          <box flexDirection="row" height={1} key={session.id} width={itemWidth}>
            <text
              bg={bg}
              content={label}
              fg={fg}
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0) onSelect(session.name);
              }}
              width={nameColWidth}
            />
            <text
              bg={bg}
              content={padEndToWidth(idStr, stringWidth(idStr) + 1)}
              fg={isFocused ? theme.textBright : theme.textDim}
              onMouseDown={(event: MouseEvent) => {
                if (event.button === 0) onSelect(session.name);
              }}
            />
            {/* Overlay the swatch character with the session's color */}
            {onSetSessionColor && (
              <text
                bg={isFocused && colAction === "color" ? theme.accent : bg}
                content=" ● "
                fg={isFocused && colAction === "color" ? theme.bgSurface : (session.color ?? SESSION_PALETTE[0])}
                left={3}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) {
                    setColorTarget(session.name);
                    setMode("color");
                  }
                }}
                position="absolute"
              />
            )}
            {onRenameSession && (
              <text
                bg={isFocused && colAction === "pencil" ? theme.accent : bg}
                content=" ✎ "
                fg={isFocused && colAction === "pencil" ? theme.bgSurface : theme.textBright}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) {
                    setRenameTarget(session.name);
                    setMode("rename");
                  }
                }}
              />
            )}
            {onDeleteSession && (
              <text
                bg={isFocused && colAction === "delete" ? (isActive ? bg : theme.statusError) : bg}
                content={isActive ? " ⊘ " : " ✕ "}
                fg={isFocused && colAction === "delete" ? (isActive ? theme.textDim : theme.bgSurface) : theme.textDim}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0 && !isActive) {
                    initiateDelete(session.name);
                  }
                }}
              />
            )}
          </box>
        );
      })}
      <DropdownSeparator width={itemWidth} />
      <text
        bg={focusedIndex === sortedSessions.length ? theme.bgFocused : theme.bgSurface}
        content={padEndToWidth(focusedIndex === sortedSessions.length ? " ▸ New session" : "   New session", itemWidth)}
        fg={focusedIndex === sortedSessions.length ? theme.textBright : theme.textSecondary}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) setMode("input");
        }}
      />
    </DropdownFrame>
  );
}

/* XXX For now, restrict which characters a session name can begin with because
   some characters have special meaning in tmux control-mode, and the control
   client would need to be enhanced before these will work properly. Note that
   nothing is stopping anyone from programming tmux directly with unsupported
   name formats. Internally, tmux translates some such characters to `_`. */
function isValidSessionName(name: string): null | string {
  if (name.length === 0) return null;
  if ("@$%#.:\"\\'=\\".includes(name[0]!)) {
    return ` Invalid or unsupported name`;
  }
  return null;
}
