import type { CliRenderer } from "@opentui/core";
import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import type { TmuxControlClient } from "../tmux/control-client.ts";

import { softWrapContent } from "./buffer-zoom-content.ts";
import {
  type AltScreenFadeHandle,
  fadeInPrimaryScreen,
  fadeOutAltScreen,
  supportsFadeTransitions,
} from "./buffer-zoom-fade.ts";
import { splitSequences } from "./csiu-reencode.ts";
import { parseRawKeyEvent } from "./keybindings.ts";
import { writeTerminalOutput } from "./terminal-output.ts";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_EXIT,
  CLEAR_SCREEN_AND_SCROLLBACK,
  MODIFY_OTHER_KEYS_DISABLE,
  MODIFY_OTHER_KEYS_ENABLE,
} from "./terminal-sequences.ts";
import { stripNonPrintingControlChars } from "./text.ts";

export interface BufferZoomOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  /** When true (and the terminal supports truecolor), use the fade transition. */
  fade: boolean;
  handleRedraw: () => void;
  kittyKeyboardFlags: number;
  /** Maximum lines to capture (0 = unlimited). */
  maxLines: number;
  renderer: CliRenderer;
  suppressPassthroughRef: MutableRefObject<boolean>;
  /** Active pane terminal renderable — its cursor is hidden during the fade transition. */
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
}

let active = false;

export function consumeBufferZoomDismissChunk(
  chunk: string,
  pending: string = "",
): { dismiss: boolean; pending: string } {
  const sequences = splitSequences(pending + chunk);
  let nextPending = "";

  for (let i = 0; i < sequences.length; i++) {
    const sequence = sequences[i]!;
    const isLast = i === sequences.length - 1;
    if (isLast && !isCompleteCsiSequence(sequence)) {
      nextPending = sequence;
      break;
    }

    const rawEvent = parseRawKeyEvent(sequence);
    if (rawEvent?.eventType === 3) continue;
    if (rawEvent?.isModifierOnly) continue;
    if (isBufferZoomMouseRelease(sequence)) continue;
    return { dismiss: true, pending: "" };
  }

  return { dismiss: false, pending: nextPending };
}

export async function enterBufferZoom({
  clientRef,
  fade,
  handleRedraw,
  kittyKeyboardFlags,
  maxLines,
  renderer,
  suppressPassthroughRef,
  terminalRef,
}: BufferZoomOptions): Promise<void> {
  if (active) return;
  const client = clientRef.current;
  if (!client) throw new Error("Not connected");

  active = true;
  let suspended = false;
  let stdinAttached = false;
  let glowTimer: ReturnType<typeof setInterval> | null = null;
  let altScreenFade: AltScreenFadeHandle | null = null;
  // Saved outer-terminal title, captured before we overwrite it with the
  // zoom-active indicator. The xterm title stack (CSI 22;2 t / 23;2 t) is not
  // universally supported, so we restore via an explicit OSC 2 instead.
  let savedTitle = "";
  let haveSavedTitle = false;
  // The pane's terminal cursor is rendered by GhosttyTerminalRenderable, so an
  // OpenTUI-level cursor hide doesn't suppress it. Save the current showCursor
  // state and force it off for the duration of the transition; restored in finally.
  const terminal = terminalRef.current;
  const previousShowCursor = terminal?.showCursor ?? false;
  if (terminal) terminal.showCursor = false;
  try {
    // Capture active pane scrollback with ANSI colors and joined wrapped lines
    const info = await client.getActivePaneScreenshotInfo();
    const output = await client.runCommandArgs(["capture-pane", "-p", "-e", "-J", "-S", "-", "-t", info.paneId]);

    // Snapshot the active pane's current title so we can restore the outer
    // terminal's title on exit. Strip control characters before re-emitting as
    // OSC 2 payload — pane titles are untrusted pane-derived text.
    try {
      const rawTitle = await client.runCommandArgs(["display-message", "-p", "-t", info.paneId, "#{pane_title}"]);
      savedTitle = stripNonPrintingControlChars(rawTitle.replace(/\n$/, ""));
      haveSavedTitle = true;
    } catch {
      // best-effort — if the pane is gone we'll skip the restore
    }

    if (!output) {
      throw new Error("No scrollback content");
    }

    // Cap output to avoid blocking the event loop with a massive terminal
    let content = output;
    if (maxLines > 0) {
      const lines = output.split("\n");
      if (lines.length > maxLines) {
        content = lines.slice(-maxLines).join("\n");
      }
    }

    // Suppress OSC passthrough to stdout while on the normal screen
    suppressPassthroughRef.current = true;

    // Fade out the alt screen before suspending the renderer. The overlay is
    // a translucent box composited by OpenTUI over the existing UI + ghostty
    // pane cells. Gated on truecolor capability AND the user opt-in (fade) —
    // older terminals or users who disabled the effect jump straight to
    // suspend. The fade leaves its overlay box in place at full opacity until
    // we suspend; cleaning it up beforehand causes a one-frame full-brightness
    // flash of the alt screen.
    const fadeEnabled = fade && supportsFadeTransitions();
    if (fadeEnabled) {
      altScreenFade = await fadeOutAltScreen({ renderer });
    }

    // Disable input modes we manage manually (before suspend touches terminal)
    try {
      renderer.disableKittyKeyboard();
    } catch {
      // best-effort
    }
    writeTerminalOutput(MODIFY_OTHER_KEYS_DISABLE);

    // Open a DEC 2026 synchronized-update block before suspending. The
    // native libopentui suspendRenderer explicitly emits
    // "\x1b[?1049l\x1b[?25h" (switch to main screen + show cursor), which
    // would otherwise cause a visible flash of the primary screen's saved
    // cursor between fade-out and fade-in. Wrapping suspend + our clear in a
    // synchronized block lets supporting terminals (iTerm2, Ghostty) hold
    // the displayed frame until we've hidden the cursor and cleared. On
    // terminals without DEC 2026 support the sequences are ignored and we
    // still get the behavior of the earlier writes below.
    writeTerminalOutput("\x1b[?2026h");

    // Fully suspend the renderer. This calls the native suspendRenderer which
    // is the only way to stop the Zig render layer from writing directly to
    // fd 1. pause()/stop() only affect the JS-level render loop scheduler —
    // event-driven renders from tmux control client notifications can still
    // trigger native frame writes that bypass process.stdout.write entirely.
    // suspend() also disables mouse and detaches stdin.
    await renderer.idle();
    renderer.suspend();
    suspended = true;

    // Switch to normal screen and clear it. ESC[0m is emitted before every
    // clear because \x1b[2J / \x1b[3J / \x1b[J fill erased cells using the
    // currently active SGR attributes; any stale reverse/bg state left on the
    // primary screen from a previous session would otherwise bake into the
    // new blank cells.
    const termCols = process.stdout.columns ?? renderer.terminalWidth ?? 80;
    const termRows = process.stdout.rows ?? renderer.terminalHeight ?? 24;
    writeTerminalOutput(ALT_SCREEN_EXIT);
    // Re-hide cursor on the primary screen: native suspendRenderer emits
    // \x1b[?25h, and this undoes that before the synchronized block closes.
    writeTerminalOutput("\x1b[?25l");
    writeTerminalOutput("\x1b[0m" + CLEAR_SCREEN_AND_SCROLLBACK);
    // Close the synchronized-update block. The terminal now atomically
    // presents: primary screen, cleared, cursor hidden.
    writeTerminalOutput("\x1b[?2026l");
    if (fadeEnabled) {
      await fadeInPrimaryScreen({ content, termCols, termRows });
      // The fade animation lays out cells with explicit `\n` at each wrap
      // point so per-frame redraws stay within termRows; the terminal then
      // marks those rows as hard-broken, which makes select+copy across a
      // wrapped line yield a literal newline. Re-render once more via
      // softWrapContent so cells carry the soft-wrap attribute, wrapped in a
      // synchronized-update block to avoid any visible flicker.
      writeTerminalOutput(
        "\x1b[?2026h" + CLEAR_SCREEN_AND_SCROLLBACK + softWrapContent(content) + "\x1b[0m\n\x1b[?2026l",
      );
    } else {
      writeTerminalOutput(softWrapContent(content));
      writeTerminalOutput("\x1b[0m\n");
    }

    // Set terminal title to indicate buffer zoom mode. The prior title is
    // stashed in savedTitle above and restored via OSC 2 on exit.
    writeTerminalOutput("\x1b]2;[[ BUFFER ZOOM ACTIVE ]] · Press any key to dismiss\x07");

    // Re-push Kitty keyboard protocol so modifier-only keypresses (which only
    // Kitty can encode) still generate stdin data and can dismiss the view.
    // The renderer's copy was disabled before suspend; this is a standalone
    // push that we pop before resuming.
    writeTerminalOutput(`\x1b[>${kittyKeyboardFlags}u`);

    // Show cursor at top-left and start a glow animation by cycling
    // its color through grayscale shades via OSC 12.  A sine wave maps
    // [0..2π] to a luminance range that pulses gently between dim gray and
    // near-white.
    writeTerminalOutput("\x1b[9999;1H"); // move cursor to bottom-left
    writeTerminalOutput("\x1b[?25h");
    let glowStep = 0;
    glowTimer = setInterval(() => {
      const lum = Math.round(128 + 127 * Math.sin(glowStep * 0.3));
      const hex = lum.toString(16).padStart(2, "0");
      writeTerminalOutput(`\x1b]12;#${hex}${hex}${hex}\x07`);
      glowStep++;
    }, 100);

    // Re-enable raw stdin for dismiss detection. suspend() detached stdin
    // (paused it, set cooked mode, removed listeners), so we re-attach
    // manually with a simple raw reader.
    process.stdin.setRawMode(true);
    process.stdin.resume();
    stdinAttached = true;

    // Wait for any key-down or mouse-press to dismiss, ignoring release events
    await new Promise<void>((resolve) => {
      let pendingDismissInput = "";
      const onData = (chunk: Buffer) => {
        const result = consumeBufferZoomDismissChunk(chunk.toString(), pendingDismissInput);
        pendingDismissInput = result.pending;
        if (!result.dismiss) return;
        process.stdin.removeListener("data", onData);
        resolve();
      };
      process.stdin.on("data", onData);
    });

    // Clean up: stop glow, reset cursor color, restore title, hide cursor
    clearInterval(glowTimer);
    glowTimer = null;
    writeTerminalOutput("\x1b]112\x07"); // OSC 112: reset cursor color to default
    if (haveSavedTitle) writeTerminalOutput(`\x1b]2;${savedTitle}\x07`);
    writeTerminalOutput("\x1b[?25l"); // hide cursor before renderer takes over
    writeTerminalOutput("\x1b[<u"); // pop Kitty keyboard push
    writeTerminalOutput("\x1b[0m" + CLEAR_SCREEN_AND_SCROLLBACK);

    // Return stdin to the state suspend() left it in before calling resume(),
    // so resume() can re-attach it cleanly.
    process.stdin.setRawMode(false);
    process.stdin.pause();
    stdinAttached = false;

    // Resume renderer — resumes native rendering, enables mouse, re-attaches stdin.
    // resume() restores the control state saved by suspend(), which is the
    // original running state (AUTO_STARTED or EXPLICIT_STARTED).
    renderer.resume();
    suspended = false;

    // Re-enter alt screen (safe no-op if resume already did it)
    writeTerminalOutput(ALT_SCREEN_ENTER);

    // Re-enable input modes.  resumeRenderer() internally pushes Kitty
    // keyboard via enableDetectedFeatures(), which sets state.kitty_keyboard
    // = true in the Zig layer.  A bare enableKittyKeyboard() call would then
    // be a no-op (guarded by `if (!state.kitty_keyboard)`).  Defer a pop +
    // push cycle so the terminal has time to process the resume sequences
    // before we re-push with our flags.
    renderer.enableKittyKeyboard(kittyKeyboardFlags);
    writeTerminalOutput(MODIFY_OTHER_KEYS_ENABLE);
    setTimeout(() => {
      renderer.disableKittyKeyboard();
      renderer.enableKittyKeyboard(kittyKeyboardFlags);
      // Force a second redraw after input modes are fully restored to fix
      // any miscoloration left over from the normal-screen excursion.
      handleRedraw();
    }, 100);

    suppressPassthroughRef.current = false;
    handleRedraw();
    if (altScreenFade) {
      await renderer.idle();
      await altScreenFade.fadeIn();
      altScreenFade = null;
    }
  } finally {
    if (glowTimer != null) {
      clearInterval(glowTimer);
      try {
        writeTerminalOutput("\x1b]112\x07"); // reset cursor color
        if (haveSavedTitle) writeTerminalOutput(`\x1b]2;${savedTitle}\x07`);
        writeTerminalOutput("\x1b[?25l"); // hide cursor
        writeTerminalOutput("\x1b[<u"); // pop Kitty keyboard push
        writeTerminalOutput("\x1b[0m" + CLEAR_SCREEN_AND_SCROLLBACK);
      } catch {
        // best-effort
      }
    }
    if (stdinAttached) {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {
        // best-effort
      }
    }
    if (suspended) {
      try {
        renderer.resume();
      } catch {
        // best-effort
      }
    }
    altScreenFade?.cleanup();
    if (terminal) terminal.showCursor = previousShowCursor;
    active = false;
  }
}

function isBufferZoomMouseRelease(sequence: string): boolean {
  if (!sequence.startsWith("\x1b[<") || !sequence.endsWith("m")) return false;
  return /^\d+;\d+;\d+$/.test(sequence.slice(3, -1));
}

function isCompleteCsiSequence(sequence: string): boolean {
  if (!sequence.startsWith("\x1b[")) return true;
  const last = sequence.charCodeAt(sequence.length - 1);
  return last >= 0x40 && last <= 0x7e;
}
