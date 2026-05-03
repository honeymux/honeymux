import type { CliRenderer } from "@opentui/core";

import type { KeyAction } from "../util/keybindings.ts";

import { type InputRouterCallbacks, routeKeyboardInput } from "./keyboard-router.ts";
import { type MouseForwardConfig, installRawStdinInterceptor } from "./raw-stdin-interceptor.ts"; /**
 * Intercepts raw keyboard input.
 *
 * - Shift+Left/Right: switch tabs (our UI)
 * - Shift+Up/Down: switch sessions
 * - Alt+Up/Down: toolbar navigation
 * - Everything else: forwarded to the PTY (tmux handles prefix keys,
 *   scrollback, pane splits, etc. natively)
 */
export function setupInputRouter(
  renderer: CliRenderer,
  writeToPty: (data: string) => void,
  callbacks: InputRouterCallbacks,
  getKeybindings: () => Map<string, KeyAction>,
): void {
  renderer.prependInputHandler((sequence: string): boolean =>
    routeKeyboardInput(sequence, writeToPty, callbacks, getKeybindings()),
  );
}

/**
 * Set up raw stdin mouse forwarding.
 *
 * Patches process.stdin.emit so terminal-area mouse events are intercepted
 * BEFORE OpenTUI sees them. This prevents OpenTUI from treating drags in
 * the terminal content area as text selection. Tab bar events pass through
 * to OpenTUI for normal component dispatch.
 *
 * Also enables button-event tracking (\x1b[?1002h) so the terminal reports
 * mouse motion while a button is pressed (needed for tmux pane resize drag).
 */
export function setupMouseForward(writeToPty: (data: string) => void, mouseConfig: MouseForwardConfig): () => void {
  return installRawStdinInterceptor(writeToPty, mouseConfig);
}
