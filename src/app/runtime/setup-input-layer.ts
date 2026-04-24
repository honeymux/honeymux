import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

import { hasHistoryConsent, historyIndex } from "../../agents/history-search.ts";
import { createMouseCoordinateMapper } from "../../input/create-mouse-coordinate-mapper.ts";
import { setupInputRouter, setupMouseForward } from "../../input/router.ts";
import { MODIFIER_KEY_CODES, ensureKeybindingsFile } from "../../util/keybindings.ts";
import { computePromptClickDelta } from "../../util/prompt-click-region.ts";

interface GhosttyPersistentTerminalLike {
  getJson: () => import("ghostty-opentui").TerminalData;
}

interface GhosttyTerminalInternal {
  _persistentTerminal?: GhosttyPersistentTerminalLike;
}

export function setupInputLayer(ctx: SetupTmuxRuntimeContext): () => void {
  const {
    dialogs: {
      agentInstallDialogRef,
      dialogInputRef,
      dropdownInputRef,
      mainMenuCapturingRef,
      optionsDialogCapturingRef,
      setMainMenuDialogOpen,
    },
    input: {
      agentPreviewRef,
      handleActivateMenuRef,
      handleAgentLatchRef,
      handleAgentNextRef,
      handleAgentPrevRef,
      handleApplyFavoriteProfile,
      handleBufferZoomRef,
      handleCloseQuickTerminalRef,
      handleDismissRef,
      handleExitMobileModeRef,
      handleGotoAgentRef,
      handleLayoutProfileClick,
      handleMobileToggleRef,
      handleMuxotronDismissRef,
      handleNewPaneTabRef,

      handleNextPaneTabRef,
      handleNotificationsClickRef,
      handleOpenAgentsDialog,
      handleOpenConversationsRef,
      handleOpenQuickTerminalRef,
      handleOptionsClickRef,
      handlePrevPaneTabRef,
      handleQuickApproveRef,
      handleQuickDenyRef,
      handleRedrawRef,
      handleReviewAgentRef,
      handleScreenshotRef,
      handleSessionClickRef,
      handleSessionNextRef,
      handleSessionPrevRef,
      handleSidebarActivateRef,
      handleSidebarCancelRef,
      handleSidebarDownRef,
      handleSidebarFocusRef,
      handleSidebarLeftRef,
      handleSidebarRightRef,
      handleSidebarToggleRef,
      handleSidebarUpRef,
      handleSidebarZoomRef,
      handleTabNext,
      handleTabPrev,
      handleTextInputEscape,
      handleToolbarActivateRef,
      handleToolbarCancelRef,
      handleToolbarDownRef,
      handleToolbarFocusRef,
      handleToolbarToggleRef,
      handleToolbarUpRef,
      handleZoomEndRef,
      handleZoomStartRef,
      interactiveAgentRef,
      matchZoomCodeRef,
      muxotronFocusActiveRef,
      reEncodeActiveRef,
      reviewLatchedRef,
      sequenceMapRef,
      showHintRef,
      sidebarFocusedRef,
      tmuxPrefixKeyAliasRef,
      tmuxPrefixSequenceRef,
      toggleReviewLatchRef,
      toolbarFocusedIndexRef,
      toolbarOpenRef,
      writeFnRef,
      zoomActionRef,
      zoomStickyRef,
    },
    mouse: { agentsDialogOpenRef, mobileModeRef, quickTerminalOpenRef },
    sessionRuntime: {
      clientRef,
      detachingRef,
      dimsRef,
      inputReady,
      inputRouterSetup,
      promptClickStateRef,
      promptInputStartRef,
      ptyRef,
      renderer,
      terminalRef,
      textInputActive,
      tooNarrowRef,
    },
    sessionState: { historyLoadStartedRef, setHistoryReady },
  } = ctx;

  // Start history indexing once — only if consent already granted
  if (!inputRouterSetup.current) {
    historyIndex.onReady = () => setHistoryReady(true);
    if (hasHistoryConsent() === true && !historyLoadStartedRef.current) {
      historyLoadStartedRef.current = true;
      historyIndex.loadAsync().catch(() => {});
    }
  }

  // Set up input router once — writes go through writeFnRef
  if (!inputRouterSetup.current) {
    const cleanupFns: Array<() => void> = [];
    inputRouterSetup.current = true;
    setupInputRouter(
      renderer,
      (data: string) => writeFnRef.current(data),
      {
        getActiveZoomAction: () => zoomActionRef.current,
        isAgentPreview: () => agentPreviewRef.current,
        isDialogCapturing: () => mainMenuCapturingRef.current || optionsDialogCapturingRef.current,
        isDialogOpen: () => agentInstallDialogRef.current,
        isDropdownOpen: () => dropdownInputRef.current !== null,
        isInteractiveAgent: () => interactiveAgentRef.current !== null,
        isMobileMode: () => mobileModeRef.current,
        isMuxotronFocusActive: () => muxotronFocusActiveRef.current,
        isQuickTerminalOpen: () => quickTerminalOpenRef.current,
        isReEncodeActive: () => reEncodeActiveRef.current,
        isReady: () => inputReady.current,
        isReviewLatched: () => reviewLatchedRef.current,
        isSidebarFocused: () => sidebarFocusedRef.current,
        isTextInputActive: () => textInputActive.current,
        isTooNarrow: () => tooNarrowRef.current,
        isToolbarFocused: () => toolbarFocusedIndexRef.current >= 0,
        isToolbarOpen: () => toolbarOpenRef.current,
        isZoomStickyAction: (action) => {
          const s = zoomStickyRef.current;
          return action === "zoomAgentsView"
            ? s.zoomAgentsView
            : action === "zoomServerView"
              ? s.zoomServerView
              : false;
        },
        matchTmuxPrefixKeyAliasCode: (code) => {
          const alias = tmuxPrefixKeyAliasRef.current;
          return alias !== null && MODIFIER_KEY_CODES[code] === alias;
        },
        matchZoomCode: (code) => matchZoomCodeRef.current?.(code) ?? null,
        onActivateMenu: () => handleActivateMenuRef.current(),
        onAgentLatch: () => handleAgentLatchRef.current(),
        onAgentNext: () => handleAgentNextRef.current(),
        onAgentPrev: () => handleAgentPrevRef.current(),
        onApplyFavoriteProfile: () => handleApplyFavoriteProfile(),
        onBufferZoom: () => handleBufferZoomRef.current(),
        onCloseQuickTerminal: () => handleCloseQuickTerminalRef.current(),
        onDialogInput: (data: string) => dialogInputRef.current(data),
        onDismissAgent: () => handleDismissRef.current(),
        onDropdownInput: (data: string) => dropdownInputRef.current?.(data) ?? false,
        onGotoAgent: () => handleGotoAgentRef.current(),
        onMobileEscape: () => {
          const { height, width } = dimsRef.current;
          if (width >= 80 && height >= 24) {
            handleExitMobileModeRef.current();
          }
        },
        onMuxotronDismiss: () => handleMuxotronDismissRef.current(),
        onNewPaneTab: () => handleNewPaneTabRef.current(),
        onNextPaneTab: () => handleNextPaneTabRef.current(),
        onOpenAgents: () =>
          agentsDialogOpenRef.current
            ? dropdownInputRef.current?.("\x1b") // dismiss via Escape
            : handleOpenAgentsDialog(),
        onOpenConversations: () => handleOpenConversationsRef.current(),
        onOpenMainMenu: () => setMainMenuDialogOpen(true),
        onOpenNotifications: () => handleNotificationsClickRef.current(),
        onOpenOptions: () => handleOptionsClickRef.current(),
        onOpenProfiles: () => handleLayoutProfileClick(),
        onOpenQuickTerminal: () => handleOpenQuickTerminalRef.current(),
        onOpenSessions: () => handleSessionClickRef.current(),
        onPrevPaneTab: () => handlePrevPaneTabRef.current(),
        onQuickApprove: () => handleQuickApproveRef.current(),
        onQuickDeny: () => handleQuickDenyRef.current(),
        onRedraw: () => {
          showHintRef.current?.("redraw");
          handleRedrawRef.current();
        },
        onReview: () => handleReviewAgentRef.current?.(),
        onReviewLatchToggle: () => toggleReviewLatchRef.current?.(),
        onScreenshot: () => handleScreenshotRef.current(),
        onSessionNext: () => handleSessionNextRef.current(),
        onSessionPrev: () => handleSessionPrevRef.current(),
        onSidebarActivate: () => handleSidebarActivateRef.current(),
        onSidebarCancel: () => handleSidebarCancelRef.current(),
        onSidebarDown: () => handleSidebarDownRef.current(),
        onSidebarFocus: () => handleSidebarFocusRef.current(),
        onSidebarLeft: () => handleSidebarLeftRef.current(),
        onSidebarRight: () => handleSidebarRightRef.current(),
        onSidebarUp: () => handleSidebarUpRef.current(),
        onSidebarZoom: () => handleSidebarZoomRef.current(),
        onTabNext: handleTabNext,
        onTabPrev: handleTabPrev,
        onTextInputEscape: () => handleTextInputEscape(),
        onTmuxPrefixKeyAlias: () => {
          const seq = tmuxPrefixSequenceRef.current;
          if (seq) writeFnRef.current(seq);
        },
        onToggleMobile: () => handleMobileToggleRef.current(),
        onToggleSidebar: () => handleSidebarToggleRef.current(),
        onToggleToolbar: () => handleToolbarToggleRef.current(),
        onTooNarrowInput: () => {
          detachingRef.current = true;
          clientRef.current?.detach().catch(() => {});
        },
        onToolbarActivate: () => handleToolbarActivateRef.current(),
        onToolbarCancel: () => handleToolbarCancelRef.current(),
        onToolbarDown: () => handleToolbarDownRef.current(),
        onToolbarFocus: () => handleToolbarFocusRef.current(),
        onToolbarUp: () => handleToolbarUpRef.current(),
        onZoomEnd: () => handleZoomEndRef.current?.(),
        onZoomStart: (action) => handleZoomStartRef.current?.(action),
      },
      () => sequenceMapRef.current,
    );

    // Ensure keybindings config file exists (fire-and-forget)
    ensureKeybindingsFile();

    // Forward mouse events from the terminal content area to the PTY.
    // Tab bar clicks (rows 1-3) are left for OpenTUI to handle.
    // Track pane geometry so the mapper can detect border vs content clicks
    const paneRectsRef = {
      current: [] as Array<{ active: boolean; height: number; id: string; left: number; top: number; width: number }>,
    };
    const client = clientRef.current;
    if (client) {
      const refreshPaneRects = async () => {
        try {
          const panes = await client.getAllPaneInfo();
          paneRectsRef.current = panes.map((p) => ({
            active: p.active,
            height: p.height,
            id: p.id,
            left: p.left,
            top: p.top,
            width: p.width,
          }));
        } catch {
          // ignore — session may be disconnected
        }
      };
      client.on("layout-change", refreshPaneRects);
      client.on("window-pane-changed", refreshPaneRects);
      client.on("session-window-changed", refreshPaneRects);
      cleanupFns.push(() => {
        client.off("layout-change", refreshPaneRects);
        client.off("window-pane-changed", refreshPaneRects);
        client.off("session-window-changed", refreshPaneRects);
      });
      refreshPaneRects().catch(() => {});
    }

    const mouseAnyFlagRef = { current: false };
    if (client) {
      const refreshMouseFlag = async () => {
        try {
          mouseAnyFlagRef.current = await client.getActiveMouseAnyFlag();
        } catch {
          // ignore — session may be disconnected
        }
      };
      client.on("window-pane-changed", refreshMouseFlag);
      client.on("session-window-changed", refreshMouseFlag);
      const refreshMouseFlagInterval = setInterval(refreshMouseFlag, 1000);
      cleanupFns.push(() => {
        client.off("window-pane-changed", refreshMouseFlag);
        client.off("session-window-changed", refreshMouseFlag);
        clearInterval(refreshMouseFlagInterval);
      });
      refreshMouseFlag().catch(() => {});
    }

    const writeUserInputToPane = (data: string): void => {
      if (!inputReady.current) return;
      writeFnRef.current(data);
    };

    const clickToMoveRef = {
      current: (ptyX: number, ptyY: number): boolean => {
        if (mouseAnyFlagRef.current) return false;
        if (promptClickStateRef.current !== "prompt") return false;

        const terminal = terminalRef.current;
        const pty = ptyRef.current;
        if (!terminal || !pty || !inputReady.current) return false;

        const [cursorX, cursorY] = terminal.getCursor();
        const clickX = ptyX - 1;
        const clickY = ptyY - 1;
        const promptInputStart = promptInputStartRef.current;
        if (!promptInputStart) return false;
        const terminalData = getVisibleTerminalData(terminal);
        if (!terminalData) return false;

        const rects = paneRectsRef.current;
        const fallbackPane = {
          height: dimsRef.current.rows,
          id: "active",
          left: 0,
          top: 0,
          width: dimsRef.current.cols,
        };
        const inPane = (x: number, y: number, pane: typeof fallbackPane) =>
          x >= pane.left && x < pane.left + pane.width && y >= pane.top && y < pane.top + pane.height;
        const cursorPane = rects.find((pane) => inPane(cursorX, cursorY, pane)) ?? fallbackPane;
        const clickPane = rects.find((pane) => inPane(clickX, clickY, pane)) ?? fallbackPane;
        const startPane = rects.find((pane) => inPane(promptInputStart.x, promptInputStart.y, pane)) ?? fallbackPane;
        if (cursorPane.id !== clickPane.id || cursorPane.id !== startPane.id) return false;

        if (rects.length > 1) {
          if (!rects.find((pane) => pane.id === cursorPane.id)) return false;
        }

        const promptInputEnd = findPromptInputEnd(terminalData, cursorPane, promptInputStart, {
          x: cursorX,
          y: cursorY,
        });
        const delta = computePromptClickDelta(
          {
            cols: cursorPane.width,
            cursorX: cursorX - cursorPane.left,
            cursorY: cursorY - cursorPane.top,
            endX: promptInputEnd.x - cursorPane.left,
            endY: promptInputEnd.y - cursorPane.top,
            startX: promptInputStart.x - cursorPane.left,
            startY: promptInputStart.y - cursorPane.top,
          },
          clickX - cursorPane.left,
          clickY - cursorPane.top,
        );
        if (delta === null) return false;
        if (delta === 0) return false;

        const arrow = delta > 0 ? "\x1b[C" : "\x1b[D";
        writeUserInputToPane(arrow.repeat(Math.abs(delta)));
        return true;
      },
    };

    const mapCoordinates = createMouseCoordinateMapper({
      clickToMoveRef,
      dialogs: ctx.dialogs,
      input: ctx.input,
      mouse: ctx.mouse,
      paneRectsRef,
      sessionRuntime: ctx.sessionRuntime,
    });

    const teardownMouseForward = setupMouseForward(
      // Route through writeFnRef so overlays that swap it (e.g. the quick
      // terminal) retarget mouse output to their own PTY, matching keyboard.
      writeUserInputToPane,
      {
        isDialogOpen: () => agentInstallDialogRef.current,
        isDropdownOpen: () => dropdownInputRef.current !== null,
        isTextInputActive: () => textInputActive.current,
        isZoomActive: () => muxotronFocusActiveRef.current,
        mapCoordinates,
        onDialogInput: (data: string) => dialogInputRef.current(data),
        onDropdownInput: (data: string) => {
          dropdownInputRef.current?.(data);
        },
        writePaste: writeUserInputToPane,
      },
    );
    cleanupFns.push(teardownMouseForward);

    return () => {
      for (const cleanup of cleanupFns.reverse()) {
        cleanup();
      }
      inputRouterSetup.current = false;
    };
  }

  return () => {};
}

function findLastNonSpaceInPaneRow(
  line: import("ghostty-opentui").TerminalData["lines"][number] | undefined,
  terminalCols: number,
  paneLeft: number,
  paneWidth: number,
  minLocalX: number,
): null | number {
  if (!line) return null;

  const cells = new Array<string>(terminalCols).fill(" ");
  let col = 0;
  for (const span of line.spans) {
    const chars = Array.from(span.text);
    let written = 0;
    for (const ch of chars) {
      if (written >= span.width) break;
      if (col < terminalCols) cells[col] = ch;
      col += 1;
      written += 1;
    }
    while (written < span.width) {
      if (col < terminalCols) cells[col] = " ";
      col += 1;
      written += 1;
    }
    if (col >= terminalCols) break;
  }

  const start = paneLeft + minLocalX;
  const end = paneLeft + paneWidth - 1;
  for (let x = end; x >= start; x--) {
    if ((cells[x] ?? " ") !== " ") {
      return x - paneLeft;
    }
  }
  return null;
}

function findPromptInputEnd(
  data: import("ghostty-opentui").TerminalData,
  pane: { height: number; left: number; top: number; width: number },
  promptInputStart: { x: number; y: number },
  cursor: { x: number; y: number },
): { x: number; y: number } {
  const paneBottom = pane.top + pane.height;
  const startRow = Math.max(promptInputStart.y, pane.top);
  let lastRow = -1;
  let lastX = -1;
  let sawContentPastCursor = false;

  for (let row = startRow; row < paneBottom && row < data.lines.length; row++) {
    const minLocalX = row === promptInputStart.y ? Math.max(0, promptInputStart.x - pane.left) : 0;
    const rowEndX = findLastNonSpaceInPaneRow(data.lines[row], data.cols, pane.left, pane.width, minLocalX);
    if (rowEndX === null) {
      if (row > cursor.y && sawContentPastCursor) break;
      continue;
    }
    lastRow = row;
    lastX = rowEndX;
    if (row >= cursor.y) {
      sawContentPastCursor = true;
    }
  }

  if (lastRow === -1) {
    return { x: promptInputStart.x, y: promptInputStart.y };
  }

  let endX = pane.left + lastX + 1;
  let endY = lastRow;
  if (endX >= pane.left + pane.width) {
    endX = pane.left;
    endY = Math.min(lastRow + 1, paneBottom - 1);
  }

  if (endY < cursor.y || (endY === cursor.y && endX < cursor.x)) {
    return cursor;
  }

  return { x: endX, y: endY };
}

function getVisibleTerminalData(terminal: object): import("ghostty-opentui").TerminalData | null {
  return (terminal as GhosttyTerminalInternal)._persistentTerminal?.getJson() ?? null;
}
