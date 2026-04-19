import type { KeyAction } from "../../util/keybindings.ts";
import type { AgentActionsApi } from "../hooks/use-agent-actions.ts";
import type { AppRuntimeRefs } from "../hooks/use-app-runtime-refs.ts";
import type { MainMenuSelectedCol } from "../hooks/use-app-state-groups.ts";
import type { AgentDialogState, UiChromeState } from "../hooks/use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "../hooks/use-history-workflow.ts";
import type { OptionsWorkflowApi } from "../hooks/use-options-workflow.ts";

import { handleDisablePaneTabsDialogInput } from "../../components/disable-pane-tabs-dialog.tsx";
import { ACTION_LABELS, LETTER_MAP, MAIN_MENU_TAB_ORDER, ZOOM_ROW_IDX } from "../../components/main-menu-dialog.tsx";
import {
  copyToClipboard,
  handleScreenshotDialogInput,
  handleScreenshotDoneDialogInput,
  handleScreenshotLargeDialogInput,
} from "../../components/screenshot-dialog.tsx";
import {
  DEFAULT_KEYBINDINGS,
  MODIFIER_KEY_CODES,
  formatKeyCombo,
  formatModifierKeyCode,
  identifyKeySequence,
  isDismissKey,
  isEscape,
  parseRawKeyEvent,
} from "../../util/keybindings.ts";
import {
  CONVERSATIONS_MENU_ITEM_COUNT,
  CONVERSATIONS_PAGE_SIZE,
  getOldestConversationsPageOffset,
} from "../hooks/use-history-workflow.ts";
import { dispatchOptionsDialogInput } from "../options/dispatch.ts";
import { applyLineEdit } from "./line-edit.ts";

export interface DialogInputDispatchDeps {
  agentActions: AgentActionsApi;
  agentDialogState: AgentDialogState;
  historyWorkflow: HistoryWorkflowApi;
  mainMenu: DialogInputMainMenuDeps;
  notificationsReview: DialogInputNotificationsReview;
  optionsWorkflow: OptionsWorkflowApi;
  paneTabsEnabled: DialogInputPaneTabs;
  runtimeRefs: AppRuntimeRefs;
  screenshots: DialogInputScreenshots;
  sshError: DialogInputSshError;
  uiChromeState: UiChromeState;
}

interface DialogInputMainMenuDeps {
  getMainMenuActionForSlot: (row: number, col: MainMenuSelectedCol) => KeyAction | null;
  onMainMenuAction: (action: KeyAction) => void;
  onMainMenuBindingChange: (action: KeyAction, combo: string) => void;
  onToggleZoomSticky: (action: "zoomAgentsView" | "zoomServerView") => void;
  paneTabsEnabled: boolean;
  rowCount: number;
  writeToPty: (data: string) => void;
}

interface DialogInputNotificationsReview {
  close: () => void;
  dismissCurrentInfo: () => void;
  infoDialogPending: boolean;
  open: boolean;
}

interface DialogInputPaneTabs {
  disableConfirmButtonCol: number;
  disableConfirmOpen: boolean;
  handleDisableCancel: () => void;
  handleDisableConfirm: () => void;
  setDisableConfirmButtonCol: (col: number) => void;
}

interface DialogInputScreenshots {
  buttonCol: number;
  dialogOpen: boolean;
  dismissLargeDialog: () => void;
  doneButtonCol: number;
  donePath: null | string;
  handleCapture: (mode: "scrollback" | "viewport") => void;
  largeDialogOpen: boolean;
  scrollbackDisabled: boolean;
  setButtonCol: (col: number) => void;
  setDialogOpen: (open: boolean) => void;
  setDoneButtonCol: (col: number) => void;
  setDonePath: (path: null | string) => void;
}

interface DialogInputSshError {
  /** Close the dialog but keep the warning (persist). */
  dismiss: () => void;
  /** Close the dialog and remove the warning permanently. */
  dismissPermanently: () => void;
  server: null | string;
}

// When a combo is rejected (conflict), the modifier release that follows must
// be suppressed — otherwise it gets accepted as a standalone modifier binding.
let suppressNextModifierRelease = false;
const TMUX_PREFIX_KEY_ALIAS_CONFLICT_LABEL = "tmux prefix key alias";
const CONVERSATIONS_LOAD_MORE_THRESHOLD = 5;
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";

export function dispatchDialogInput(data: string, deps: DialogInputDispatchDeps): void {
  const {
    agentActions,
    agentDialogState,
    historyWorkflow,
    mainMenu,
    notificationsReview,
    optionsWorkflow,
    paneTabsEnabled,
    runtimeRefs,
    screenshots,
    uiChromeState,
  } = deps;
  const {
    handleClaudeInstall,
    handleClaudeNever,
    handleClaudeSkip,
    handleCodexInstall,
    handleCodexNever,
    handleCodexSkip,
    handleConversationsSelect,
    handleGeminiInstall,
    handleGeminiNever,
    handleGeminiSkip,
    handleOpenCodeInstall,
    handleOpenCodeNever,
    handleOpenCodeSkip,
  } = agentActions;
  const {
    claudeDialogPending,
    codexDialogPending,
    dialogSelected,
    geminiDialogPending,
    openCodeDialogPending,
    setDialogSelected,
  } = agentDialogState;
  const {
    closeConversationsDialog,
    closeConversationsMenu,
    consentDialogSelected,
    conversationsCursor,
    conversationsDialogOpen,
    conversationsLoadedCount,
    conversationsMenuIndex,
    conversationsMenuOpen,
    conversationsPageOffset,
    conversationsQuery,
    conversationsResultIndex,
    conversationsResults,
    goToConversationsAbsoluteIndex,
    handleConsentAllow,
    handleConsentDeny,
    historyConsentDialogOpen,
    jumpToNewestConversationsPage,
    jumpToOldestConversationsPage,
    loadMoreConversations,
    openConversationsMenu,
    resetConversationsPagination,
    setConsentDialogSelected,
    setConversationsCursor,
    setConversationsMenuIndex,
    setConversationsQuery,
    setConversationsResultIndex,
    showNewerConversationsPage,
    showOlderConversationsPage,
    toggleConversationsSearchCaseSensitive,
    toggleConversationsSearchRegex,
  } = historyWorkflow;
  const {
    mainMenuCapturing,
    mainMenuDialogOpen,
    mainMenuSelectedCol,
    mainMenuSelectedRow,
    mainMenuTab,
    setMainMenuCaptureError,
    setMainMenuCapturing,
    setMainMenuDialogOpen,
    setMainMenuSelectedCol,
    setMainMenuSelectedRow,
    setMainMenuTab,
  } = uiChromeState;
  const { configTmuxPrefixKeyAlias, optionsDialogOpen } = optionsWorkflow;
  const { dropdownInputRef, sequenceMapRef } = runtimeRefs;
  const { close: closeNotificationsReview, open: notificationsReviewOpen } = notificationsReview;
  const {
    getMainMenuActionForSlot,
    onMainMenuAction,
    onMainMenuBindingChange,
    onToggleZoomSticky,
    paneTabsEnabled: mainMenuPaneTabsEnabled,
    rowCount: mainMenuRowCount,
    writeToPty,
  } = mainMenu;
  const {
    buttonCol: screenshotButtonCol,
    dialogOpen: screenshotDialogOpen,
    dismissLargeDialog: dismissScreenshotLargeDialog,
    doneButtonCol: screenshotDoneButtonCol,
    donePath: screenshotDonePath,
    handleCapture: handleScreenshotCapture,
    largeDialogOpen: screenshotLargeDialogOpen,
    scrollbackDisabled: screenshotScrollbackDisabled,
    setButtonCol: setScreenshotButtonCol,
    setDialogOpen: setScreenshotDialogOpen,
    setDoneButtonCol: setScreenshotDoneButtonCol,
    setDonePath: setScreenshotDonePath,
  } = screenshots;
  const {
    disableConfirmButtonCol: paneTabDisableConfirmButtonCol,
    disableConfirmOpen: paneTabDisableConfirmOpen,
    handleDisableCancel: handlePaneTabDisableCancel,
    handleDisableConfirm: handlePaneTabDisableConfirm,
    setDisableConfirmButtonCol: setPaneTabDisableConfirmButtonCol,
  } = paneTabsEnabled;

  // Info item dialog: Enter acknowledges, Esc closes the review flow without acknowledging
  if (notificationsReview.infoDialogPending) {
    if (data === "\r" || data === "\n") {
      notificationsReview.dismissCurrentInfo();
    } else if (isDismissKey(data)) {
      notificationsReview.close();
    }
    return;
  }

  // SSH error dialog: Esc closes review flow (error stays unresolved), any other key dismisses permanently
  if (deps.sshError.server !== null) {
    if (isDismissKey(data) && notificationsReviewOpen) {
      closeNotificationsReview();
    } else {
      deps.sshError.dismissPermanently();
    }
    return;
  }

  // Agent install dialogs (Enter/Esc/Tab navigation)
  if (claudeDialogPending || openCodeDialogPending || geminiDialogPending || codexDialogPending) {
    if (data === "\r" || data === "\n") {
      // Activate selected button
      const sel = dialogSelected;
      if (claudeDialogPending) {
        (sel === "install" ? handleClaudeInstall : sel === "never" ? handleClaudeNever : handleClaudeSkip)();
      } else if (openCodeDialogPending) {
        (sel === "install" ? handleOpenCodeInstall : sel === "never" ? handleOpenCodeNever : handleOpenCodeSkip)();
      } else if (geminiDialogPending) {
        (sel === "install" ? handleGeminiInstall : sel === "never" ? handleGeminiNever : handleGeminiSkip)();
      } else if (codexDialogPending) {
        (sel === "install" ? handleCodexInstall : sel === "never" ? handleCodexNever : handleCodexSkip)();
      }
    } else if (isDismissKey(data)) {
      // Escape: close entire review if open (items remain unresolved),
      // otherwise "Not Now" for the standalone dialog
      if (notificationsReviewOpen) {
        closeNotificationsReview();
      } else if (claudeDialogPending) handleClaudeSkip();
      else if (openCodeDialogPending) handleOpenCodeSkip();
      else if (geminiDialogPending) handleGeminiSkip();
      else if (codexDialogPending) handleCodexSkip();
    } else if (data === "\t" || data === "\x1b[C") {
      // Forward navigation: install → skip → ignore → install
      setDialogSelected((prev) => (prev === "install" ? "skip" : prev === "skip" ? "never" : "install"));
    } else if (data === "\x1b[Z" || data === "\x1b[D") {
      // Backward navigation: install → ignore → skip → install
      setDialogSelected((prev) => (prev === "install" ? "never" : prev === "never" ? "skip" : "install"));
    }
    return;
  }

  // History consent dialog
  if (historyConsentDialogOpen) {
    if (data === "\r" || data === "\n") {
      if (consentDialogSelected === "allow") handleConsentAllow();
      else handleConsentDeny();
    } else if (isDismissKey(data)) {
      handleConsentDeny();
    } else if (data === "\t" || data === "\x1b[C" || data === "\x1b[D") {
      setConsentDialogSelected((prev) => (prev === "allow" ? "deny" : "allow"));
    }
    return;
  }

  // Conversations dialog
  if (conversationsDialogOpen) {
    const canonical = identifyKeySequence(data);
    const seq = canonical ? sequenceMapRef.current.get(canonical) : undefined;
    const results = conversationsResults.results;
    if (conversationsMenuOpen) {
      if (seq === "conversations") {
        closeConversationsDialog();
        return;
      }
      if (isDismissKey(data) || data === "\t" || data === "\x1b[Z") {
        closeConversationsMenu();
        return;
      }
      if (data === "\x1b[A") {
        setConversationsMenuIndex((index) => (index <= 0 ? CONVERSATIONS_MENU_ITEM_COUNT - 1 : index - 1));
        return;
      }
      if (data === "\x1b[B") {
        setConversationsMenuIndex((index) => (index + 1) % CONVERSATIONS_MENU_ITEM_COUNT);
        return;
      }
      if (data === " ") {
        if (conversationsMenuIndex === 0) {
          toggleConversationsSearchCaseSensitive();
        } else if (conversationsMenuIndex === 1) {
          toggleConversationsSearchRegex();
        }
        return;
      }
      return;
    }
    if (data === "\t") {
      openConversationsMenu();
      return;
    }
    if (data === PAGE_UP || data === PAGE_DOWN) {
      if (results.length === 0 || conversationsResults.total <= 0) {
        setConversationsResultIndex(0);
        return;
      }
      const currentAbsoluteIndex = conversationsPageOffset + conversationsResultIndex;
      const delta = data === PAGE_UP ? -1 : 1;
      const targetAbsoluteIndex =
        (currentAbsoluteIndex + delta * CONVERSATIONS_PAGE_SIZE + conversationsResults.total) %
        conversationsResults.total;
      goToConversationsAbsoluteIndex(targetAbsoluteIndex);
      return;
    }
    // Arrow up — navigate results (wraps to bottom)
    if (data === "\x1b[A") {
      if (results.length === 0) {
        setConversationsResultIndex(0);
        return;
      }
      if (conversationsResultIndex <= 0) {
        if (conversationsPageOffset > 0) {
          showNewerConversationsPage();
          setConversationsResultIndex(Math.max(0, Math.min(conversationsLoadedCount, conversationsResults.total) - 1));
        } else if (conversationsResults.hasMore) {
          jumpToOldestConversationsPage();
          setConversationsResultIndex(
            Math.max(0, conversationsResults.total - 1 - getOldestConversationsPageOffset(conversationsResults.total)),
          );
        } else {
          setConversationsResultIndex(results.length - 1);
        }
        return;
      }
      setConversationsResultIndex(conversationsResultIndex - 1);
      return;
    }
    // Arrow down — navigate results (wraps to top)
    if (data === "\x1b[B") {
      if (results.length === 0) {
        setConversationsResultIndex(0);
        return;
      }
      if (conversationsResultIndex >= results.length - 1) {
        if (conversationsResults.hasMore) {
          if (conversationsPageOffset > 0) {
            showOlderConversationsPage();
            setConversationsResultIndex(0);
          } else {
            loadMoreConversations();
            setConversationsResultIndex(conversationsResultIndex + 1);
          }
        } else if (conversationsPageOffset > 0) {
          jumpToNewestConversationsPage();
          setConversationsResultIndex(0);
        } else {
          setConversationsResultIndex(0);
        }
        return;
      }
      const nextIndex = conversationsResultIndex + 1;
      if (
        conversationsPageOffset === 0 &&
        shouldLoadMoreConversations(nextIndex, results.length, conversationsResults.hasMore)
      ) {
        loadMoreConversations();
      }
      setConversationsResultIndex(nextIndex);
      return;
    }
    // Esc or Alt+C closes (must be after arrow key checks since \x1b is a prefix of arrow sequences)
    if (isDismissKey(data) || seq === "conversations") {
      closeConversationsDialog();
      return;
    }
    // Enter — select focused result
    if (data === "\r" || data === "\n") {
      if (results.length === 0) return;
      handleConversationsSelect(results[conversationsResultIndex]);
      return;
    }
    // Line-editing: text input, cursor motion, word/line deletion.
    const editResult = applyLineEdit({ cursor: conversationsCursor, query: conversationsQuery }, data);
    if (editResult.handled) {
      if (editResult.queryChanged) {
        setConversationsQuery(editResult.next.query);
        resetConversationsPagination();
      }
      if (editResult.next.cursor !== conversationsCursor) {
        setConversationsCursor(editResult.next.cursor);
      }
      return;
    }
    return;
  }

  // MainMenu dialog / command palette
  if (mainMenuDialogOpen) {
    // --- Capture mode: identify key via identifyKeySequence which handles
    // legacy, kitty CSI u, and xterm modifyOtherKeys encodings uniformly.
    if (mainMenuCapturing) {
      const action = getMainMenuActionForSlot(mainMenuSelectedRow, mainMenuSelectedCol);

      // --- Normal capture ---
      const rawEvent = parseRawKeyEvent(data);
      // Drop non-modifier release events
      if (rawEvent?.eventType === 3 && !rawEvent.isModifierOnly) return;
      // Silently ignore modifier-only press events — wait for the release
      // so that combos like alt+a aren't pre-empted by the bare Alt press.
      if (rawEvent?.isModifierOnly && rawEvent.eventType === 1) return;
      // Suppress modifier-only release if the preceding combo was rejected
      if (rawEvent?.isModifierOnly && rawEvent.eventType === 3 && suppressNextModifierRelease) {
        suppressNextModifierRelease = false;
        return;
      }
      const combo = identifyKeySequence(data);
      // Cancel on Escape or Enter
      if (combo === "escape" || isEscape(data) || combo === "enter" || data === "\r" || data === "\n") {
        suppressNextModifierRelease = false;
        setMainMenuCapturing(false);
        setMainMenuCaptureError("");
        return;
      }
      // Backspace/Delete unmaps
      if (combo === "backspace" || combo === "ctrl+h" || data === "\x7f" || data === "\x08") {
        if (action === "mainMenu") {
          const canonical = identifyKeySequence(DEFAULT_KEYBINDINGS.mainMenu);
          if (canonical) {
            const occupant = sequenceMapRef.current.get(canonical);
            if (occupant && occupant !== "mainMenu") onMainMenuBindingChange(occupant, "");
            onMainMenuBindingChange(action, canonical);
          }
        } else if (action) {
          onMainMenuBindingChange(action, "");
        }
        suppressNextModifierRelease = false;
        setMainMenuCapturing(false);
        setMainMenuCaptureError("");
        return;
      }
      // Accept modifier-only release events (standalone modifier tap)
      if (rawEvent?.isModifierOnly && rawEvent.eventType === 3 && rawEvent.code in MODIFIER_KEY_CODES) {
        const name = MODIFIER_KEY_CODES[rawEvent.code]!;
        if (name === configTmuxPrefixKeyAlias) {
          setMainMenuCaptureError(
            `${formatModifierKeyCode(rawEvent.code)} already bound to ${TMUX_PREFIX_KEY_ALIAS_CONFLICT_LABEL}`,
          );
          return;
        }
        const existingAction = sequenceMapRef.current.get(name);
        if (existingAction && existingAction !== action) {
          const label = ACTION_LABELS[existingAction] ?? existingAction;
          setMainMenuCaptureError(`${formatModifierKeyCode(rawEvent.code)} already bound to ${label}`);
          return;
        }
        if (action) onMainMenuBindingChange(action, name);
        suppressNextModifierRelease = false;
        setMainMenuCapturing(false);
        setMainMenuCaptureError("");
        return;
      }
      // Require at least one modifier for non-modifier keys
      if (!combo || !/\b(ctrl|alt|shift)\b/.test(combo)) return;
      // Check for conflict with another action
      const existingAction = sequenceMapRef.current.get(combo);
      if (existingAction && existingAction !== action) {
        const label = ACTION_LABELS[existingAction] ?? existingAction;
        setMainMenuCaptureError(`${formatKeyCombo(combo)} already bound to ${label}`);
        suppressNextModifierRelease = true;
        return;
      }
      suppressNextModifierRelease = false;
      if (action) onMainMenuBindingChange(action, combo);
      setMainMenuCapturing(false);
      setMainMenuCaptureError("");
      return;
    }

    // --- Normal mode ---
    // Escape closes
    const combo = identifyKeySequence(data);
    if (combo === "escape" || isDismissKey(data)) {
      setMainMenuDialogOpen(false);
      return;
    }
    // MainMenu keybinding closes and forwards the key to the terminal
    if (combo && sequenceMapRef.current.get(combo) === "mainMenu") {
      setMainMenuDialogOpen(false);
      writeToPty(data);
      return;
    }
    // Tab / Shift+Tab cycle tabs
    if (data === "\t") {
      const idx = MAIN_MENU_TAB_ORDER.indexOf(mainMenuTab);
      setMainMenuTab(MAIN_MENU_TAB_ORDER[(idx + 1) % MAIN_MENU_TAB_ORDER.length]!);
      setMainMenuSelectedRow(0);
      setMainMenuSelectedCol("left");
      return;
    }
    if (data === "\x1b[Z") {
      const idx = MAIN_MENU_TAB_ORDER.indexOf(mainMenuTab);
      setMainMenuTab(MAIN_MENU_TAB_ORDER[(idx - 1 + MAIN_MENU_TAB_ORDER.length) % MAIN_MENU_TAB_ORDER.length]!);
      setMainMenuSelectedRow(0);
      setMainMenuSelectedCol("left");
      return;
    }
    // About tab has no selectable rows — skip navigation
    if (mainMenuTab === "about") return;
    // Up/Down arrows navigate rows (snap sticky cols to binding cols)
    if (data === "\x1b[A") {
      if (mainMenuSelectedCol === "left-sticky") setMainMenuSelectedCol("left");
      else if (mainMenuSelectedCol === "right-sticky") setMainMenuSelectedCol("right");
      setMainMenuSelectedRow((r: number) => (r <= 0 ? mainMenuRowCount - 1 : r - 1));
      return;
    }
    if (data === "\x1b[B") {
      if (mainMenuSelectedCol === "left-sticky") setMainMenuSelectedCol("left");
      else if (mainMenuSelectedCol === "right-sticky") setMainMenuSelectedCol("right");
      setMainMenuSelectedRow((r: number) => (r >= mainMenuRowCount - 1 ? 0 : r + 1));
      return;
    }
    // Left/Right arrows switch columns (zoom row has 4 stops: left, left-sticky, right-sticky, right)
    if (data === "\x1b[C" || data === "\x1b[D") {
      const isRight = data === "\x1b[C";
      const isZoomRow = mainMenuTab === "functions" && mainMenuSelectedRow === ZOOM_ROW_IDX;
      if (isZoomRow) {
        const order: MainMenuSelectedCol[] = ["left", "left-sticky", "right-sticky", "right"];
        const idx = order.indexOf(mainMenuSelectedCol);
        const next = isRight ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0);
        setMainMenuSelectedCol(order[next]!);
      } else {
        setMainMenuSelectedCol(
          mainMenuSelectedCol === "left" || mainMenuSelectedCol === "left-sticky" ? "right" : "left",
        );
      }
      return;
    }
    // Space toggles sticky mode when on a sticky column
    if (data === " ") {
      if (mainMenuSelectedCol === "left-sticky") {
        onToggleZoomSticky("zoomAgentsView");
        return;
      }
      if (mainMenuSelectedCol === "right-sticky") {
        onToggleZoomSticky("zoomServerView");
        return;
      }
    }
    // Delete/Backspace unmaps the selected slot directly
    if (data === "\x7f" || data === "\x08" || /^\x1b\[3(?:;\d+(?::\d+)?)?~$/.test(data)) {
      const action = getMainMenuActionForSlot(mainMenuSelectedRow, mainMenuSelectedCol);
      if (action === "mainMenu") {
        // mainMenu must always remain bound — revert to default ctrl+g
        const canonical = identifyKeySequence(DEFAULT_KEYBINDINGS.mainMenu);
        if (canonical) {
          const occupant = sequenceMapRef.current.get(canonical);
          if (occupant && occupant !== "mainMenu") onMainMenuBindingChange(occupant, "");
          onMainMenuBindingChange(action, canonical);
        }
      } else if (action) {
        onMainMenuBindingChange(action, "");
      }
      return;
    }
    // Enter starts binding capture on selected slot
    if (data === "\r" || data === "\n") {
      const action = getMainMenuActionForSlot(mainMenuSelectedRow, mainMenuSelectedCol);
      if (action) {
        setMainMenuCaptureError("");
        setMainMenuCapturing(true);
      }
      return;
    }
    // Letter keys dispatch functions (Functions tab only)
    if (
      mainMenuTab === "functions" &&
      data.length === 1 &&
      ((data >= "a" && data <= "z") || (data >= "A" && data <= "Z"))
    ) {
      const action = LETTER_MAP[data.toLowerCase()];
      if (
        action &&
        action !== "mainMenu" &&
        (mainMenuPaneTabsEnabled || (action !== "newPaneTab" && action !== "prevPaneTab" && action !== "nextPaneTab"))
      ) {
        onMainMenuAction(action);
        return;
      }
    }
    return;
  }

  // Screenshot "large image" notice dialog (higher priority than the done
  // dialog because it is shown while the render/write is still in flight).
  if (screenshotLargeDialogOpen) {
    handleScreenshotLargeDialogInput(data, dismissScreenshotLargeDialog);
    return;
  }

  // Screenshot done dialog
  if (screenshotDonePath !== null) {
    const result = handleScreenshotDoneDialogInput(
      data,
      screenshotDoneButtonCol,
      () => {
        copyToClipboard(screenshotDonePath!);
        setScreenshotDonePath(null);
      },
      () => setScreenshotDonePath(null),
    );
    if (result !== null && result !== "handled") {
      setScreenshotDoneButtonCol(result);
    }
    return;
  }

  // Screenshot dialog
  if (screenshotDialogOpen) {
    const result = handleScreenshotDialogInput(
      data,
      screenshotButtonCol,
      () => handleScreenshotCapture("viewport"),
      () => handleScreenshotCapture("scrollback"),
      () => setScreenshotDialogOpen(false),
      screenshotScrollbackDisabled,
      sequenceMapRef.current,
    );
    if (result !== null && result !== "handled") {
      setScreenshotButtonCol(result);
    }
    return;
  }

  // Disable pane tabs confirmation dialog
  if (paneTabDisableConfirmOpen) {
    const result = handleDisablePaneTabsDialogInput(
      data,
      paneTabDisableConfirmButtonCol,
      handlePaneTabDisableConfirm,
      handlePaneTabDisableCancel,
    );
    if (result !== null && result !== "handled") {
      setPaneTabDisableConfirmButtonCol(result);
    }
    return;
  }

  // Agents dialog: input is routed via dropdownInputRef
  if (agentDialogState.agentsDialogOpen && dropdownInputRef.current) {
    dropdownInputRef.current(data);
    return;
  }

  // Options dialog
  if (optionsDialogOpen) {
    dispatchOptionsDialogInput(data, {
      dropdownInputRef,
      onReturnToMainMenu: () => setMainMenuDialogOpen(true),
      optionsWorkflow,
      sequenceMapRef,
    });
    return;
  }
}

export function shouldLoadMoreConversations(nextIndex: number, loadedCount: number, hasMore: boolean): boolean {
  return hasMore && loadedCount > 0 && nextIndex >= Math.max(0, loadedCount - CONVERSATIONS_LOAD_MORE_THRESHOLD);
}
