import type { MouseEvent } from "@opentui/core";

import { useEffect, useRef, useState } from "react";

import type { AgentProviderRegistry } from "../agents/provider.ts";
import type { AgentSession } from "../agents/types.ts";

import { theme } from "../themes/theme.ts";
import { isDismissKey } from "../util/keybindings.ts";
import { AgentTree } from "./agent-tree.tsx";

interface AgentsDialogProps {
  /** Ref installed by the dialog so external next/prev handlers can navigate within it. */
  agentNavNextRef?: React.MutableRefObject<(() => void) | null>;
  agentNavPrevRef?: React.MutableRefObject<(() => void) | null>;
  dropdownInputRef: React.MutableRefObject<((data: string) => boolean) | null>;
  height: number;
  onClose: () => void;
  onSelect: (session: AgentSession) => void;
  registryRef?: React.MutableRefObject<AgentProviderRegistry | null>;
  sessions: AgentSession[];
  width: number;
}

const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";

export function AgentsDialog({
  agentNavNextRef,
  agentNavPrevRef,
  dropdownInputRef,
  height,
  onClose,
  onSelect,
  registryRef,
  sessions,
  width,
}: AgentsDialogProps) {
  const activeSessions = sessions.filter((s) => s.status !== "ended");

  const [focusIndex, setFocusIndex] = useState(1); // skip root node at index 0
  const rowCountRef = useRef(0);
  const activateRef = useRef<((index: number) => void) | null>(null);

  // Keyboard handler
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const focusIndexRef = useRef(focusIndex);
  focusIndexRef.current = focusIndex;

  useEffect(() => {
    const handler = (data: string): boolean => {
      if (isDismissKey(data)) {
        dropdownInputRef.current = null;
        onCloseRef.current();
        return true;
      }

      const count = rowCountRef.current;
      if (count === 0) return true;

      // Skip root node at index 0
      if (data === ARROW_UP || data === "\x1b[Z") {
        const cur = focusIndexRef.current;
        const next = cur <= 1 ? count - 1 : cur - 1;
        focusIndexRef.current = next;
        setFocusIndex(next);
        return true;
      }
      if (data === ARROW_DOWN || data === "\t") {
        const cur = focusIndexRef.current;
        const next = cur < 1 || cur >= count - 1 ? 1 : cur + 1;
        focusIndexRef.current = next;
        setFocusIndex(next);
        return true;
      }

      if (data === "\r" || data === "\n") {
        activateRef.current?.(focusIndexRef.current);
        return true;
      }
      return true;
    };

    dropdownInputRef.current = handler;
    return () => {
      if (dropdownInputRef.current === handler) {
        dropdownInputRef.current = null;
      }
    };
  }, [dropdownInputRef]);

  // Install dialog-local next/prev navigation on external refs so the
  // mux-o-tron's arrow keys navigate within this dialog, not the sidebar.
  useEffect(() => {
    if (agentNavNextRef) {
      agentNavNextRef.current = () => {
        const count = rowCountRef.current;
        if (count <= 1) return;
        const cur = focusIndexRef.current;
        const next = cur >= count - 1 ? 1 : cur + 1;
        focusIndexRef.current = next;
        setFocusIndex(next);
        activateRef.current?.(next);
      };
    }
    if (agentNavPrevRef) {
      agentNavPrevRef.current = () => {
        const count = rowCountRef.current;
        if (count <= 1) return;
        const cur = focusIndexRef.current;
        const next = cur <= 1 ? count - 1 : cur - 1;
        focusIndexRef.current = next;
        setFocusIndex(next);
        activateRef.current?.(next);
      };
    }
    return () => {
      if (agentNavNextRef) agentNavNextRef.current = null;
      if (agentNavPrevRef) agentNavPrevRef.current = null;
    };
  }, [agentNavNextRef, agentNavPrevRef]);

  // Dialog dimensions — 80% of terminal, min 78 wide
  const dialogWidth = Math.min(width - 2, Math.max(78, Math.floor(width * 0.85)));
  const innerWidth = dialogWidth - 2; // -2 for │ borders
  const contentWidth = innerWidth - 2; // -2 for 1-col padding each side
  const dialogLeft = Math.floor((width - dialogWidth) / 2);

  // Vertically center in pane area (below 3-row tab bar, above 1-row status bar)
  const paneTop = 3;
  const paneHeight = height - 4;
  const maxHeight = Math.floor(height * 0.85);
  const dialogHeight =
    activeSessions.length === 0 ? Math.min(maxHeight, 5) : Math.min(maxHeight, Math.max(22, paneHeight));
  const dialogTop = paneTop + Math.max(0, Math.floor((paneHeight - dialogHeight) / 2));
  const treeHeight = dialogHeight - 4; // borders + separator + hint row

  return (
    <>
      {/* Backdrop — close on click outside the dialog area */}
      <box
        height="100%"
        left={0}
        onMouseDown={(event: MouseEvent) => {
          if (event.button !== 0) return;
          const dx = event.x;
          const dy = event.y;
          if (dx >= dialogLeft && dx < dialogLeft + dialogWidth && dy >= dialogTop && dy < dialogTop + dialogHeight) {
            return;
          }
          onClose();
        }}
        position="absolute"
        top={0}
        width="100%"
        zIndex={19}
      />
      {/* Dialog — centered like ConversationsDialog */}
      <box
        backgroundColor={theme.bgSurface}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={dialogHeight}
        id="honeyshots:agents"
        left={dialogLeft}
        position="absolute"
        selectable={false}
        top={dialogTop}
        width={dialogWidth}
        zIndex={20}
      >
        {activeSessions.length === 0 ? (
          <box flexDirection="row" height={1} justifyContent="center" paddingLeft={1}>
            <text content="No agents running" fg={theme.textDim} selectable={false} />
          </box>
        ) : (
          <box height={treeHeight} paddingLeft={1}>
            <AgentTree
              activateRef={activateRef}
              focusedRow={focusIndex}
              height={treeHeight}
              onSelect={onSelect}
              registryRef={registryRef}
              rowCountRef={rowCountRef}
              sessions={activeSessions}
              width={contentWidth}
            />
          </box>
        )}
        {/* Separator */}
        <text
          bg={theme.bgSurface}
          content={" " + "\u2500".repeat(contentWidth) + " "}
          fg={theme.border}
          selectable={false}
        />
        {/* Hint */}
        <box flexDirection="row" gap={1} height={1} justifyContent="center" paddingLeft={1}>
          <text content="↑↓" fg={theme.accent} selectable={false} />
          <text content="navigate" fg={theme.textDim} selectable={false} />
          <text content=" " selectable={false} />
          <text content="enter" fg={theme.accent} selectable={false} />
          <text content="select" fg={theme.textDim} selectable={false} />
          <text content=" " selectable={false} />
          <text content="esc" fg={theme.accent} selectable={false} />
          <text content="close" fg={theme.textDim} selectable={false} />
        </box>
      </box>
      {/* Border label centered on top border */}
      <text
        bg={theme.bgSurface}
        content={" Agents "}
        fg={theme.textBright}
        left={dialogLeft + Math.floor((dialogWidth - 8) / 2)}
        position="absolute"
        selectable={false}
        top={dialogTop}
        zIndex={21}
      />
    </>
  );
}
