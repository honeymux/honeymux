/* eslint-disable no-control-regex */
import type { KeyAction } from "../util/keybindings.ts";

import { type ForwardMode, reEncodeChunk, reEncodeCsiU } from "../util/csiu-reencode.ts";
import { MODIFIER_KEY_CODES, identifyKeySequence, parseRawKeyEvent } from "../util/keybindings.ts";
import { allowsGlobalModifierBindings, resolveInputOwner } from "./input-owner.ts";
import { classifyTerminalResponse } from "./terminal-response-classifier.ts";

function activeForwardMode(callbacks: InputRouterCallbacks): ForwardMode | null {
  if (!callbacks.isReEncodeActive?.()) return null;
  return callbacks.isExtendedKeysActive?.() ? "extended-csi-u" : "legacy";
}

/** Actions that are allowed to fall through the review-preview muxotron-focus
 *  surface's "dismiss on any key" branch, so they can be dispatched via
 *  the review gate / latch key handler below instead of tearing down
 *  the focus. */
const REVIEW_FALLTHROUGH_ACTIONS = new Set<KeyAction>([
  "agentLatch",
  "agentReviewGoto",
  "agentReviewNext",
  "agentReviewPrev",
]);

export interface InputRouterCallbacks {
  getActiveZoomAction?: () => KeyAction | null;
  /** Returns true when the active dialog has registered a hamburger menu
   *  toggle. When false, the activateMenu hotkey is routed to the dialog
   *  input handler so it acts as a no-op rather than opening the pane menu
   *  underneath the dialog. */
  hasDialogHamburger?: () => boolean;
  /** True when a tree-selected agent is being previewed in the muxotron focus surface. */
  isAgentPreview?: () => boolean;
  /** When true, the dialog is in key-capture mode (e.g. main menu dialog rebinding zoom keys).
   *  Zoom triggers should be suppressed so the dialog can capture them. */
  isDialogCapturing?: () => boolean;
  /** When true, keys are dispatched to dialog input handler instead of PTY. */
  isDialogOpen?: () => boolean;
  /** When true, keys are dispatched to dropdown handler instead of PTY. */
  isDropdownOpen?: () => boolean;
  /** Whether tmux's `extended-keys` option is on (or always). When true,
   *  re-encoding emits CSI u for ambiguous modifier combinations so tmux
   *  can preserve them through dispatch to apps that ask for extended keys. */
  isExtendedKeysActive?: () => boolean;
  /** True while the focused muxotron view is attached to an agent pane PTY. */
  isInteractiveAgent?: () => boolean;
  isMobileMode?: () => boolean;
  isMuxotronFocusActive?: () => boolean;
  isQuickTerminalOpen?: () => boolean;
  /** Whether CSI u re-encoding is active (Kitty flags 15). */
  isReEncodeActive?: () => boolean;
  isReady: () => boolean;
  /** True when the review session is latched — keys route to the agent PTY. */
  isReviewLatched?: () => boolean;
  /** Returns true if the sidebar has keyboard focus (arrows navigate, Esc cancels). */
  isSidebarFocused?: () => boolean;
  isTextInputActive?: () => boolean;
  isTooNarrow?: () => boolean;
  /** Returns true if the toolbar has keyboard focus (Enter activates, arrows navigate). */
  isToolbarFocused?: () => boolean;
  isToolbarOpen?: () => boolean;
  /** Returns true if the given zoom action uses sticky (tap-to-toggle) mode. */
  isZoomStickyAction?: (action: KeyAction) => boolean;
  /** Returns true when a modifier key code should act as a tmux prefix alias. */
  matchTmuxPrefixKeyAliasCode?: (code: number) => boolean;
  /** Check if a modifier key code matches a zoom binding. Returns the action or null. */
  matchZoomCode?: (code: number) => KeyAction | null;
  onActivateMenu?: () => void;
  /** Handle the context-sensitive agent latch binding (agentLatch) when no
   *  tree-selected review session is active: toggles the muxotron zoom onto
   *  the oldest unanswered agent. */
  onAgentLatch?: () => void;
  /** Navigate to next agent in tree-selection zoom mode. */
  onAgentNext?: () => void;
  /** Navigate to previous agent in tree-selection zoom mode. */
  onAgentPrev?: () => void;
  onApplyFavoriteProfile?: () => void;
  onBufferZoom?: () => void;
  onCloseQuickTerminal?: () => void;
  onDialogInput?: (data: string) => void;
  onDismissAgent?: () => void;
  onDropdownInput?: (data: string) => boolean;
  onGotoAgent?: () => void;
  onMobileEscape?: () => void;
  /** Dismiss the focused muxotron / interactive-agent surface. */
  onMuxotronDismiss?: () => void;
  onNewPaneTab?: () => void;
  onNextPaneTab?: () => void;
  onOpenAgents?: () => void;
  onOpenConversations?: () => void;
  onOpenMainMenu?: () => void;
  onOpenNotifications?: () => void;
  onOpenOptions?: () => void;
  onOpenProfiles?: () => void;
  onOpenQuickTerminal?: () => void;
  onOpenSessions?: () => void;
  onPrevPaneTab?: () => void;
  onQuickApprove?: () => void;
  onQuickDeny?: () => void;
  onRedraw?: () => void;
  onReview?: () => void;
  /** Toggle latch between preview and interactive modes for the selected review agent. */
  onReviewLatchToggle?: () => void;
  onScreenshot?: () => void;
  onSessionNext?: () => void;
  onSessionPrev?: () => void;
  onSidebarActivate?: () => void;
  onSidebarCancel?: () => void;
  onSidebarDown?: () => void;
  onSidebarFocus?: () => void;
  onSidebarLeft?: () => void;
  onSidebarRight?: () => void;
  onSidebarUp?: () => void;
  /** Space on a focused sidebar row — triggers the secondary action (agents: muxotron-focus workflow). */
  onSidebarZoom?: () => void;
  onTabNext: () => void;
  onTabPrev: () => void;
  onTextInputEscape?: () => void;
  onTmuxPrefixKeyAlias?: () => void;
  onToggleMobile?: () => void;
  onToggleSidebar?: () => void;
  onToggleToolbar?: () => void;
  onTooNarrowInput?: () => void;
  onToolbarActivate?: () => void;
  onToolbarCancel?: () => void;
  onToolbarDown?: () => void;
  onToolbarFocus?: () => void;
  onToolbarUp?: () => void;
  onZoomEnd?: () => void;
  // --- Modifier zoom ---
  onZoomStart?: (action: KeyAction) => void;
}

export function routeKeyboardInput(
  sequence: string,
  writeToPty: (data: string) => void,
  callbacks: InputRouterCallbacks,
  keybindings: Map<string, KeyAction>,
): boolean {
  // Let OpenTUI's mouse parser handle SGR mouse sequences.
  if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(sequence)) return false;

  const response = classifyTerminalResponse(sequence);
  if (response === "opentui") return false;
  if (response === "consume") return true;

  const rawEvent = parseRawKeyEvent(sequence);
  const canonical = identifyKeySequence(sequence);
  const canonicalAction = canonical ? keybindings.get(canonical) : undefined;
  const interactiveAgent = callbacks.isInteractiveAgent?.() ?? false;
  const owner = resolveInputOwner({
    dialogCapturing: callbacks.isDialogCapturing?.() ?? false,
    dialogOpen: callbacks.isDialogOpen?.() ?? false,
    dropdownOpen: callbacks.isDropdownOpen?.() ?? false,
    mobileMode: callbacks.isMobileMode?.() ?? false,
    quickTerminalOpen: callbacks.isQuickTerminalOpen?.() ?? false,
    reviewLatched: callbacks.isReviewLatched?.() ?? false,
    sidebarFocused: callbacks.isSidebarFocused?.() ?? false,
    textInputActive: callbacks.isTextInputActive?.() ?? false,
    toolbarFocused: callbacks.isToolbarFocused?.() ?? false,
  });

  // Drop release events for normal keys (always, even in dialogs).
  if (rawEvent?.eventType === 3 && !rawEvent.isModifierOnly) return true;

  // Preview mode (tree-selected agent, not yet latched): Enter promotes the
  // muxotron from preview into interactive latched mode. Only fires when
  // chrome focus is in the pty slot — if the sidebar or another owner has
  // focus, Enter belongs to that owner's activation handler (e.g. the
  // sidebar's "goto" action).
  if (
    owner === "pty" &&
    callbacks.isAgentPreview?.() &&
    (canonical === "enter" || sequence === "\r" || sequence === "\n")
  ) {
    callbacks.onReviewLatchToggle?.();
    return true;
  }

  // Look up the action a modifier-only key is bound to (independent of
  // any zoom/latch state). This lets review-fallthrough actions like
  // agentLatch skip the zoom-swallow block below.
  const modifierOnlyActionName: KeyAction | undefined =
    rawEvent?.isModifierOnly && MODIFIER_KEY_CODES[rawEvent.code]
      ? keybindings.get(MODIFIER_KEY_CODES[rawEvent.code]!)
      : undefined;
  const modifierIsReviewFallthrough =
    !!modifierOnlyActionName && REVIEW_FALLTHROUGH_ACTIONS.has(modifierOnlyActionName);

  // Global agentLatch dispatch — fires regardless of chrome focus
  // (sidebar/toolbar/dropdown) so the review workflow's latch/release
  // toggle always works when the user presses their bound key. Skipped
  // when a dialog or text input owns the keyboard.
  const latchResolvedAction: KeyAction | undefined = canonicalAction ?? modifierOnlyActionName;
  if (
    latchResolvedAction === "agentLatch" &&
    (owner === "pty" || owner === "sidebar" || owner === "toolbar" || owner === "dropdown")
  ) {
    // Modifier-only keys fire only on press events; drop repeats and
    // releases so each tap triggers the action exactly once.
    if (rawEvent?.isModifierOnly && rawEvent.eventType !== 1) return true;
    if (callbacks.isReviewLatched?.() || callbacks.isAgentPreview?.()) {
      callbacks.onReviewLatchToggle?.();
    } else {
      callbacks.onAgentLatch?.();
    }
    return true;
  }

  // Zoom modifier key: hold-to-peek / tap-to-latch semantics when a non-
  // interactive zoom view is open. Interactive mode lets the modifier fall
  // through to the normal handler further down so the user can still
  // dismiss via a second tap.
  if (rawEvent && callbacks.isMuxotronFocusActive?.() && !interactiveAgent && !modifierIsReviewFallthrough) {
    if (rawEvent.isModifierOnly) {
      const zoomAction = callbacks.matchZoomCode?.(rawEvent.code);
      if (zoomAction) {
        const activeZoomAction = callbacks.getActiveZoomAction?.() ?? null;
        // Zoom activated by a non-key source (tree selection, or auto-
        // expanded muxotron overriding the action to null): any zoom
        // modifier press dismisses.
        if (activeZoomAction === null) {
          if (rawEvent.eventType === 1) callbacks.onZoomEnd?.();
          return true;
        }
        if (callbacks.isZoomStickyAction?.(zoomAction)) {
          if (rawEvent.eventType === 1 && activeZoomAction === zoomAction) {
            callbacks.onZoomEnd?.();
          }
          return true;
        }
        // Hold mode: ignore repeats, end on release.
        if (rawEvent.eventType !== 3) return true;
        callbacks.onZoomEnd?.();
        return true;
      }
      return true;
    }
    if (rawEvent.eventType === 1) {
      if (rawEvent.specialKey === "B" && callbacks.onAgentNext) {
        callbacks.onAgentNext();
        return true;
      }
      if (rawEvent.specialKey === "A" && callbacks.onAgentPrev) {
        callbacks.onAgentPrev();
        return true;
      }
    }
    // In review preview mode, let review-workflow keybindings and the
    // latch key fall through to the action dispatch below. Non-review
    // keys still dismiss the zoom as before.
    if (callbacks.isAgentPreview?.() && canonicalAction && REVIEW_FALLTHROUGH_ACTIONS.has(canonicalAction)) {
      // fall through
    } else {
      callbacks.onZoomEnd?.();
      return true;
    }
  }

  // Plain arrow keys bypass parseRawKeyEvent since they lack CSI u or
  // modifier parameters. Handle them here for non-interactive muxotron-focus
  // navigation (tree-selected peek cycles through agents). Interactive
  // mode forwards arrows to the PTY.
  if (callbacks.isMuxotronFocusActive?.() && !interactiveAgent) {
    if (sequence === "\x1b[B" && callbacks.onAgentNext) {
      callbacks.onAgentNext();
      return true;
    }
    if (sequence === "\x1b[A" && callbacks.onAgentPrev) {
      callbacks.onAgentPrev();
      return true;
    }
  }

  // Interactive (sticky auto-target) muxotron: Esc dismisses the zoom
  // surface instead of leaking to the PTY. This only applies to the
  // non-tree-selection sticky path — latched tree selections forward Esc
  // to the agent PTY so interactive prompts can be cancelled.
  if (interactiveAgent && !callbacks.isReviewLatched?.() && (canonical === "escape" || sequence === "\x1b")) {
    callbacks.onMuxotronDismiss?.();
    return true;
  }

  // Text input mode: let OpenTUI handle keys for focused textarea.
  if (owner === "textInput") {
    if (canonical === "escape" || sequence === "\x1b") {
      callbacks.onTextInputEscape?.();
      return true;
    }
    return false;
  }

  // Dialog mode: forward all input to the dialog handler.
  // Allow activateMenu to toggle the active dialog's hamburger menu, but only
  // when one is registered — otherwise the key would fall through to the
  // pane-border menu underneath, which is inconsistent with how other hotkeys
  // are consumed by the dialog as no-ops.
  if (owner === "dialog" || owner === "dialogCapture") {
    if (owner === "dialog" && canonicalAction === "activateMenu" && (callbacks.hasDialogHamburger?.() ?? false)) {
      callbacks.onActivateMenu?.();
      return true;
    }
    return routeDialogInput(sequence, callbacks);
  }

  // Mobile mode: Escape exits to desktop UI (if screen is large enough).
  if (owner === "mobile" && (canonical === "escape" || sequence === "\x1b")) {
    callbacks.onMobileEscape?.();
    return true;
  }

  // Toolbar focused: up/down navigate, Enter activates, Esc cancels,
  // any other key cancels focus and is consumed.
  if (owner === "toolbar") {
    // Ignore modifier-only press/release events so that releasing the
    // hotkey that triggered focus doesn't immediately cancel it.
    if (rawEvent?.isModifierOnly) return true;
    if (canonical === "up") {
      callbacks.onToolbarUp?.();
      return true;
    }
    if (canonical === "down") {
      callbacks.onToolbarDown?.();
      return true;
    }
    if (canonical === "enter") {
      callbacks.onToolbarActivate?.();
      return true;
    }
    if (canonical === "escape") {
      callbacks.onToolbarCancel?.();
      return true;
    }
    callbacks.onToolbarCancel?.();
    return true;
  }

  // Sidebar focused: arrows navigate, Enter activates, Esc cancels,
  // any other key cancels focus and is consumed.
  if (owner === "sidebar") {
    // Review preview entered from the sidebar intentionally keeps sidebar
    // focus so arrowing the tree can retarget the preview. The review
    // shortcuts must still work without first consuming a key to unfocus.
    if (canonicalAction === "agentReviewGoto" && callbacks.isAgentPreview?.()) {
      callbacks.onGotoAgent?.();
      return true;
    }
    if (canonicalAction === "agentReviewPrev" && callbacks.isAgentPreview?.()) {
      callbacks.onAgentPrev?.();
      return true;
    }
    if (canonicalAction === "agentReviewNext" && callbacks.isAgentPreview?.()) {
      callbacks.onAgentNext?.();
      return true;
    }
    // `agentPermGoto` is allowed to bypass the sidebar branch so its
    // global handler (which also releases chrome focus) still works from a
    // keyboard shortcut while the sidebar has focus. Other agent actions
    // (approve/deny/dismiss) stay consumed here so the sidebar can retain
    // focus and move to the next row.
    if (canonicalAction === "agentPermGoto") {
      // fall through to the global action handler below
    } else {
      // Ignore modifier-only press/release events so that releasing the
      // hotkey that triggered focus doesn't immediately cancel it.
      if (rawEvent?.isModifierOnly) return true;
      if (canonical === "up") {
        callbacks.onSidebarUp?.();
        return true;
      }
      if (canonical === "down") {
        callbacks.onSidebarDown?.();
        return true;
      }
      if (canonical === "left") {
        callbacks.onSidebarLeft?.();
        return true;
      }
      if (canonical === "right") {
        callbacks.onSidebarRight?.();
        return true;
      }
      if (canonical === "enter") {
        callbacks.onSidebarActivate?.();
        return true;
      }
      if (sequence === " " || canonical === " " || /^\x1b\[32(?:;\d+(?::\d+)?)?u$/.test(sequence)) {
        callbacks.onSidebarZoom?.();
        return true;
      }
      if (canonical === "escape") {
        callbacks.onSidebarCancel?.();
        return true;
      }
      callbacks.onSidebarCancel?.();
      return true;
    }
  }

  // Dropdowns keep a small allowlist of global shortcuts so their owning
  // surface can still be toggled closed with its dedicated hotkey.
  if (owner === "dropdown") {
    if (canonicalAction === "agents") {
      callbacks.onOpenAgents?.();
      return true;
    }
    if (canonicalAction === "toolbar") {
      callbacks.onToggleToolbar?.();
      return true;
    }
    if (canonicalAction === "sidebar") {
      callbacks.onToggleSidebar?.();
      return true;
    }
    if (canonicalAction === "mobile") {
      callbacks.onToggleMobile?.();
      return true;
    }
    if (canonicalAction === "activateMenu") {
      callbacks.onActivateMenu?.();
      return true;
    }
    return routeDropdownInput(sequence, callbacks);
  }

  let modifierOnlyAction: KeyAction | undefined;
  if (rawEvent?.isModifierOnly) {
    if (allowsGlobalModifierBindings(owner)) {
      if (callbacks.matchTmuxPrefixKeyAliasCode?.(rawEvent.code)) {
        if (rawEvent.eventType === 3) callbacks.onTmuxPrefixKeyAlias?.();
        return true;
      }

      const zoomAction = callbacks.matchZoomCode?.(rawEvent.code);
      if (zoomAction) {
        if (callbacks.isZoomStickyAction?.(zoomAction)) {
          if (rawEvent.eventType === 1) {
            if (callbacks.isMuxotronFocusActive?.()) callbacks.onZoomEnd?.();
            else callbacks.onZoomStart?.(zoomAction);
          }
        } else if (rawEvent.eventType === 1) {
          callbacks.onZoomStart?.(zoomAction);
        } else if (rawEvent.eventType === 3) {
          callbacks.onZoomEnd?.();
        }
        return true;
      }

      if (rawEvent.eventType === 1) {
        const modName = MODIFIER_KEY_CODES[rawEvent.code];
        if (modName) {
          modifierOnlyAction = keybindings.get(modName);
        }
      }
    }

    // Never leak bare modifier-only events to the PTY.
    if (!modifierOnlyAction) return true;
  }

  const action = canonicalAction ?? modifierOnlyAction;

  // Review workflow shortcuts — active only while a tree-selected agent is
  // in preview mode (muxotron-focused, unlatched), and chrome focus is on the pty
  // slot. Once latched, these letters fall through to the PTY so interactive
  // prompts can consume them.
  if (owner === "pty" && callbacks.isAgentPreview?.()) {
    if (action === "agentReviewGoto") {
      callbacks.onGotoAgent?.();
      return true;
    }
    if (action === "agentReviewPrev") {
      callbacks.onAgentPrev?.();
      return true;
    }
    if (action === "agentReviewNext") {
      callbacks.onAgentNext?.();
      return true;
    }
  }

  // Quick terminal overlay: before generic action handling so its close/menu
  // shortcuts are kept local to the overlay.
  if (owner === "quickTerminal") {
    if (action === "quickTerminal" || action === "mainMenu") {
      callbacks.onCloseQuickTerminal?.();
      return true;
    }
    if (action === "activateMenu") {
      callbacks.onActivateMenu?.();
      return true;
    }
    writeSequenceToPty(sequence, callbacks, writeToPty);
    return true;
  }

  // Combo-based zoom trigger (toggle mode). Modifier-only zoom triggers are
  // handled above with hold/tap semantics.
  if (action === "zoomAgentsView" || action === "zoomServerView") {
    if (callbacks.isMuxotronFocusActive?.()) callbacks.onZoomEnd?.();
    else callbacks.onZoomStart?.(action);
    return true;
  }

  // Context-sensitive latch key: latch/unlatch in a review session,
  // otherwise trigger a muxotron zoom targeting the oldest unanswered agent.
  if (action === "agentLatch") {
    if (callbacks.isReviewLatched?.() || callbacks.isAgentPreview?.()) {
      callbacks.onReviewLatchToggle?.();
    } else {
      callbacks.onAgentLatch?.();
    }
    return true;
  }

  // Tab switching + navigation.
  if (action === "prevWindow") {
    callbacks.onTabPrev();
    return true;
  }
  if (action === "nextWindow") {
    callbacks.onTabNext();
    return true;
  }
  if (action === "prevSession") {
    callbacks.onSessionPrev?.();
    return true;
  }
  if (action === "nextSession") {
    callbacks.onSessionNext?.();
    return true;
  }
  if (action === "review") {
    callbacks.onReview?.();
    return true;
  }

  if (action === "sessions") {
    callbacks.onOpenSessions?.();
    return true;
  }
  if (action === "conversations") {
    callbacks.onOpenConversations?.();
    return true;
  }
  if (action === "agentPermApprove") {
    callbacks.onQuickApprove?.();
    return true;
  }
  if (action === "agentPermDeny") {
    callbacks.onQuickDeny?.();
    return true;
  }
  if (action === "agentPermGoto") {
    callbacks.onGotoAgent?.();
    return true;
  }
  if (action === "agentPermDismiss") {
    callbacks.onDismissAgent?.();
    return true;
  }
  if (action === "agents") {
    callbacks.onOpenAgents?.();
    return true;
  }
  if (action === "notifications") {
    callbacks.onOpenNotifications?.();
    return true;
  }
  if (action === "toolbar") {
    callbacks.onToggleToolbar?.();
    return true;
  }
  if (action === "sidebar") {
    callbacks.onToggleSidebar?.();
    return true;
  }
  if (action === "mobile") {
    callbacks.onToggleMobile?.();
    return true;
  }
  if (action === "toolbarFocus") {
    callbacks.onToolbarFocus?.();
    return true;
  }
  if (action === "sidebarFocus") {
    callbacks.onSidebarFocus?.();
    return true;
  }
  if (action === "activateMenu") {
    callbacks.onActivateMenu?.();
    return true;
  }

  if (action === "mainMenu") {
    callbacks.onOpenMainMenu?.();
    return true;
  }
  if (action === "options") {
    callbacks.onOpenOptions?.();
    return true;
  }
  if (action === "redraw") {
    callbacks.onRedraw?.();
    return true;
  }
  if (action === "newPaneTab") {
    callbacks.onNewPaneTab?.();
    return true;
  }
  if (action === "prevPaneTab") {
    callbacks.onPrevPaneTab?.();
    return true;
  }
  if (action === "nextPaneTab") {
    callbacks.onNextPaneTab?.();
    return true;
  }
  if (action === "profiles") {
    callbacks.onOpenProfiles?.();
    return true;
  }
  if (action === "favoriteProfile") {
    callbacks.onApplyFavoriteProfile?.();
    return true;
  }
  if (action === "quickTerminal") {
    callbacks.onOpenQuickTerminal?.();
    return true;
  }
  if (action === "screenshot") {
    callbacks.onScreenshot?.();
    return true;
  }
  if (action === "bufferZoom") {
    callbacks.onBufferZoom?.();
    return true;
  }

  // Don't forward input until the PTY is ready. This prevents terminal
  // capability responses from leaking to tmux during the startup window.
  if (!callbacks.isReady()) {
    return true;
  }

  if (callbacks.isTooNarrow?.()) {
    callbacks.onTooNarrowInput?.();
    return true;
  }

  writeSequenceToPty(sequence, callbacks, writeToPty);
  return true;
}

function routeDialogInput(sequence: string, callbacks: InputRouterCallbacks): boolean {
  const rawEvent = parseRawKeyEvent(sequence);
  const isModifierOnly = rawEvent?.isModifierOnly;
  // Dialog inputs always read keys in legacy form so dialog handlers don't
  // need their own CSI-u parser; only skip re-encoding when no Kitty
  // negotiation took place.
  const dialogMode = callbacks.isReEncodeActive?.() ? ("legacy" as const) : null;
  const dialogSeq = dialogMode && !isModifierOnly ? (reEncodeCsiU(sequence, dialogMode) ?? undefined) : sequence;
  if (dialogSeq) callbacks.onDialogInput?.(dialogSeq);
  return true;
}

function routeDropdownInput(sequence: string, callbacks: InputRouterCallbacks): boolean {
  const dropdownMode = callbacks.isReEncodeActive?.() ? ("legacy" as const) : null;
  const dropdownSeq = dropdownMode ? (reEncodeCsiU(sequence, dropdownMode) ?? undefined) : sequence;
  if (dropdownSeq) callbacks.onDropdownInput?.(dropdownSeq);
  return true;
}

function writeSequenceToPty(
  sequence: string,
  callbacks: InputRouterCallbacks,
  writeToPty: (data: string) => void,
): void {
  const mode = activeForwardMode(callbacks);
  if (mode) {
    const encoded = reEncodeChunk(sequence, mode);
    if (encoded.length > 0) writeToPty(encoded);
    return;
  }
  writeToPty(sequence);
}
