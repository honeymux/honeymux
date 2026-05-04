import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Osc52Passthrough, OtherOscPassthrough } from "../util/config.ts";
import type { PtyBridge } from "../util/pty.ts";

import { theme } from "../themes/theme.ts";
import { type TmuxControlClient, runStandaloneTmuxCommand } from "../tmux/control-client.ts";
import { defaultConfig, loadConfig, saveConfig } from "../util/config.ts";
import { prepareGhosttyTerminalForTmux } from "../util/ghostty-terminal.ts";
import { isDismissKey } from "../util/keybindings.ts";
import { createPassthroughForwarder, spawnPty } from "../util/pty.ts";
import { tmuxCmd } from "../util/tmux-server.ts";
import { TerminalView } from "./terminal-view.tsx";

const TERMINAL_MENU_ITEMS = [
  { action: "pinToWindow" as const, label: "Pin to window" },
  { action: "close" as const, label: "Close" },
];

interface QuickTerminalOverlayProps {
  clientRef?: React.MutableRefObject<TmuxControlClient | null>;
  closeKeyLabel: string;
  height: number;
  menuCloseRef?: React.MutableRefObject<(() => void) | null>;
  menuToggleRef?: React.MutableRefObject<(() => void) | null>;
  onClose: () => void;
  onPinToWindow?: (tempSessionName: string) => void;
  onSizeChange?: (pct: number) => void;
  policyOsc52Passthrough: Osc52Passthrough;
  policyOtherOscPassthrough: OtherOscPassthrough;
  qtResizeDragEndRef?: React.MutableRefObject<(() => void) | null>;
  qtResizeDragMoveRef?: React.MutableRefObject<((screenX: number, screenY: number) => void) | null>;
  qtResizeDraggingRef?: React.MutableRefObject<boolean>;
  qtResizeSizeRef?: React.MutableRefObject<number>;
  quickTerminalMenuOpenRef?: React.MutableRefObject<boolean>;
  quickTerminalSize?: number;
  width: number;
  writeFnRef: React.MutableRefObject<(data: string) => void>;
}

export function QuickTerminalOverlay({
  clientRef,
  closeKeyLabel,
  height,
  menuCloseRef,
  menuToggleRef,
  onClose,
  onPinToWindow,
  onSizeChange,
  policyOsc52Passthrough,
  policyOtherOscPassthrough,
  qtResizeDragEndRef,
  qtResizeDragMoveRef,
  qtResizeDraggingRef,
  qtResizeSizeRef,
  quickTerminalMenuOpenRef,
  quickTerminalSize,
  width,
  writeFnRef,
}: QuickTerminalOverlayProps) {
  const ptyRef = useRef<PtyBridge | null>(null);
  const terminalRef = useRef<GhosttyTerminalRenderable | null>(null);
  const originalWriteRef = useRef(writeFnRef.current);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const menuItems = TERMINAL_MENU_ITEMS;

  // Menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFocusedIndex, setMenuFocusedIndex] = useState(0);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  if (quickTerminalMenuOpenRef) quickTerminalMenuOpenRef.current = menuOpen;
  // Clear the shared menu-open flag when the overlay unmounts
  useEffect(() => {
    return () => {
      if (quickTerminalMenuOpenRef) quickTerminalMenuOpenRef.current = false;
    };
  }, [quickTerminalMenuOpenRef]);
  const menuFocusedIndexRef = useRef(0);
  menuFocusedIndexRef.current = menuFocusedIndex;

  // Register/unregister menu close callback on the shared ref
  useEffect(() => {
    if (!menuCloseRef) return;
    if (menuOpen) {
      menuCloseRef.current = () => setMenuOpen(false);
    } else {
      menuCloseRef.current = null;
    }
    return () => {
      if (menuCloseRef.current) menuCloseRef.current = null;
    };
  }, [menuOpen, menuCloseRef]);

  // Register/unregister menu toggle callback on the shared ref
  useEffect(() => {
    if (!menuToggleRef) return;
    menuToggleRef.current = () => setMenuOpen((prev) => !prev);
    return () => {
      if (menuToggleRef.current) menuToggleRef.current = null;
    };
  }, [menuToggleRef]);

  // Reset focus when menu opens
  useEffect(() => {
    if (menuOpen) setMenuFocusedIndex(0);
  }, [menuOpen]);

  // Ref for the temp tmux session name (terminal mode)
  const quickTerminalSessionRef = useRef<null | string>(null);

  const handleMenuSelect = useCallback(
    (index: number) => {
      const item = menuItems[index];
      if (!item) return;
      setMenuOpen(false);
      if (item.action === "pinToWindow") {
        const sessionName = quickTerminalSessionRef.current;
        if (sessionName) {
          // Prevent cleanup from killing the session — the window is being moved
          quickTerminalSessionRef.current = null;
          onPinToWindow?.(sessionName);
        }
      } else if (item.action === "close") {
        // Clear the menu close ref so the close handler doesn't just
        // close the menu instead of the overlay (menu is already closed
        // by setMenuOpen above, but the ref update is async).
        if (menuCloseRef) menuCloseRef.current = null;
        onCloseRef.current();
      }
    },
    [menuItems, menuCloseRef, onPinToWindow],
  );

  // Overlay dimensions — driven by config prop
  const currentSize = quickTerminalSize ?? 90;

  // Keep the shared ref in sync so the coordinate mapper can compute the corner
  useEffect(() => {
    if (qtResizeSizeRef) qtResizeSizeRef.current = currentSize;
  }, [currentSize, qtResizeSizeRef]);

  // Wire drag callbacks
  const onSizeChangeRef = useRef(onSizeChange);
  onSizeChangeRef.current = onSizeChange;
  const currentSizeRef = useRef(currentSize);
  currentSizeRef.current = currentSize;
  useEffect(() => {
    if (qtResizeDragMoveRef) {
      qtResizeDragMoveRef.current = (screenX: number, screenY: number) => {
        const dx = Math.abs(screenX - Math.floor(width / 2));
        const dy = Math.abs(screenY - Math.floor(height / 2));
        const rawW = ((dx * 2) / width) * 100;
        const rawH = ((dy * 2) / height) * 100;
        const raw = Math.max(rawW, rawH);
        // Snap to 5% increments to match the config keyboard control
        const snapped = Math.round(raw / 5) * 5;
        const newPct = Math.min(100, Math.max(20, snapped));
        onSizeChangeRef.current?.(newPct);
      };
    }
    if (qtResizeDragEndRef) {
      qtResizeDragEndRef.current = () => {
        const config = loadConfig() ?? defaultConfig();
        config.quickTerminalSize = currentSizeRef.current;
        saveConfig(config);
      };
    }
    return () => {
      if (qtResizeDragMoveRef) qtResizeDragMoveRef.current = null;
      if (qtResizeDragEndRef) qtResizeDragEndRef.current = null;
    };
  }, [width, height, qtResizeDragMoveRef, qtResizeDragEndRef]);

  const pct = currentSize / 100;
  const overlayWidth = Math.max(20, Math.floor(width * pct));
  const overlayHeight = Math.max(8, Math.floor(height * pct));
  const termCols = overlayWidth - 2; // borders
  const termRows = overlayHeight - 2; // top + bottom border

  const overlayLeft = Math.floor((width - overlayWidth) / 2);
  const overlayTop = Math.floor((height - overlayHeight) / 2);

  // Write to overlay PTY — routes keyboard input to the overlay's PTY.
  // Close-key handling is done by the input router gate (high priority,
  // before dialog/dropdown gates).
  const menuItemsLen = menuItems.length;
  const writeToOverlayPty = useCallback(
    (data: string) => {
      // Menu keyboard navigation
      if (menuOpenRef.current) {
        if (isDismissKey(data)) {
          // Esc closes menu (handled by close handler via menuCloseRef)
          setMenuOpen(false);
          return;
        }
        if (data === "\x1b[A") {
          setMenuFocusedIndex((i) => (i - 1 + menuItemsLen) % menuItemsLen);
          return;
        }
        if (data === "\x1b[B") {
          setMenuFocusedIndex((i) => (i + 1) % menuItemsLen);
          return;
        }
        if (data === "\r" || data === "\n") {
          handleMenuSelect(menuFocusedIndexRef.current);
          return;
        }
        // Consume all other input while menu is open
        return;
      }

      const pty = ptyRef.current;
      if (!pty) return;

      pty.write(data);
    },
    [menuItemsLen, handleMenuSelect],
  );

  // Swap writeFnRef to route input to overlay — useLayoutEffect runs
  // synchronously after commit, before any new stdin events can fire,
  // so the very first keypress after mount/unmount hits the right handler.
  useLayoutEffect(() => {
    originalWriteRef.current = writeFnRef.current;
    writeFnRef.current = writeToOverlayPty;
    return () => {
      writeFnRef.current = originalWriteRef.current;
    };
  }, [writeFnRef, writeToOverlayPty]);

  // Capture initial PTY dimensions so the spawn effect can run once without
  // re-spawning on every resize. Resize is propagated separately below.
  const initialTermColsRef = useRef(termCols);
  const initialTermRowsRef = useRef(termRows);
  const otherOscPolicyRef = useRef(policyOtherOscPassthrough);
  otherOscPolicyRef.current = policyOtherOscPassthrough;
  const policyRef = useRef(policyOsc52Passthrough);
  policyRef.current = policyOsc52Passthrough;

  // Create a temp tmux session and attach to it. Using tmux (rather than a
  // raw PTY) lets "Pin to window" move the running shell — with all its
  // child processes — into the main session.
  useEffect(() => {
    closedRef.current = false;

    const sessionName = `hmx_qt_${Date.now()}`;
    quickTerminalSessionRef.current = sessionName;

    (async () => {
      try {
        const client = clientRef?.current;
        if (client) {
          await client.createDetachedSession(sessionName);
          await client.setSessionOption(sessionName, "status", "off");
          await client.setSessionOption(sessionName, "pane-border-status", "off");
        } else {
          await runStandaloneTmuxCommand(["new-session", "-d", "-s", sessionName]);
          await runStandaloneTmuxCommand(["set-option", "-t", sessionName, "status", "off"]);
          await runStandaloneTmuxCommand(["set-option", "-t", sessionName, "pane-border-status", "off"]);
        }
      } catch {
        // tmux commands failed — PTY attach will still try
      }

      const forwardPassthrough = createPassthroughForwarder({
        policyOsc52Passthrough: policyRef.current,
        policyOtherOscPassthrough: otherOscPolicyRef.current,
      });
      const pty = spawnPty(
        tmuxCmd("attach-session", "-t", sessionName),
        Math.max(10, initialTermColsRef.current),
        Math.max(3, initialTermRowsRef.current),
        (data) => {
          forwardPassthrough(data);
          if (ptyRef.current === pty && terminalRef.current) {
            try {
              terminalRef.current.feed(data);
            } catch {}
          }
        },
      );
      ptyRef.current = pty;

      // Auto-close when the attached session ends (e.g., user types 'exit')
      pty.exited.then(() => {
        if (!closedRef.current) {
          closedRef.current = true;
          onCloseRef.current();
        }
      });
    })();

    return () => {
      closedRef.current = true;
      try {
        ptyRef.current?.kill();
      } catch {
        // ignore
      }
      ptyRef.current = null;

      // Kill the temp session on cleanup (unless pinned)
      if (quickTerminalSessionRef.current) {
        const client = clientRef?.current;
        const sessionToKill = quickTerminalSessionRef.current;
        if (client) {
          client.killSession(sessionToKill).catch(() => {});
        } else {
          runStandaloneTmuxCommand(["kill-session", "-t", sessionToKill]).catch(() => {});
        }
        quickTerminalSessionRef.current = null;
      }
    };
  }, [clientRef]);

  // Handle terminal resize
  useEffect(() => {
    const pty = ptyRef.current;
    if (pty && termCols > 0 && termRows > 0) {
      pty.resize(termCols, termRows);
    }
  }, [termCols, termRows]);

  const handleTerminalReady = useCallback((terminal: GhosttyTerminalRenderable) => {
    terminalRef.current = terminal;
    prepareGhosttyTerminalForTmux(terminal);
  }, []);

  // Border label — centered on the top border
  const borderTitle = " Quick Terminal ";
  const borderTitleLeft = overlayLeft + Math.floor(overlayWidth / 2) - Math.floor(borderTitle.length / 2);

  const hamburgerLabel = " \u2261 ";
  const hamburgerLeft = overlayLeft + overlayWidth - hamburgerLabel.length - 2;

  // Menu dropdown dimensions
  const menuItemWidth = 18;
  const menuWidth = menuItemWidth + 2; // borders
  const menuHeight = menuItems.length + 2; // borders
  const menuLeft = overlayLeft + overlayWidth - menuWidth - 1;
  const menuTop = overlayTop + 1;

  // Close hint on bottom border — " <key> close " with key in accent, "close" in dim
  const closeHintContent = ` ${closeKeyLabel} close `;
  const closeHintLeft = overlayLeft + Math.floor(overlayWidth / 2) - Math.floor(closeHintContent.length / 2);

  return (
    <>
      {/* Backdrop — click to close */}
      <box
        backgroundColor={theme.backdropOverlay}
        height={height}
        left={0}
        onMouseDown={() => {
          if (menuOpen) {
            setMenuOpen(false);
          } else {
            onClose();
          }
        }}
        position="absolute"
        top={0}
        width={width}
        zIndex={14}
      />
      {/* Overlay frame */}
      <box
        backgroundColor={theme.bgChrome}
        border={true}
        borderColor={theme.accent}
        borderStyle="rounded"
        flexDirection="column"
        height={overlayHeight}
        id="honeyshots:quick-terminal"
        left={overlayLeft}
        position="absolute"
        top={overlayTop}
        width={overlayWidth}
        zIndex={15}
      >
        <TerminalView
          bg={theme.bgChrome}
          cols={Math.max(10, termCols)}
          onReady={handleTerminalReady}
          rows={Math.max(3, termRows)}
          showCursor={true}
        />
      </box>
      {/* Border label centered on top border */}
      <text
        bg={theme.bgChrome}
        content={borderTitle}
        fg={theme.textBright}
        left={borderTitleLeft}
        position="absolute"
        selectable={false}
        top={overlayTop}
        zIndex={16}
      />
      {/* Hamburger menu icon on top border */}
      <text
        bg={theme.bgChrome}
        content={hamburgerLabel}
        fg={menuOpen ? theme.textBright : theme.textDim}
        left={hamburgerLeft}
        onMouseDown={() => setMenuOpen((prev) => !prev)}
        position="absolute"
        selectable={false}
        top={overlayTop}
        zIndex={16}
      />
      {/* Menu dropdown */}
      {menuOpen && (
        <>
          <box
            backgroundColor={theme.bgSurface}
            border={true}
            borderColor={theme.accent}
            borderStyle="rounded"
            flexDirection="column"
            height={menuHeight}
            left={menuLeft}
            position="absolute"
            top={menuTop}
            width={menuWidth}
            zIndex={17}
          >
            {menuItems.map((item, i) => {
              const focused = i === menuFocusedIndex;
              const prefix = focused ? " \u25B8 " : "   ";
              const label = (prefix + item.label).padEnd(menuItemWidth);
              return (
                <text
                  bg={focused ? theme.bgFocused : theme.bgSurface}
                  content={label}
                  fg={focused ? theme.textBright : theme.text}
                  height={1}
                  key={item.action}
                  onMouseDown={() => handleMenuSelect(i)}
                  width={menuItemWidth}
                />
              );
            })}
          </box>
        </>
      )}
      {/* Resize handle at bottom-right corner with 1-char padding on each border */}
      <text
        bg={theme.bgChrome}
        content="↘"
        fg={theme.accent}
        left={overlayLeft + overlayWidth - 1}
        onMouseDown={() => {
          if (qtResizeDraggingRef) qtResizeDraggingRef.current = true;
        }}
        position="absolute"
        selectable={false}
        top={overlayTop + overlayHeight - 1}
        zIndex={16}
      />
      {/* Clear the border segment to the left of ↘ */}
      <text
        bg={theme.bgChrome}
        content=" "
        fg={theme.accent}
        left={overlayLeft + overlayWidth - 2}
        position="absolute"
        top={overlayTop + overlayHeight - 1}
        zIndex={16}
      />
      {/* Close hint centered on bottom border */}
      <box
        flexDirection="row"
        height={1}
        left={closeHintLeft}
        position="absolute"
        top={overlayTop + overlayHeight - 1}
        width={closeHintContent.length}
        zIndex={16}
      >
        <text bg={theme.bgChrome} content=" " />
        <text bg={theme.bgChrome} content={closeKeyLabel} fg={theme.accent} selectable={false} />
        <text bg={theme.bgChrome} content=" close " fg={theme.textDim} selectable={false} />
      </box>
    </>
  );
}
