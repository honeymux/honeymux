import type { MouseEvent } from "@opentui/core";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LayoutProfile } from "../tmux/types.ts";

import { theme } from "../themes/theme.ts";
import { formatArgv, parseArgv } from "../util/argv.ts";
import { isDismissKey } from "../util/keybindings.ts";
import { truncateName } from "../util/text.ts";
import { DropdownFrame, DropdownInputPanel, DropdownSeparator } from "./dropdown-shell.tsx";
import { useDropdownKeyboard } from "./use-dropdown-keyboard.ts";

type IconAction = "delete" | "gear" | "name" | "pencil";

interface ProfileDropdownProps {
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  maxWidth: number;
  onClose: () => void;
  onDeleteProfile?: (name: string) => void;
  onRenameProfile?: (oldName: string, newName: string) => void;
  onSave: (name: string) => Promise<LayoutProfile | undefined>;
  onSaveCommands?: (profileName: string, commands: string[][]) => void;
  onSelect: (profile: LayoutProfile) => void;
  onSetFavorite?: (name: string) => void;
  onTextInputActive?: (active: boolean) => void;
  profiles: LayoutProfile[];
}

export function ProfileDropdown({
  dropdownInputRef,
  maxWidth,
  onClose,
  onDeleteProfile,
  onRenameProfile,
  onSave,
  onSaveCommands,
  onSelect,
  onSetFavorite,
  onTextInputActive,
  profiles,
}: ProfileDropdownProps) {
  const [mode, setMode] = useState<"confirm-delete" | "edit-commands" | "list" | "rename" | "save">("list");
  const [renameTarget, setRenameTarget] = useState("");
  const [deleteTarget, setDeleteTarget] = useState("");
  const [saveError, setSaveError] = useState("");
  const [focusedCol, setFocusedCol] = useState(0);
  const textareaRef = useRef<any>(null);

  // State for edit-commands mode
  const [editTarget, setEditTarget] = useState("");
  const [editPaneIndex, setEditPaneIndex] = useState(0);
  const [editCommands, setEditCommands] = useState<string[]>([]);
  const [editFromSave, setEditFromSave] = useState(false);

  useEffect(() => {
    onTextInputActive?.(mode === "save" || mode === "rename" || mode === "edit-commands");
    return () => onTextInputActive?.(false);
  }, [mode]);

  // Build ordered list of available icon actions
  const iconActions: IconAction[] = [];
  if (onSaveCommands) iconActions.push("gear");
  if (onRenameProfile) iconActions.push("pencil");
  if (onDeleteProfile) iconActions.push("delete");
  const maxCol = iconActions.length; // 0 = name only

  const getColAction = (col: number): IconAction => {
    if (col === 0) return "name";
    return iconActions[col - 1] ?? "name";
  };

  // Keyboard navigation in list mode
  const handleKeySelect = useCallback(
    (index: number) => {
      const action = getColAction(focusedCol);
      if (index < profiles.length) {
        const profile = profiles[index]!;
        if (action === "delete") {
          setDeleteTarget(profile.name);
          setMode("confirm-delete");
          return;
        }
        if (action === "pencil") {
          setRenameTarget(profile.name);
          setMode("rename");
          return;
        }
        if (action === "gear") {
          const cmds: string[] = [];
          for (let i = 0; i < profile.paneCount; i++) {
            const argv = profile.commands?.[i];
            cmds.push(argv && argv.length > 0 ? formatArgv(argv) : "");
          }
          setEditTarget(profile.name);
          setEditPaneIndex(0);
          setEditCommands(cmds);
          setEditFromSave(false);
          setMode("edit-commands");
          return;
        }
        onSelect(profile);
      } else {
        setMode("save");
      }
    },
    [profiles, onSelect, onDeleteProfile, focusedCol, iconActions],
  );

  const handleRight = useCallback(
    (index: number) => {
      if (index < profiles.length && maxCol > 0) {
        setFocusedCol((prev) => Math.min(maxCol, prev + 1));
      }
    },
    [profiles.length, maxCol],
  );

  const handleLeft = useCallback((_index: number) => {
    setFocusedCol((prev) => Math.max(0, prev - 1));
  }, []);

  const { focusedIndex } = useDropdownKeyboard({
    dropdownInputRef,
    isOpen: mode === "list",
    itemCount: profiles.length + 1,
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

  const iconReserve = iconActions.length * 3;
  const starReserve = onSetFavorite ? 2 : 0;
  const maxNameDisplay = Math.min(maxWidth - 6 - iconReserve - starReserve, 40);
  const maxNameLen = Math.max(...profiles.map((p) => Math.min(p.name.length, maxNameDisplay)), 0);
  const minWidth = 32;
  const itemWidth = Math.max(maxNameLen + 8 + iconReserve + starReserve, minWidth - 2);
  const dropdownWidth = itemWidth + 2;

  if (mode === "save") {
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
          hint={saveError || " Enter ↵ save · Esc cancel"}
          itemWidth={itemWidth}
          onSubmit={() => {
            const text = textareaRef.current?.plainText?.trim() ?? "";
            if (text.length === 0) return;
            if (profiles.some((p) => p.name === text)) {
              setSaveError(" Name already exists");
              return;
            }
            setSaveError("");
            onSave(text).then((profile) => {
              if (profile && onSaveCommands) {
                const cmds = Array(profile.paneCount).fill("");
                setEditTarget(profile.name);
                setEditPaneIndex(0);
                setEditCommands(cmds);
                setEditFromSave(true);
                setMode("edit-commands");
              } else {
                onClose();
              }
            });
          }}
          placeholder="layout name"
          textareaRef={textareaRef}
          title=" Save layout"
        />
      </DropdownFrame>
    );
  }

  if (mode === "rename") {
    const inputHeight = 5;
    return (
      <DropdownFrame height={inputHeight} onClickOutside={() => setMode("list")} width={dropdownWidth}>
        <DropdownInputPanel
          hint=" Enter ↵ rename · Esc cancel"
          initialValue={renameTarget}
          itemWidth={itemWidth}
          onSubmit={() => {
            const text = textareaRef.current?.plainText?.trim() ?? "";
            if (text && text !== renameTarget) {
              onRenameProfile?.(renameTarget, text);
            }
            setMode("list");
          }}
          textareaRef={textareaRef}
          title=" Rename layout"
        />
      </DropdownFrame>
    );
  }

  if (mode === "edit-commands") {
    const profile = profiles.find((p) => p.name === editTarget);
    if (!profile) {
      if (editFromSave) {
        onClose();
        return null;
      }
      setMode("list");
      return null;
    }
    const paneNum = editPaneIndex + 1;
    const total = profile.paneCount;
    const isLast = editPaneIndex === total - 1;
    const exitEditCommands = editFromSave ? onClose : () => setMode("list");
    const inputHeight = 5;
    return (
      <DropdownFrame height={inputHeight} onClickOutside={exitEditCommands} width={dropdownWidth}>
        <DropdownInputPanel
          hint={isLast ? " Enter ↵ save · Esc cancel" : " Enter ↵ next pane · Esc cancel"}
          initialValue={editCommands[editPaneIndex] ?? ""}
          itemWidth={itemWidth}
          key={editPaneIndex}
          onSubmit={() => {
            const text = textareaRef.current?.plainText?.trim() ?? "";
            const updated = [...editCommands];
            updated[editPaneIndex] = text;

            if (isLast) {
              // Save all commands
              const commands = updated.map((cmd) => (cmd ? parseArgv(cmd) : []));
              onSaveCommands?.(editTarget, commands);
              exitEditCommands();
            } else {
              setEditCommands(updated);
              setEditPaneIndex(editPaneIndex + 1);
            }
          }}
          placeholder="(default shell)"
          textareaRef={textareaRef}
          title={` Pane ${paneNum}/${total} command`}
        />
      </DropdownFrame>
    );
  }

  if (mode === "confirm-delete") {
    // Handle y/n/Enter/Escape keyboard input for confirmation
    dropdownInputRef.current = (data: string) => {
      if (data === "y" || data === "Y") {
        onDeleteProfile?.(deleteTarget);
        setMode("list");
        return true;
      }
      if (data === "n" || data === "N" || isDismissKey(data) || data === "\r") {
        setMode("list");
        return true;
      }
      return true; // consume all input
    };
    const truncatedTarget = truncateName(deleteTarget, maxNameDisplay);
    const message = `Delete "${truncatedTarget}"?`;
    const confirmWidth = Math.max(message.length + 4, 20);
    const confirmHeight = 5;
    return (
      <DropdownFrame height={confirmHeight} onClickOutside={() => setMode("list")} width={confirmWidth}>
        <text content={` ${message}`.padEnd(confirmWidth - 2)} fg={theme.text} selectable={false} />
        <text content={" y/n".padEnd(confirmWidth - 2)} fg={theme.textDim} selectable={false} />
        <box flexDirection="row" height={1} width={confirmWidth - 2}>
          <text
            content="  Yes  "
            fg={theme.statusError}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) {
                onDeleteProfile?.(deleteTarget);
                setMode("list");
              }
            }}
          />
          <text
            content="  No  "
            fg={theme.textSecondary}
            onMouseDown={(event: MouseEvent) => {
              if (event.button === 0) setMode("list");
            }}
          />
        </box>
      </DropdownFrame>
    );
  }

  // List mode
  const separatorRow = 1;
  const saveRow = 1;
  const profileRows = profiles.length > 0 ? profiles.length : 1; // 1 for empty state
  const dropdownHeight = profileRows + separatorRow + saveRow + 2; // +2 for borders

  return (
    <DropdownFrame height={dropdownHeight} onClickOutside={onClose} width={dropdownWidth}>
      {profiles.length === 0 ? (
        <text
          bg={focusedIndex === 0 ? theme.bgFocused : theme.bgSurface}
          content={" (no saved profiles)".padEnd(itemWidth)}
          fg={theme.textDim}
          selectable={false}
        />
      ) : (
        profiles.map((profile, i) => {
          const isFocused = i === focusedIndex;
          const bg = isFocused ? theme.bgFocused : theme.bgSurface;
          const namePartWidth = itemWidth - iconReserve;
          const paneLabel = ` ${profile.paneCount}p`;
          const hasCommands = profile.commands && profile.commands.some((c) => c.length > 0);
          const starChar = onSetFavorite ? (profile.favorite ? "★" : "☆") : "";
          const prefix = isFocused ? " ▸ " : "   ";
          const starWidth = starChar ? 2 : 0; // star + space
          const nameMaxLen = namePartWidth - prefix.length - starWidth - paneLabel.length;
          const displayName = truncateName(profile.name, nameMaxLen);
          const colAction = getColAction(focusedCol);
          return (
            <box flexDirection="row" height={1} key={profile.name} width={itemWidth}>
              <text
                bg={bg}
                content={prefix}
                fg={isFocused ? theme.textBright : theme.text}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onSelect(profile);
                }}
              />
              {onSetFavorite && (
                <text
                  bg={bg}
                  content={starChar + " "}
                  fg="#ffff00"
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button === 0) onSetFavorite(profile.name);
                  }}
                />
              )}
              <text
                bg={bg}
                content={displayName.padEnd(namePartWidth - prefix.length - starWidth - paneLabel.length) + paneLabel}
                fg={isFocused ? theme.textBright : theme.text}
                onMouseDown={(event: MouseEvent) => {
                  if (event.button === 0) onSelect(profile);
                }}
              />
              {onSaveCommands && (
                <text
                  bg={isFocused && colAction === "gear" ? theme.accent : bg}
                  content={hasCommands ? " ⚙ " : " · "}
                  fg={isFocused && colAction === "gear" ? theme.bgSurface : hasCommands ? theme.accent : theme.textDim}
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button === 0) {
                      const cmds: string[] = [];
                      for (let j = 0; j < profile.paneCount; j++) {
                        const argv = profile.commands?.[j];
                        cmds.push(argv && argv.length > 0 ? formatArgv(argv) : "");
                      }
                      setEditTarget(profile.name);
                      setEditPaneIndex(0);
                      setEditCommands(cmds);
                      setEditFromSave(false);
                      setMode("edit-commands");
                    }
                  }}
                />
              )}
              {onRenameProfile && (
                <text
                  bg={isFocused && colAction === "pencil" ? theme.accent : bg}
                  content=" ✎ "
                  fg={isFocused && colAction === "pencil" ? theme.bgSurface : theme.textBright}
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button === 0) {
                      setRenameTarget(profile.name);
                      setMode("rename");
                    }
                  }}
                />
              )}
              {onDeleteProfile && (
                <text
                  bg={isFocused && colAction === "delete" ? theme.statusError : bg}
                  content=" ✕ "
                  fg={isFocused && colAction === "delete" ? theme.bgSurface : theme.textDim}
                  onMouseDown={(event: MouseEvent) => {
                    if (event.button === 0) {
                      setDeleteTarget(profile.name);
                      setMode("confirm-delete");
                    }
                  }}
                />
              )}
            </box>
          );
        })
      )}
      <DropdownSeparator width={itemWidth} />
      <text
        bg={focusedIndex === profiles.length ? theme.bgFocused : theme.bgSurface}
        content={(focusedIndex === profiles.length ? " ▸ Save current" : "   Save current").padEnd(itemWidth)}
        fg={focusedIndex === profiles.length ? theme.textBright : theme.textSecondary}
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) setMode("save");
        }}
      />
    </DropdownFrame>
  );
}
