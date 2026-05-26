import type { RemoteConnectionStatus, RemoteServerConfig } from "./types.ts";

import { MIN_CONTROL_CLIENT_SIZE } from "../tmux/control-client-bootstrap.ts";
import { TmuxControlClient } from "../tmux/control-client.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { SshTransport, runRemoteShellCommand as runShellOverSsh } from "./transport/ssh-transport.ts";

export interface RemoteHookForwardConfig {
  /** Per-server shared secret hooks must include with every event. */
  authToken: string;
  /** Local 127.0.0.1 TCP port the agent ingress is listening on. */
  localTcpPort: number;
}

/**
 * SSH-tunneled tmux control mode client.
 *
 * Thin facade around `TmuxControlClient` + `SshTransport`. Owns the
 * reconnect loop and surfaces SSH-specific events (`status-change`,
 * `warning`, `hook-port-resolved`) plus tmux control-mode events
 * (`pane-output`, `layout-change`, `window-add`, etc.) over a single
 * EventEmitter surface that matches the pre-refactor `RemoteControlClient`
 * shape.
 *
 * Events:
 *   pane-output(paneId: string, data: string)
 *   pane-output-bytes(paneId: string, data: Uint8Array)
 *   layout-change(windowId: string, layoutString: string)
 *   tmux-exit() — remote tmux session/client exited cleanly via `%exit`
 *   window-add(windowId: string)
 *   window-close(windowId: string)
 *   window-pane-changed(windowId: string, paneId: string)
 *   exit() — control-mode connection ended, regardless of cause
 *   status-change(status: RemoteConnectionStatus, error?: string, sshPid?: number)
 *   hook-port-resolved(port: number) — sshd-allocated remote forward port for the hook ingress
 *   warning(message: string)
 */
export class RemoteControlClient extends EventEmitter {
  /** Shared secret sent to the local hook ingress. */
  get hookAuthToken(): string | undefined {
    return this.hookForward?.authToken;
  }
  /** True once the SSH server has rejected our hook forward. Sticky across reconnects. */
  get hookForwardingRejected(): boolean {
    return this.hookForwardingFailed;
  }
  get isConnected(): boolean {
    return !this.closed && this.client !== null && this.bootstrapped;
  }
  /** Remote loopback TCP port that forwards back to the local agent ingress. */
  get remoteHookTcpPort(): number | undefined {
    return this.activeTransport?.hookTcpPort;
  }
  get sshPid(): number | undefined {
    return this.activeTransport?.sshPid;
  }
  private activeTransport: SshTransport | null = null;
  /**
   * Set true once attemptConnect has finished its post-attach bootstrap.
   * Gates `sendCommand` and `isConnected` so external callers (mirror,
   * proxy input, hook config) can't share the underlying pendingQueue with
   * in-flight bootstrap traffic and risk response misalignment.
   */
  private bootstrapped = false;
  private client: TmuxControlClient | null = null;
  private closed = false;
  private hookForwardingFailed = false;
  private intentionallyClosed = false;

  constructor(
    private config: RemoteServerConfig,
    private mirrorServerName: string,
    private mirrorSession: string,
    private hookForward?: RemoteHookForwardConfig,
  ) {
    super();
  }

  /** Intentionally stop — don't reconnect. */
  destroy(): void {
    this.intentionallyClosed = true;
    if (this.closed) return;
    this.closed = true;
    this.client?.destroy();
    this.client = null;
    this.activeTransport = null;
    this.bootstrapped = false;
  }

  /**
   * Run a one-shot remote shell command (NOT a control-mode session). Used
   * by the agent-hook installer to push files / probe paths.
   */
  async runRemoteShellCommand(
    argv: string[],
    options: { stdin?: string } = {},
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    return runShellOverSsh(this.config, argv, options);
  }

  /** Send a tmux command and await the response. */
  sendCommand(cmd: string): Promise<string> {
    if (this.closed || !this.client || !this.bootstrapped) {
      return Promise.reject(new Error("Client closed"));
    }
    return this.client.runCommand(cmd);
  }

  /** Start the auto-reconnect loop. Runs forever until intentionally stopped. */
  async startReconnectLoop(): Promise<void> {
    this.intentionallyClosed = false;
    this.closed = false;
    let retry = 0;

    while (!this.intentionallyClosed) {
      let sshPid: number | undefined;
      try {
        await this.attemptConnect();
        sshPid = this.activeTransport?.sshPid;
        this.emit("status-change", "connected" as RemoteConnectionStatus, undefined, sshPid);
        retry = 0;

        // Wait for disconnect
        await new Promise<void>((resolve) => {
          const onExit = (): void => {
            this.client?.off("exit", onExit);
            resolve();
          };
          this.client?.on("exit", onExit);
        });

        this.client = null;
        this.activeTransport = null;
        this.bootstrapped = false;

        if (this.intentionallyClosed) break;
        this.emit("status-change", "disconnected" as RemoteConnectionStatus, undefined, sshPid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stderrSummary = this.activeTransport?.stderrSummary ?? "";
        const detail = stderrSummary ? `${msg}: ${stderrSummary}` : msg;
        this.client = null;
        this.activeTransport = null;
        this.bootstrapped = false;
        this.emit("status-change", "error" as RemoteConnectionStatus, detail, sshPid);
      }

      if (this.intentionallyClosed) break;

      retry++;
      const delay = retry < 5 ? 2000 : retry < 15 ? 5000 : 10000;
      await Bun.sleep(delay);
    }

    this.emit("status-change", "disconnected" as RemoteConnectionStatus);
  }

  private async attemptConnect(): Promise<void> {
    // Persist hookForwardingFailed across attempts: SshTransport is created
    // fresh each time, so a rejection observed on a previous attempt would be
    // forgotten unless we pass it back in here. The transport will omit `-R`
    // when constructed with rejected:true.
    const transport = new SshTransport(
      this.config,
      this.mirrorServerName,
      this.hookForward ? { ...this.hookForward, rejected: this.hookForwardingFailed } : undefined,
    );
    this.activeTransport = transport;

    transport.onForwardingRejected(() => {
      // Latch the sticky bit eagerly. Reading transport.hookForwardingRejected
      // after the connect attempt finishes races the stderr drain task, so
      // we mirror the rejection here the moment it's parsed.
      this.hookForwardingFailed = true;
    });
    transport.onHookPortResolved((port) => {
      this.emit("hook-port-resolved", port);
    });
    transport.onWarning((message) => {
      this.emit("warning", message);
    });

    const client = new TmuxControlClient(transport);
    this.client = client;

    // Re-emit tmux events through this facade so existing consumers don't change.
    client.on("pane-output", (paneId: string, data: string) => this.emit("pane-output", paneId, data));
    client.on("pane-output-bytes", (paneId: string, data: Uint8Array) => this.emit("pane-output-bytes", paneId, data));
    client.on("layout-change", (windowId: string, layout: string) => this.emit("layout-change", windowId, layout));
    client.on("window-add", (windowId: string) => this.emit("window-add", windowId));
    client.on("window-close", (windowId: string) => this.emit("window-close", windowId));
    client.on("window-pane-changed", (windowId: string, paneId: string) =>
      this.emit("window-pane-changed", windowId, paneId),
    );
    client.on("tmux-exit", () => this.emit("tmux-exit"));
    client.on("exit", () => this.emit("exit"));

    try {
      // `new-session -A` atomically attaches to the mirror session if it
      // exists, or creates and attaches if it does not.
      const tmuxArgs = ["-C", "new-session", "-A", "-s", this.mirrorSession];

      // attachWithArgs intentionally does NOT apply the local-client bootstrap
      // (mouse, theme colors, cursor style, cwd-aware split bindings) — those
      // are only appropriate for the user-facing local tmux server. The remote
      // mirror gets a minimal set of options below.
      await client.attachWithArgs(tmuxArgs, MIN_CONTROL_CLIENT_SIZE);

      // Configure the remote session for mirroring.
      // The mirror session is invisible — only the control-mode client attaches —
      // so disable the status bar to avoid it stealing a row from the window area.
      // The local session uses pane-border-status top, so the mirror must match
      // so that pane content heights (pane_height = layout_cell.sy - 1) are equal.
      // Remote mirror sessions should survive SSH/control-client loss.
      await client.runCommand("set-option -g destroy-unattached off");
      await client.runCommand("set-option destroy-unattached off");
      await client.runCommand("set-option detach-on-destroy on");
      await client.runCommand("set-option -g window-size smallest");
      await client.runCommand("set-option status off");
      await client.runCommand("set-option -g pane-border-status top");
      await client.runCommand(`refresh-client -C ${MIN_CONTROL_CLIENT_SIZE.cols},${MIN_CONTROL_CLIENT_SIZE.rows}`);

      // Bootstrap finished cleanly. Flip the gate so external callers
      // (mirror reconcile, proxy input, hook config) can now reach the
      // shared pendingQueue.
      this.bootstrapped = true;
    } catch (err) {
      // Partial connection state must be torn down explicitly. Without this,
      // a failure in the post-connect bootstrap commands would leave the SSH
      // process running with transport handlers still attached, leaking
      // warnings/port events into the next attempt's listeners.
      try {
        client.destroy();
      } catch {}
      this.client = null;
      // Latch hookForwardingFailed BEFORE clearing activeTransport so the next
      // attempt sees the sticky state. The transport's own field is the
      // authoritative signal: it was set by the stderr parser when sshd
      // refused our `-R`.
      if (transport.hookForwardingRejected) this.hookForwardingFailed = true;
      this.activeTransport = null;
      throw err;
    }

    // Latch rejection state from a successful connect too — sshd can refuse
    // `-R` while still completing the rest of the session (the design point
    // of dropping ExitOnForwardFailure). Future attempts must remember this.
    if (transport.hookForwardingRejected) this.hookForwardingFailed = true;
  }
}

// Re-export legacy helpers that existing tests reach for.
export { appendBoundedSshText, finalizeSshText, sanitizeSshText, truncateSshText } from "./transport/ssh-transport.ts";
