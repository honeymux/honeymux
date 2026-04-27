import type { TmuxKeyBindings, TmuxPaneTtyMapping, TmuxSession, TmuxWindow } from "./types.ts";

import { terminalFgRgb } from "../themes/theme.ts";
import { trackChildPid } from "../util/child-pids.ts";
import { getTerminalCursorStyle } from "../util/cursor.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { cleanEnv } from "../util/pty.ts";
import { tmuxCmd } from "../util/tmux-server.ts";
import {
  type ControlClientSize,
  MIN_CONTROL_CLIENT_SIZE,
  applyControlClientBootstrap,
  applyControlClientPaneBorderColors,
  buildDefaultPaneBorderFormat,
  clampControlClientSize,
  setControlClientSize,
} from "./control-client-bootstrap.ts";
import {
  parseActivePaneGeometryOutput,
  parseActivePaneScreenshotInfoOutput,
  parseAllPaneInfoOutput,
  parseFullTreeOutputs,
  parseKeyBindingsOutput,
  parseListPanesInWindowOutput,
  parseListSessionsOutput,
  parseListWindowPaneIdsOutput,
  parseListWindowsOutput,
  parsePaneCommandsOutput,
  parsePaneContextOutput,
  parsePaneTtyMappingsOutput,
  parseSessionInfoOutputs,
  parseStatusBarInfoOutput,
} from "./control-client-parsers.ts";
import { ControlModeParser } from "./control-mode-parser.ts";
import { quoteTmuxArg } from "./escape.ts";

interface PendingCommand {
  reject: (err: Error) => void;
  resolve: (data: string) => void;
}

const WINDOW_ID_RE = /^@\d+$/;
const PANE_ID_RE = /^%\d+$/;
const USER_OPTION_NAME_RE = /^@\S+$/;
const SUBSCRIPTION_NAME_RE = /^[^\s:]+$/;

export { unescapeTmuxOutput } from "./control-mode-parser.ts";

/**
 * Client for tmux control mode (-C).
 *
 * Spawns tmux in control mode, parses the line-based protocol,
 * and provides typed methods for window management events.
 *
 * In the hybrid architecture, this client is used ONLY for:
 * - Tab bar events (window add/close/rename, session-window-changed)
 * - Tab switching commands (select-window)
 * - Listing windows
 *
 * A separate PTY running `tmux attach` handles all rendering and input.
 */
export class TmuxControlClient extends EventEmitter {
  /**
   * True when tmux sent `%exit` on the control stream (orderly shutdown:
   * last session ended, kill-server, etc.). False if the stream closed
   * without `%exit` (crash, SIGKILL, lost connection). Callers use this
   * to decide whether "exit" represents a clean teardown or a fatal
   * condition worth surfacing to the user.
   */
  cleanExit = false;
  private closed = false;
  private lastClientSize: ControlClientSize | null = null;
  private parser: ControlModeParser | null = null;
  private pendingQueue: PendingCommand[] = [];
  private proc: {
    kill(): void;
    stdin: { end(): void; flush(): void; write(data: Uint8Array | string): number };
    stdout: ReadableStream<Uint8Array>;
  } | null = null;
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  /**
   * Apply a layout string to the current window.
   */
  async applyLayout(layout: string): Promise<void> {
    await this.sendCommand(`select-layout ${quoteTmuxArg("layout", layout)}`);
  }

  /**
   * Attach to an EXISTING tmux session in control mode as a secondary observer.
   *
   * Unlike {@link connect}, this does not create the session if missing and
   * does not apply global server options (those belong to whichever primary
   * client called {@link connect} first). Only the per-client size is set, so
   * this attach does not shrink the session's windows to an 80×24 default.
   *
   * Intended for passive observation roles such as the cross-session activity
   * watchers that forward `pane-output` back to the agent pane-activity map.
   */
  async attachExisting(sessionName: string, size: ControlClientSize = MIN_CONTROL_CLIENT_SIZE): Promise<void> {
    await this.spawnControlModeProcess(["-C", "attach-session", "-t", sessionName]);
    const clamped = clampControlClientSize(size);
    await setControlClientSize((command) => this.sendCommand(command), clamped);
    this.lastClientSize = clamped;
  }

  async clearFormatSubscription(name: string): Promise<void> {
    assertSubscriptionName(name);
    await this.sendCommand(`refresh-client -B ${quoteTmuxArg("subscription", name)}`);
  }

  /**
   * Connect to (or create) a tmux session in control mode.
   * Waits for tmux to send its initial %begin/%end before returning.
   */
  async connect(sessionName: string, size: ControlClientSize = MIN_CONTROL_CLIENT_SIZE): Promise<void> {
    await this.spawnControlModeProcess(["-C", "new-session", "-A", "-s", sessionName]);
    const clamped = clampControlClientSize(size);
    await applyControlClientBootstrap(
      (command) => this.sendCommand(command),
      terminalFgRgb,
      getTerminalCursorStyle(),
      clamped,
    );
    this.lastClientSize = clamped;
  }

  /**
   * Create a detached tmux session, optionally grouped to another session.
   */
  async createDetachedSession(name: string, targetSession?: string): Promise<void> {
    const args = ["new-session", "-d", "-s", name];
    if (targetSession) args.push("-t", targetSession);
    args.push("-c", "#{pane_current_path}");
    await this.runCommandArgs(args);
  }

  /**
   * Create n additional panes using full-window splits.
   * Uses -f so each split spans the full window width, avoiding the
   * problem where repeatedly splitting the active pane makes it too
   * narrow for tmux to accept further splits.
   */
  async createPanes(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.sendCommand("split-window -fh -c '#{pane_current_path}'");
    }
  }

  /**
   * Create a new detached tmux session.
   * Returns the actual session name (tmux may auto-name it).
   */
  async createSession(name?: string): Promise<string> {
    const args = ["new-session", "-d"];
    if (name) args.push("-s", name);
    args.push("-P", "-F", "#{session_name}");
    return (await this.runCommandArgs(args)).trim();
  }

  /**
   * Close the control mode connection.
   */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      // ignore
    }
    for (const pending of this.pendingQueue) {
      pending.reject(new Error("Client destroyed"));
    }
    this.pendingQueue = [];
  }

  /**
   * Detach from the session without killing it.
   */
  async detach(): Promise<void> {
    try {
      await this.sendCommand("detach-client");
    } catch {
      // May fail if already disconnecting
    }
  }

  /**
   * Disable automatic-rename for a specific window so the name stays fixed.
   */
  async disableAutomaticRename(windowId: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(`set-option -w -t ${quoteTmuxArg("windowId", windowId)} automatic-rename off`);
  }

  /**
   * Disable pane tab labels but keep the border visible with the ≡ menu.
   */
  async disablePaneTabBorders(): Promise<void> {
    await this.sendCommand(
      `set-option -g pane-border-format ${quoteTmuxArg("format", buildDefaultPaneBorderFormat())}`,
    );
    await applyControlClientPaneBorderColors((command) => this.sendCommand(command));
  }

  /**
   * Re-enable automatic-rename for a window so tmux names it from the running process.
   */
  async enableAutomaticRename(windowId: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(`set-option -w -t ${quoteTmuxArg("windowId", windowId)} automatic-rename on`);
  }

  /**
   * Enable pane-border-status globally with the "+" button format.
   */
  async enablePaneTabBorders(): Promise<void> {
    await this.sendCommand("set-option -g pane-border-status top");
    await this.sendCommand(
      `set-option -g pane-border-format ${quoteTmuxArg("format", buildDefaultPaneBorderFormat())}`,
    );
  }

  async getActiveMouseAnyFlag(): Promise<boolean> {
    const output = await this.sendCommand("display-message -p '#{mouse_any_flag}'");
    return output.trim() === "1";
  }

  /**
   * Get the active pane's position and size within the window.
   * Uses list-panes (proven to work in control mode) instead of display-message.
   */
  async getActivePaneGeometry(): Promise<{ height: number; left: number; top: number; width: number }> {
    const output = await this.sendCommand(
      "list-panes -F '#{pane_active} #{pane_left} #{pane_top} #{pane_width} #{pane_height}'",
    );
    return parseActivePaneGeometryOutput(output);
  }

  /**
   * Get the active pane's cwd, geometry, and ID in a single query.
   */
  async getActivePaneScreenshotInfo(): Promise<{
    cwd: string;
    height: number;
    left: number;
    paneId: string;
    top: number;
    width: number;
  }> {
    const output = await this.sendCommand(
      "list-panes -F '#{pane_active} #{pane_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height} #{pane_current_path}'",
    );
    return parseActivePaneScreenshotInfoOutput(output);
  }

  /**
   * Get info for all panes in the current window: PID, command, TTY, and geometry.
   * Used for root-privilege detection across split panes.
   */
  async getAllPaneInfo(targetSession?: string): Promise<
    Array<{
      active: boolean;
      command: string;
      height: number;
      id: string;
      left: number;
      pid: number;
      top: number;
      tty: string;
      width: number;
    }>
  > {
    const targetFlag = targetSession ? ` -t ${quoteTmuxArg("targetSession", targetSession)}` : "";
    const output = await this.sendCommand(
      `list-panes${targetFlag} -F '#{pane_pid} #{pane_current_command} #{pane_tty} #{pane_left} #{pane_top} #{pane_width} #{pane_height} #{pane_active} #{pane_id}'`,
    );
    return parseAllPaneInfoOutput(output);
  }

  /**
   * Resolve the effective automatic-rename setting for a specific window.
   * Falls back to the global window option when the window has no local override.
   */
  async getAutomaticRename(windowId: string): Promise<boolean> {
    assertWindowId(windowId);
    const local = (
      await this.sendCommand(`show-options -v -w -t ${quoteTmuxArg("windowId", windowId)} automatic-rename`)
    ).trim();
    if (local.length > 0) return local === "on";
    const global = (await this.sendCommand("show-options -g -v -w automatic-rename")).trim();
    return global === "on";
  }

  /**
   * Query tmux's `extended-keys` and `extended-keys-format` global options.
   *
   * Returned `enabled` is true when the user has set `extended-keys` to either
   * `on` or `always` — meaning tmux requests extended keys from its terminal
   * and forwards them to apps that ask. `format` reflects the encoding tmux
   * negotiates with its terminal (`csi-u` or `xterm`); when missing or
   * unrecognized, `unknown` is returned so callers can fall back to
   * legacy-only forwarding.
   *
   * Used at startup to decide whether honeymux should re-encode CSI-u keys
   * to legacy form (the default, when extended-keys is off) or pass through
   * extended keys so tmux can dispatch them to apps unchanged.
   */
  async getExtendedKeysSettings(): Promise<{ enabled: boolean; format: "csi-u" | "unknown" | "xterm" }> {
    try {
      const [keysOut, formatOut] = await Promise.all([
        this.sendCommand("show-options -gv extended-keys"),
        this.sendCommand("show-options -gv extended-keys-format"),
      ]);
      const keysVal = String(keysOut).trim();
      const formatVal = String(formatOut).trim();
      const format = formatVal === "csi-u" ? "csi-u" : formatVal === "xterm" ? "xterm" : "unknown";
      return {
        enabled: keysVal === "always" || keysVal === "on",
        format,
      };
    } catch {
      return { enabled: false, format: "unknown" };
    }
  }

  /**
   * Get the full tmux tree: all sessions, their windows, and their panes.
   * Used by the tmux tree sidebar view.
   */
  async getFullTree(): Promise<{
    panes: Array<{
      active: boolean;
      command: string;
      cwd?: string;
      id: string;
      index: number;
      pid: number;
      remoteHost?: string;
      sessionName: string;
      title?: string;
      windowId: string;
    }>;
    sessions: TmuxSession[];
    windows: Array<{ active: boolean; id: string; index: number; name: string; sessionName: string }>;
  }> {
    const [sessionsOut, windowsOut, panesOut] = await Promise.all([
      this.sendCommand("list-sessions -F '#{session_id}\t#{session_name}\t#{session_attached}\t#{@hmx-color}'"),
      this.sendCommand(
        "list-windows -a -F '#{session_name}\t#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}'",
      ),
      // Tab-separated because pane_current_path and pane_title can contain spaces.
      this.sendCommand(
        "list-panes -a -F '#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_index}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{pane_current_path}\t#{@hmx-remote-host}\t#{pane_title}'",
      ),
    ]);
    return parseFullTreeOutputs(sessionsOut, windowsOut, panesOut);
  }

  /**
   * Query the current prefix key and key bindings from tmux.
   * Parses `show-options -g prefix` and `list-keys -T prefix`.
   */
  async getKeyBindings(): Promise<TmuxKeyBindings> {
    const [prefixOut, keysOut] = await Promise.all([
      this.sendCommand("show-options -gv prefix"),
      this.sendCommand("list-keys -T prefix"),
    ]);
    return parseKeyBindingsOutput(prefixOut, keysOut);
  }

  /**
   * Query the tmux pane-border-lines option.
   * Returns "single", "double", "heavy", "simple", or "number".
   */
  async getPaneBorderLines(): Promise<string> {
    try {
      const output = await this.sendCommand("show-options -gv pane-border-lines");
      return output.trim() || "single";
    } catch {
      return "single";
    }
  }

  /**
   * Query the current command (foreground process) for a set of pane IDs.
   * Returns a map of paneId → command name.
   */
  async getPaneCommands(paneIds: string[]): Promise<Map<string, string>> {
    const output = await this.sendCommand("list-panes -a -F ' #{pane_id} #{pane_current_command}'");
    return parsePaneCommandsOutput(output, paneIds);
  }

  /**
   * Get session, window, and pane metadata for a single pane by ID.
   * Lighter than getFullTree() when only one pane's context is needed.
   */
  async getPaneContext(paneId: string): Promise<{
    paneId: string;
    paneName: string;
    sessionId: string;
    sessionName: string;
    windowId: string;
    windowName: string;
  }> {
    assertPaneId(paneId);
    const output = await this.sendCommand(
      `display-message -p -t ${quoteTmuxArg("paneId", paneId)} '#{session_name}\t#{session_id}\t#{window_name}\t#{window_id}\t#{pane_id}\t#{pane_current_command}'`,
    );
    return parsePaneContextOutput(output);
  }

  /**
   * Get window and pane counts for a specific session.
   * Returns per-window pane counts keyed by window ID so callers can
   * cross-reference with pane-tab state, plus live pane→window mapping.
   */
  async getSessionInfo(name: string): Promise<{
    paneTabActive: Set<string>;
    paneTabMembers: Set<string>;
    paneWindowIds: Map<string, string>;
    windowNames: Map<string, string>;
    windowPanes: Map<string, number>;
  }> {
    const [windowsOutput, panesOutput] = await Promise.all([
      this.sendCommand(
        `list-windows -t ${quoteTmuxArg("name", name)} -F ' #{window_id}\t#{window_panes}\t#{window_name}'`,
      ),
      this.sendCommand(
        "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{window_id}\t#{@hmx-pane-tab-member}\t#{@hmx-pane-tab-active}'",
      ),
    ]);
    return parseSessionInfoOutputs(name, windowsOutput, panesOutput);
  }

  /**
   * Read a session-scoped tmux user option. Returns null when unset.
   */
  async getSessionUserOption(sessionName: string, optionName: string): Promise<null | string> {
    assertUserOptionName(optionName);
    const output = await this.sendCommand(
      `show-options -qv -t ${quoteSessionTarget("sessionName", sessionName)} ${quoteTmuxArg("optionName", optionName)}`,
    );
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Query tmux status bar position and height (number of lines).
   * Returns { position: "top"|"bottom", lines: number } or null if status is off.
   */
  async getStatusBarInfo(): Promise<{ lines: number; position: "bottom" | "top" } | null> {
    const [statusOut, posOut] = await Promise.all([
      this.sendCommand("show-options -gv status"),
      this.sendCommand("show-options -gv status-position"),
    ]);
    return parseStatusBarInfoOutput(statusOut, posOut);
  }

  /**
   * Get the current window's layout string.
   */
  async getWindowLayout(): Promise<string> {
    const output = await this.sendCommand("list-windows -F '#{window_layout}' -f '#{window_active}'");
    return output.split("\n").filter(Boolean)[0] ?? "";
  }

  /**
   * Return true if the window containing the given pane currently has a
   * zoomed pane (any pane, not necessarily the target one).
   */
  async isPaneWindowZoomed(paneId: string): Promise<boolean> {
    assertPaneId(paneId);
    const out = await this.runCommandArgs(["display-message", "-p", "-t", paneId, "#{window_zoomed_flag}"]);
    return out.trim() === "1";
  }

  /**
   * Kill all panes except the active one.
   */
  async killAllPanesExceptActive(): Promise<void> {
    await this.sendCommand("kill-pane -a");
  }

  /**
   * Kill (close) the active pane.
   */
  async killPane(): Promise<void> {
    await this.sendCommand("kill-pane");
  }

  /**
   * Kill (close) a pane by its pane ID.
   */
  async killPaneById(paneId: string): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`kill-pane -t ${quoteTmuxArg("paneId", paneId)}`);
  }

  /**
   * Kill a tmux session by name.
   */
  async killSession(name: string): Promise<void> {
    await this.sendCommand(`kill-session -t ${quoteTmuxArg("name", name)}`);
  }

  /**
   * Kill (close) a window by its ID (e.g. "@1").
   */
  async killWindow(windowId: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(`kill-window -t ${quoteTmuxArg("windowId", windowId)}`);
  }

  /**
   * List all clients connected to this tmux server.
   */
  async listClients(): Promise<Array<{ controlMode: boolean; name: string }>> {
    const output = await this.sendCommand("list-clients -F '#{client_name} #{client_control_mode}'");
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(" ");
        return { controlMode: parts[1] === "1", name: parts[0]! };
      });
  }

  /**
   * List pane tty mappings across all sessions.
   * Used by agent hook providers to map hook-event TTYs back to tmux panes.
   */
  async listPaneTtyMappings(): Promise<TmuxPaneTtyMapping[]> {
    const output = await this.sendCommand("list-panes -a -F '#{pane_tty}\t#{pane_id}\t#{session_name}\t#{window_id}'");
    return parsePaneTtyMappingsOutput(output);
  }

  /**
   * List panes in a specific window by window ID.
   */
  async listPanesInWindow(windowId: string): Promise<
    Array<{
      active: boolean;
      height: number;
      id: string;
      width: number;
    }>
  > {
    assertWindowId(windowId);
    const output = await this.sendCommand(
      `list-panes -t ${windowId} -F ' #{pane_id} #{pane_width} #{pane_height} #{pane_active}'`,
    );
    return parseListPanesInWindowOutput(output);
  }

  /**
   * List all tmux sessions, including the @hmx-color user option if set.
   */
  async listSessions(): Promise<TmuxSession[]> {
    const output = await this.sendCommand(
      `list-sessions -F '#{session_id}\t#{session_name}\t#{session_attached}\t#{@hmx-color}'`,
    );
    return parseListSessionsOutput(output);
  }

  /**
   * List pane IDs in the current window, ordered by pane index.
   * Uses a leading space in the format string to prevent %N pane IDs
   * from being parsed as control-mode notifications.
   */
  async listWindowPaneIds(): Promise<string[]> {
    const output = await this.sendCommand("list-panes -F ' #{pane_index} #{pane_id}'");
    return parseListWindowPaneIdsOutput(output);
  }

  /**
   * List all windows in the current session.
   */
  async listWindows(): Promise<TmuxWindow[]> {
    const output = await this.sendCommand(
      `list-windows -F '#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}\t#{pane_id}\t#{window_layout}'`,
    );
    return parseListWindowsOutput(output);
  }

  /**
   * Move the active window from one session into another session.
   */
  async moveSessionWindowToSession(sourceSessionName: string, targetSession: string): Promise<void> {
    await this.sendCommand(
      `move-window -s ${quoteSessionTarget("sourceSession", sourceSessionName)} -t ${quoteSessionTarget("targetSession", targetSession)}`,
    );
  }

  /**
   * Move a window from one position to another by performing sequential
   * adjacent swaps. windowIds is the current ordered list of window IDs.
   */
  async moveWindow(windowIds: string[], fromIndex: number, toIndex: number): Promise<void> {
    const srcId = windowIds[fromIndex]!;
    if (fromIndex < toIndex) {
      for (let i = fromIndex; i < toIndex; i++) {
        await this.swapWindow(srcId, windowIds[i + 1]!);
      }
    } else {
      for (let i = fromIndex; i > toIndex; i--) {
        await this.swapWindow(srcId, windowIds[i - 1]!);
      }
    }
  }

  /**
   * Move a window to a different session.
   */
  async moveWindowToSession(windowId: string, targetSession: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(
      `move-window -s ${quoteTmuxArg("windowId", windowId)} -t ${quoteSessionTarget("targetSession", targetSession)}`,
    );
  }

  /**
   * Create a new detached window. Returns { windowId, paneId }.
   */
  async newDetachedWindow(windowName?: string): Promise<{ paneId: string; windowId: string }> {
    const nameArg = windowName ? ` -n ${quoteTmuxArg("windowName", windowName)}` : "";
    const output = await this.sendCommand(
      `new-window -d${nameArg} -c '#{pane_current_path}' -P -F ' #{window_id} #{pane_id}'`,
    );
    const parts = output.trim().split(" ");
    return { paneId: parts[1]!, windowId: parts[0]! };
  }

  /**
   * Create a new window in the current session.
   */
  async newWindow(): Promise<void> {
    await this.sendCommand("new-window -c '#{pane_current_path}'");
  }

  /**
   * Parse a single line from tmux control mode output.
   *
   * IMPORTANT: Notifications (lines starting with %) can arrive at any time,
   * including interleaved within %begin/%end command response blocks. We must
   * always check for and dispatch notifications before accumulating response
   * data, otherwise events like %window-renamed get silently swallowed.
   */
  parseLine(line: string): void {
    if (!this.parser) this.parser = this.createParser();
    this.parser?.parseLine(line);
  }

  /**
   * Force the non-control-mode client (the PTY) to repaint.
   * This avoids the pane-layout drift caused by resize toggling.
   */
  async refreshPtyClient(): Promise<void> {
    const clients = await this.listClients();
    const ptyClient = clients.find((c) => !c.controlMode);
    if (ptyClient) {
      await this.sendCommand(`refresh-client -t ${quoteTmuxArg("client", ptyClient.name)}`);
    }
  }

  /**
   * Rename a tmux session.
   */
  async renameSession(oldName: string, newName: string): Promise<void> {
    await this.sendCommand(`rename-session -t ${quoteTmuxArg("oldName", oldName)} ${quoteTmuxArg("newName", newName)}`);
  }

  /**
   * Rename a tmux window by window ID.
   */
  async renameWindow(windowId: string, newName: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(
      `rename-window -t ${quoteTmuxArg("windowId", windowId)} ${quoteTmuxArg("newName", newName)}`,
    );
  }

  /**
   * Resize a pane to exact dimensions.
   */
  async resizePane(paneId: string, width: number, height: number): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`resize-pane -t ${quoteTmuxArg("paneId", paneId)} -x ${width} -y ${height}`);
  }

  /**
   * Respawn a pane, optionally with an explicit argv command after `--`.
   */
  async respawnPane(paneId: string, argv?: string[]): Promise<void> {
    assertPaneId(paneId);
    const args = ["respawn-pane", "-k", "-t", paneId];
    if (argv && argv.length > 0) {
      args.push("--", ...argv);
    }
    await this.runCommandArgs(args);
  }

  /**
   * Run an arbitrary tmux command over the control-mode connection.
   * Prefer specific methods (switchSession, listWindows, etc.) when available;
   * use this for commands that don't have a dedicated wrapper.
   */
  async runCommand(cmd: string): Promise<string> {
    return this.sendCommand(cmd);
  }

  /**
   * Run a tmux command specified as argv-style arguments.
   * Prefer dedicated wrappers when available; use this as the safe fallback.
   */
  async runCommandArgs(args: string[]): Promise<string> {
    return this.sendCommand(formatCommandArgs(args));
  }

  /**
   * Run multiple tmux commands as a single atomic `;`-chained command block.
   * tmux processes the whole block before emitting any accumulated
   * notifications (`%window-renamed`, `%session-window-changed`, etc.), so
   * observers see only the final state — avoiding transient renders when
   * several rapid structural changes need to appear as a single step.
   *
   * Each chained sub-command produces its own `%begin`/`%end` pair, so one
   * pending promise is pushed per sub-command to keep the response queue in
   * sync with the parser.
   */
  async runCommandChain(cmds: string[]): Promise<void> {
    if (cmds.length === 0) return;
    if (this.closed) throw new Error("Client closed");
    if (!this.proc) throw new Error("Client not connected");
    const promises = cmds.map(
      () =>
        new Promise<string>((resolve, reject) => {
          this.pendingQueue.push({
            reject,
            resolve,
          });
        }),
    );
    this.writeCommand(cmds.join(" ; "));
    await Promise.all(promises);
  }

  /**
   * Run a tmux command chain that contains a `swap-window`, then synthesize
   * a `session-window-changed` emit.  tmux's `swap-window` exchanges window
   * pointers within winlinks and does not emit `%session-window-changed`
   * when the current winlink is involved (see `swapWindow()` for details),
   * so callers that rely on that event to refresh state must receive a
   * manual nudge afterward.
   */
  async runWindowSwapChain(cmds: string[]): Promise<void> {
    await this.runCommandChain(cmds);
    this.emit("session-window-changed");
  }

  /**
   * Select a specific pane by its ID (e.g. "%5").
   */
  async selectPane(paneId: string): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`select-pane -t ${quoteTmuxArg("paneId", paneId)}`);
  }

  /**
   * Select a pane for a specific session target.
   */
  async selectPaneInSession(sessionName: string, paneId: string): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`select-pane -t ${quoteSessionScopedTarget("paneTarget", sessionName, paneId)}`);
  }

  /**
   * Switch to a window by its ID (e.g. "@1").
   */
  async selectWindow(windowId: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(`select-window -t ${quoteTmuxArg("windowId", windowId)}`);
  }

  /**
   * Select a window for a specific session target.
   */
  async selectWindowInSession(sessionName: string, windowId: string): Promise<void> {
    assertWindowId(windowId);
    await this.sendCommand(`select-window -t ${quoteSessionScopedTarget("windowTarget", sessionName, windowId)}`);
  }

  /**
   * Send a command string as keystrokes to a pane's shell.
   * Uses send-keys -l (literal) for the text, then sends Enter.
   * Safer than respawn-pane: the shell stays alive if the command fails.
   */
  async sendKeysToPane(paneId: string, text: string): Promise<void> {
    assertPaneId(paneId);
    if (!text) return;
    await this.sendCommand(`send-keys -l -t ${quoteTmuxArg("paneId", paneId)} ${quoteTmuxArg("text", text)}`);
    await this.sendCommand(`send-keys -t ${quoteTmuxArg("paneId", paneId)} Enter`);
  }

  /**
   * Update the per-client size reported to tmux via `refresh-client -C`.
   * With `window-size smallest`, this acts as a ceiling on pane dimensions
   * when the control client is the smallest attached client. Dedups against
   * the last applied size so rapid resize bursts do not thrash tmux.
   */
  async setClientSize(size: ControlClientSize): Promise<void> {
    if (this.closed) return;
    const clamped = clampControlClientSize(size);
    if (this.lastClientSize && this.lastClientSize.cols === clamped.cols && this.lastClientSize.rows === clamped.rows) {
      return;
    }
    this.lastClientSize = clamped;
    await setControlClientSize((command) => this.sendCommand(command), clamped);
  }

  /**
   * Subscribe to changes in a tmux format expression.  tmux will send
   * `%subscription-changed` notifications when the evaluated value changes,
   * **at most once per second** (this is a tmux-side rate limit).
   *
   * @param what - target scope, e.g. `"%*"` for all panes
   */
  async setFormatSubscription(name: string, what: string, format: string): Promise<void> {
    assertSubscriptionName(name);
    const arg = `${name}:${what}:${format}`;
    await this.sendCommand(`refresh-client -B ${quoteTmuxArg("subscription", arg)}`);
  }

  /**
   * Set `pane-border-format` for a specific pane.
   * Uses `-p` (per-pane option) so each pane can show different content.
   * A single space is used when an empty string is passed.
   */
  async setPaneBorderFormat(paneId: string, format: string): Promise<void> {
    assertPaneId(paneId);
    const safe = format.length === 0 ? " " : format;
    await this.sendCommand(`set-option -p -t ${paneId} pane-border-format ${quoteTmuxArg("format", safe)}`);
  }

  /**
   * Enable or disable `pane-border-status` for the window containing a pane.
   * This is a window option — it affects all panes in the window.
   * Use setPaneBorderFormat per-pane to control what each pane shows.
   */
  async setPaneBorderStatus(paneId: string, value: "off" | "top"): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`set-option -w -t ${paneId} pane-border-status ${value}`);
    // tmux does not emit %layout-change when pane-border-status is toggled,
    // even though it changes pane geometry (e.g. pane_top shifts from 0→1).
    // Emit a synthetic event so pane rect caches are refreshed.
    this.emit("layout-change", "", "");
  }

  /**
   * Set or clear the session color user option (@hmx-color).
   */
  async setSessionColor(sessionName: string, color: null | string): Promise<void> {
    await this.setSessionUserOption(sessionName, "@hmx-color", color);
  }

  /**
   * Set a session-scoped tmux option.
   */
  async setSessionOption(sessionName: string, optionName: string, value: string): Promise<void> {
    await this.runCommandArgs(["set-option", "-t", sessionName, optionName, value]);
  }

  /**
   * Set or clear a session-scoped tmux user option.
   */
  async setSessionUserOption(sessionName: string, optionName: string, value: null | string): Promise<void> {
    assertUserOptionName(optionName);
    if (value !== null) {
      await this.sendCommand(
        `set-option -t ${quoteSessionTarget("sessionName", sessionName)} ${quoteTmuxArg("optionName", optionName)} ${quoteTmuxArg("optionValue", value)}`,
      );
    } else {
      await this.sendCommand(
        `set-option -u -t ${quoteSessionTarget("sessionName", sessionName)} ${quoteTmuxArg("optionName", optionName)}`,
      );
    }
  }

  /**
   * Set the session-local status-left value.
   */
  async setStatusLeft(sessionName: string, value: string): Promise<void> {
    await this.sendCommand(
      `set-option -t ${quoteTmuxArg("sessionName", sessionName)} status-left ${quoteTmuxArg("status-left", value)}`,
    );
  }

  /**
   * Returns true when the active pane has "any-event" mouse reporting enabled.
   * This suppresses prompt click-to-move so full-screen TUIs keep receiving raw mouse input.
   */
  /**
   * Enable or disable tmux mouse mode. When enabled, tmux handles mouse
   * events (pane selection, resize, scroll). When disabled, tmux ignores
   * mouse input.
   */
  async setTmuxMouse(on: boolean): Promise<void> {
    await this.sendCommand(`set-option -g mouse ${on ? "on" : "off"}`);
  }

  /**
   * Split the current pane horizontally (top/bottom).
   */
  async splitHorizontal(paneId?: string): Promise<void> {
    const targetFlag = paneId ? ` -t ${quoteTmuxArg("paneId", paneId)}` : "";
    if (paneId) assertPaneId(paneId);
    await this.sendCommand(`split-window -v${targetFlag} -c '#{pane_current_path}'`);
  }

  /**
   * Split the current pane vertically (side by side).
   */
  async splitVertical(paneId?: string): Promise<void> {
    const targetFlag = paneId ? ` -t ${quoteTmuxArg("paneId", paneId)}` : "";
    if (paneId) assertPaneId(paneId);
    await this.sendCommand(`split-window -h${targetFlag} -c '#{pane_current_path}'`);
  }

  /**
   * Swap two panes by their IDs (e.g. "%1", "%5").
   */
  async swapPane(srcPaneId: string, dstPaneId: string): Promise<void> {
    assertPaneId(srcPaneId);
    assertPaneId(dstPaneId);
    await this.sendCommand(
      `swap-pane -s ${quoteTmuxArg("srcPaneId", srcPaneId)} -t ${quoteTmuxArg("dstPaneId", dstPaneId)}`,
    );
  }

  /**
   * Swap two windows by their IDs (e.g. "@1", "@3").
   */
  async swapWindow(srcId: string, dstId: string): Promise<void> {
    assertWindowId(srcId);
    assertWindowId(dstId);
    await this.sendCommand(`swap-window -s ${quoteTmuxArg("srcId", srcId)} -t ${quoteTmuxArg("dstId", dstId)}`);
    // tmux swap-window exchanges window pointers within their winlinks
    // rather than re-linking.  When the current winlink is involved, the
    // window at the active position changes silently — no
    // %session-window-changed is emitted.  Emit synthetically so
    // listeners can refresh window state.
    this.emit("session-window-changed");
  }

  /**
   * Switch the PTY client (non-control-mode) to a different session.
   * Uses `switch-client -c <pty-client> -t <session>` so the PTY stays
   * alive — no kill/respawn cycle, which avoids tmux server races and
   * VT parser state corruption from rapid session switching.
   */
  async switchPtyClient(sessionName: string): Promise<void> {
    const clients = await this.listClients();
    const ptyClient = clients.find((c) => !c.controlMode);
    if (ptyClient) {
      await this.sendCommand(
        `switch-client -c ${quoteTmuxArg("client", ptyClient.name)} -t ${quoteTmuxArg("sessionName", sessionName)}`,
      );
    }
  }

  /**
   * Switch the control client to a different session.
   */
  async switchSession(sessionName: string): Promise<void> {
    await this.sendCommand(`switch-client -t ${quoteTmuxArg("sessionName", sessionName)}`);
  }

  /**
   * Toggle tmux pane zoom on the window containing the target pane. When
   * zoomed, the active pane fills the whole window; other panes are hidden.
   * This is the same state toggled by the `resize-pane -Z` command.
   */
  async togglePaneZoom(paneId: string): Promise<void> {
    assertPaneId(paneId);
    await this.sendCommand(`resize-pane -Z -t ${quoteTmuxArg("paneId", paneId)}`);
  }

  private createParser(): ControlModeParser {
    return new ControlModeParser({
      getPendingQueue: () => this.pendingQueue,
      isClosed: () => this.closed,
      notifications: {
        onExit: () => {
          this.cleanExit = true;
          this.closed = true;
          this.emit("exit");
        },
        onLayoutChange: (windowId, layoutString) => this.emit("layout-change", windowId, layoutString),
        onPaneOutput: (paneId, data) => this.emit("pane-output", paneId, data),
        onPaneTitleChanged: (paneId, newTitle) => this.emit("pane-title-changed", paneId, newTitle),
        onSessionChanged: (fromSession, toSession) => this.emit("session-changed", fromSession, toSession),
        onSessionRenamed: (oldName, newName) => this.emit("session-renamed", oldName, newName),
        onSessionWindowChanged: () => this.emit("session-window-changed"),
        onSubscriptionChanged: ({ name, paneId, sessionId, value, windowId, windowIndex }) =>
          this.emit("subscription-changed", name, sessionId, windowId, windowIndex, paneId, value),
        onWindowAdd: (windowId) => this.emit("window-add", windowId),
        onWindowClose: (windowId) => this.emit("window-close", windowId),
        onWindowPaneChanged: (windowId, paneId) => this.emit("window-pane-changed", windowId, paneId),
        onWindowRenamed: (windowId, newName) => this.emit("window-renamed", windowId, newName),
      },
      onReady: () => {
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
      },
    });
  }

  private sendCommand(cmd: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("Client closed"));
    if (!this.proc) return Promise.reject(new Error("Client not connected"));
    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ reject, resolve });
      this.writeCommand(cmd);
    });
  }

  /**
   * Shared setup for spawning a `tmux -C` control-mode process and wiring up
   * the parser + ready promise. Used by both {@link connect} and
   * {@link attachExisting}. Returns once tmux has sent its initial %begin/%end
   * handshake (or throws if the process exits before the handshake arrives).
   */
  private async spawnControlModeProcess(tmuxArgs: string[]): Promise<void> {
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    const proc = Bun.spawn(tmuxCmd(...tmuxArgs), {
      env: cleanEnv(),
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    trackChildPid(proc.pid);

    this.proc = {
      kill: () => proc.kill(),
      stdin: proc.stdin as unknown as {
        end(): void;
        flush(): void;
        write(data: Uint8Array | string): number;
      },
      stdout: proc.stdout as ReadableStream<Uint8Array>,
    };
    this.parser = this.createParser();

    void this.startParsing();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        this.off("exit", onExit);
        fn();
      };
      const onExit = (): void => {
        settle(() => reject(new Error(`tmux control-mode process exited before handshake: ${tmuxArgs.join(" ")}`)));
      };
      this.on("exit", onExit);
      void this.ready?.then(() => settle(() => resolve()));
    });
  }

  private async startParsing(): Promise<void> {
    if (!this.proc || !this.parser) return;
    await this.parser.consumeStream(this.proc.stdout);

    // Reject any pending command promises — no more responses will arrive.
    for (const pending of this.pendingQueue) {
      pending.reject(new Error("Connection closed"));
    }
    this.pendingQueue = [];

    if (!this.closed) {
      this.closed = true;
      this.emit("exit");
    }
  }

  private writeCommand(cmd: string): void {
    if (this.closed || !this.proc) return;
    this.proc.stdin.write(cmd + "\n");
    this.proc.stdin.flush();
  }
}

export function listPanePidsByIdSync(): Map<string, number> {
  const { exitCode, stdout } = runStandaloneTmuxCommandSync(["list-panes", "-a", "-F", "#{pane_id}\t#{pane_pid}"]);
  const next = new Map<string, number>();
  if (exitCode !== 0) return next;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const paneId = parts[0];
    const panePid = parseInt(parts[1] ?? "", 10);
    if (paneId && Number.isInteger(panePid) && panePid > 1) {
      next.set(paneId, panePid);
    }
  }
  return next;
}

export function listPanePidsByTtySync(): Map<string, number> {
  const { exitCode, stdout } = runStandaloneTmuxCommandSync(["list-panes", "-a", "-F", "#{pane_tty}\t#{pane_pid}"]);
  const next = new Map<string, number>();
  if (exitCode !== 0) return next;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const tty = parts[0];
    const panePid = parseInt(parts[1] ?? "", 10);
    if (tty && Number.isInteger(panePid) && panePid > 1) {
      next.set(tty, panePid);
    }
  }
  return next;
}

export async function listSessionNames(): Promise<string[]> {
  const output = await runStandaloneTmuxCommand(["list-sessions", "-F", "#{session_name}"]);
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function quoteSessionTarget(label: string, sessionName: string): string {
  return quoteTmuxArg(label, `${sessionName}:`);
}

export async function runStandaloneTmuxCommand(args: string[]): Promise<string> {
  const proc = Bun.spawn(tmuxCmd(...args), {
    env: cleanEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  const output = await readProcessStdout(proc.stdout as ReadableStream<Uint8Array> | null);
  await proc.exited;
  return output;
}

export async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  const proc = Bun.spawn(tmuxCmd("has-session", "-t", sessionName), {
    env: cleanEnv(),
    stderr: "ignore",
    stdout: "ignore",
  });
  return (await proc.exited) === 0;
}

function assertPaneId(paneId: string): void {
  if (!PANE_ID_RE.test(paneId)) {
    throw new Error(`Invalid pane ID: ${paneId}`);
  }
}

function assertSubscriptionName(name: string): void {
  if (!SUBSCRIPTION_NAME_RE.test(name)) {
    throw new Error(`Invalid subscription name: ${name}`);
  }
}

function assertUserOptionName(optionName: string): void {
  if (!USER_OPTION_NAME_RE.test(optionName)) {
    throw new Error(`Invalid user option name: ${optionName}`);
  }
}

function assertWindowId(windowId: string): void {
  if (!WINDOW_ID_RE.test(windowId)) {
    throw new Error(`Invalid window ID: ${windowId}`);
  }
}

function formatCommandArgs(args: string[]): string {
  if (args.length === 0) throw new Error("tmux command requires at least one argument");
  return args.map((arg, index) => quoteTmuxArg(index === 0 ? "command" : `arg${index}`, arg)).join(" ");
}

function quoteSessionScopedTarget(label: string, sessionName: string, targetId: string): string {
  return quoteTmuxArg(label, `${sessionName}:${targetId}`);
}

async function readProcessStdout(stdout: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stdout) return "";
  return new Response(stdout).text();
}

function runStandaloneTmuxCommandSync(args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(tmuxCmd(...args), {
    env: cleanEnv(),
    stderr: "ignore",
    stdout: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
  };
}
