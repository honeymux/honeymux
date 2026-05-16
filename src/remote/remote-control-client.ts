import type { RemoteConnectionStatus, RemoteServerConfig } from "./types.ts";

import { MIN_CONTROL_CLIENT_SIZE } from "../tmux/control-client-bootstrap.ts";
import { ControlModeParser } from "../tmux/control-mode-parser.ts";
import { trackChildPid, untrackChildPid } from "../util/child-pids.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { log } from "../util/log.ts";
import { cleanEnv } from "../util/pty.ts";
import { stripAnsiEscapes, stripNonPrintingControlChars } from "../util/text.ts";
import { appendSshDestination, buildRemoteShellCommand } from "./ssh.ts";

interface PendingCommand {
  reject: (error: Error) => void;
  resolve: (output: string) => void;
}

/** Wires SSH `-R` to forward a remote loopback TCP port back to the local agent ingress. */
interface RemoteHookForwardConfig {
  /** Local 127.0.0.1 TCP port the agent ingress is listening on. */
  localTcpPort: number;
}

const HOOK_FORWARD_LOOPBACK_HOST = "127.0.0.1";
const MAX_SSH_STDERR_CHARS = 8 * 1024;
const MAX_SSH_WARNING_CHARS = 512;
// OpenSSH stderr after a `-R` request: `Allocated port <N> for remote forward to <host>:<port>`.
const REMOTE_FORWARD_ALLOCATED_RE = /^Allocated port (\d{1,5}) for remote forward to /m;
// OpenSSH errors when a remote forward is rejected. Stream-local message is kept for completeness
// even though the new TCP path no longer emits it; allows graceful degradation if the SSH server
// refuses TCP `-R` too (rare).
const REMOTE_FORWARD_REJECTED_PATTERNS = [
  "remote port forwarding failed for listen port",
  "remote port forwarding failed for listen path",
];

/**
 * SSH-tunneled tmux control mode client.
 *
 * Connects to a remote tmux instance via `ssh <host> tmux -C attach-session`
 * and parses the control mode protocol. Provides the same %output / send-keys
 * interface as TmuxControlClient but over SSH.
 *
 * Events:
 *   pane-output(paneId: string, data: string)
 *   pane-output-bytes(paneId: string, data: Uint8Array)
 *   layout-change(windowId: string, layoutString: string)
 *   tmux-exit() — remote tmux session/client exited cleanly via `%exit`
 *   window-add(windowId: string)
 *   window-close(windowId: string)
 *   window-pane-changed(windowId: string, paneId: string)
 *   exit()
 *   status-change(status: RemoteConnectionStatus, error?: string)
 *   hook-port-resolved(port: number) — sshd-allocated remote forward port for the hook ingress
 *   warning(message: string)
 */
export class RemoteControlClient extends EventEmitter {
  /** True once the SSH server has rejected our hook forward; we won't request it again. */
  get hookForwardingRejected(): boolean {
    return this.hookForwardingFailed;
  }
  get isConnected(): boolean {
    return !this.closed && this.proc !== null;
  }
  /** Remote loopback TCP port that forwards back to the local agent ingress. */
  get remoteHookTcpPort(): number | undefined {
    return this.resolvedRemoteForwardPort ?? undefined;
  }
  get sshPid(): number | undefined {
    return this.proc?.pid;
  }
  private allocatedPortBuffer = "";
  private closed = false;
  private hookForwardingFailed = false;
  private intentionallyClosed = false;
  private lastStderr = "";
  private lastStderrWasTruncated = false;
  private parser: ControlModeParser | null = null;
  private pendingQueue: PendingCommand[] = [];
  private proc: {
    kill: () => void;
    pid: number;
    stdin: { end(): void; flush(): void; write(data: Uint8Array | string): number };
    stdout: ReadableStream<Uint8Array>;
  } | null = null;
  private ready: Promise<void> | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readyResolve: (() => void) | null = null;
  private resolvedRemoteForwardPort: null | number = null;

  constructor(
    private config: RemoteServerConfig,
    private mirrorSession: string,
    private hookForward?: RemoteHookForwardConfig,
  ) {
    super();
  }

  /** Connect to the remote tmux in control mode. Creates session if needed. */
  async connect(): Promise<void> {
    this.resetConnectionState();

    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    // First, ensure the mirror session exists on the remote
    const checkProc = Bun.spawn(
      ["ssh", ...this.buildSshArgs(), "tmux", "-L", "honeymux", "has-session", "-t", this.mirrorSession],
      { env: cleanEnv(), stderr: "ignore", stdout: "ignore" },
    );
    const exists = (await checkProc.exited) === 0;

    const remoteCmd = exists
      ? ["-C", "attach-session", "-t", this.mirrorSession]
      : ["-C", "new-session", "-s", this.mirrorSession];

    const proc = Bun.spawn(["ssh", ...this.buildSshArgs(true), "tmux", "-L", "honeymux", ...remoteCmd], {
      env: cleanEnv(),
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    trackChildPid(proc.pid);
    void proc.exited.then(
      () => untrackChildPid(proc.pid),
      () => untrackChildPid(proc.pid),
    );

    // Collect stderr for error reporting
    this.drainStderr(proc);

    this.proc = {
      kill: () => proc.kill(),
      pid: proc.pid,
      stdin: proc.stdin as unknown as {
        end(): void;
        flush(): void;
        write(data: Uint8Array | string): number;
      },
      stdout: proc.stdout as ReadableStream<Uint8Array>,
    };
    this.parser = this.createParser();

    this.emit("status-change", "connecting" as RemoteConnectionStatus, undefined, proc.pid);

    this.startParsing();
    await this.ready;

    // Configure the remote session for mirroring.
    // The mirror session is invisible — only the control-mode client attaches —
    // so disable the status bar to avoid it stealing a row from the window area.
    // The local session uses pane-border-status top, so the mirror must match
    // so that pane content heights (pane_height = layout_cell.sy - 1) are equal.
    // Remote mirror sessions should survive SSH/control-client loss.
    await this.sendCommand("set-option -g destroy-unattached off");
    await this.sendCommand("set-option destroy-unattached off");
    await this.sendCommand("set-option detach-on-destroy on");
    await this.sendCommand("set-option -g window-size smallest");
    await this.sendCommand("set-option status off");
    await this.sendCommand("set-option -g pane-border-status top");
    // Bootstrap at the floor; MirrorLayoutManager.syncClientSize takes over
    // on the first layout-change and drives the remote to match the local
    // window dims (which are themselves bounded by the user's real terminal).
    await this.sendCommand(`refresh-client -C ${MIN_CONTROL_CLIENT_SIZE.cols},${MIN_CONTROL_CLIENT_SIZE.rows}`);
  }

  /** Intentionally stop — don't reconnect. */
  destroy(): void {
    this.intentionallyClosed = true;
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

  parseLine(line: string): void {
    if (!this.parser) this.parser = this.createParser();
    this.parser?.parseLine(line);
  }

  async runRemoteShellCommand(
    argv: string[],
    options: { stdin?: string } = {},
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    return this.runRemoteProcess(buildRemoteShellCommand(argv), options);
  }

  /** Send a tmux command and await the response. */
  sendCommand(cmd: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("Client closed"));
    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ reject, resolve });
      this.writeCommand(cmd);
    });
  }

  /** Start the auto-reconnect loop. Runs forever until intentionally stopped. */
  async startReconnectLoop(): Promise<void> {
    this.intentionallyClosed = false;
    let retry = 0;

    while (!this.intentionallyClosed) {
      let sshPid: number | undefined;
      try {
        await this.connect();
        sshPid = this.proc?.pid;
        this.emit("status-change", "connected" as RemoteConnectionStatus, undefined, sshPid);
        retry = 0;

        // Wait for disconnect
        await new Promise<void>((resolve) => {
          const handler = () => {
            this.off("exit", handler);
            resolve();
          };
          this.on("exit", handler);
        });

        if (this.intentionallyClosed) break;
        this.emit("status-change", "disconnected" as RemoteConnectionStatus, undefined, sshPid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.emit("status-change", "error" as RemoteConnectionStatus, msg, sshPid);
      }

      if (this.intentionallyClosed) break;

      // Backoff
      retry++;
      const delay = retry < 5 ? 2000 : retry < 15 ? 5000 : 10000;
      await Bun.sleep(delay);
    }

    this.emit("status-change", "disconnected" as RemoteConnectionStatus);
  }

  // --- Private ---

  /** Build SSH args for connecting to the remote host. */
  private buildSshArgs(includeHookForward = false): string[] {
    const args: string[] = ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
    if (this.config.port) args.push("-p", String(this.config.port));
    if (this.config.identityFile) args.push("-i", this.config.identityFile);
    if (this.config.agentForwarding) args.push("-A");
    if (includeHookForward && this.hookForward && !this.hookForwardingFailed) {
      // TCP `-R` form (remote-host:remote-port:local-host:local-port). The remote-port `0`
      // makes sshd pick an ephemeral port and announce it on stderr, which we capture and
      // surface via `remoteHookTcpPort`. We bind on the remote loopback (127.0.0.1) so only
      // processes on the remote host can reach the forward; the agent-ingress requires a
      // shared-secret token (set in the tmux user-option) on top of that.
      //
      // We deliberately avoid `ExitOnForwardFailure=yes` here: if the remote rejects the
      // forward, we want to detect it from stderr and fall back to "hooks disabled" rather
      // than tearing down the SSH session and looping at backoff forever.
      args.push("-R", `${HOOK_FORWARD_LOOPBACK_HOST}:0:${HOOK_FORWARD_LOOPBACK_HOST}:${this.hookForward.localTcpPort}`);
    }
    appendSshDestination(args, this.config.host);
    return args;
  }

  private createParser(): ControlModeParser {
    return new ControlModeParser({
      getPendingQueue: () => this.pendingQueue,
      isClosed: () => this.closed,
      notifications: {
        onExit: () => {
          this.closed = true;
          this.emit("tmux-exit");
          this.emit("exit");
        },
        onLayoutChange: (windowId, layoutString) => this.emit("layout-change", windowId, layoutString),
        onPaneOutput: (paneId, data) => this.emit("pane-output", paneId, data),
        onPaneOutputBytes: (paneId, data) => this.emit("pane-output-bytes", paneId, data),
        onWindowAdd: (windowId) => this.emit("window-add", windowId),
        onWindowClose: (windowId) => this.emit("window-close", windowId),
        onWindowPaneChanged: (windowId, paneId) => this.emit("window-pane-changed", windowId, paneId),
      },
      onReady: () => {
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
          this.readyReject = null;
        }
      },
    });
  }

  private drainStderr(proc: { stderr: ReadableStream<Uint8Array> }): void {
    this.lastStderr = "";
    this.lastStderrWasTruncated = false;
    (async () => {
      try {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.processStderrChunk(decoder.decode(value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) this.processStderrChunk(tail);
      } catch {}
      this.lastStderr = finalizeSshText(this.lastStderr, this.lastStderrWasTruncated);
      if (this.lastStderr) {
        log("remote", `ssh stderr (${this.config.name}): ${this.lastStderr}`);
      }
    })();
  }

  /**
   * OpenSSH prints `Allocated port N for remote forward to ...` on stderr when our
   * `-R 0:...` request is honored. Buffer raw stderr (chunks may split mid-line) until we
   * see the message and capture the port. Subsequent occurrences are ignored.
   */
  private maybeCaptureAllocatedPort(chunk: string): void {
    if (!this.hookForward || this.resolvedRemoteForwardPort !== null) return;
    this.allocatedPortBuffer = (this.allocatedPortBuffer + chunk).slice(-2048);
    const match = REMOTE_FORWARD_ALLOCATED_RE.exec(this.allocatedPortBuffer);
    if (!match) return;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return;
    this.resolvedRemoteForwardPort = port;
    this.allocatedPortBuffer = "";
    // The "Allocated port" stderr line and the control-mode `connected` event
    // race; whichever loses, this event lets the manager retry option setup
    // without dropping the configuration.
    this.emit("hook-port-resolved", port);
  }

  private maybeMarkHookForwardingFailure(chunk: string): void {
    if (this.hookForwardingFailed || !this.hookForward) return;
    if (!REMOTE_FORWARD_REJECTED_PATTERNS.some((pattern) => chunk.includes(pattern))) return;
    this.hookForwardingFailed = true;
    log(
      "remote",
      `remote ssh server rejected hook port forward (${this.config.name}); agent hooks disabled for this server`,
    );
    this.emit("warning", "remote ssh server rejected hook port forwarding; agent hooks disabled for this server.");
  }

  private processStderrChunk(chunk: string): void {
    const next = appendBoundedSshText(this.lastStderr, chunk, MAX_SSH_STDERR_CHARS);
    this.lastStderr = next.text;
    this.lastStderrWasTruncated ||= next.wasTruncated;
    this.maybeCaptureAllocatedPort(chunk);
    this.maybeMarkHookForwardingFailure(chunk);
    const message = truncateSshText(chunk, MAX_SSH_WARNING_CHARS);
    if (message) this.emit("warning", message);
  }

  /**
   * Clears per-connection state at the start of each connect() so a transient
   * sshd misconfiguration that flipped `hookForwardingFailed` true doesn't
   * permanently disable `-R` for this client. The cached forward port is
   * also reset so we re-capture it from the next stderr `Allocated port` line.
   */
  private resetConnectionState(): void {
    this.closed = false;
    this.pendingQueue = [];
    this.parser = null;
    this.resolvedRemoteForwardPort = null;
    this.allocatedPortBuffer = "";
    this.hookForwardingFailed = false;
  }

  private async runRemoteProcess(
    remoteCommand: string,
    options: { stdin?: string } = {},
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const hasStdin = options.stdin !== undefined;
    const proc = Bun.spawn(["ssh", ...this.buildSshArgs(), remoteCommand], {
      env: cleanEnv(),
      stderr: "pipe",
      stdin: hasStdin ? "pipe" : "ignore",
      stdout: "pipe",
    });
    if (hasStdin && proc.stdin) {
      const writer = proc.stdin as unknown as { end(): void; write(data: string): void };
      try {
        writer.write(options.stdin!);
      } finally {
        writer.end();
      }
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const boundedStderr = appendBoundedSshText("", stderr, MAX_SSH_STDERR_CHARS);
    return {
      exitCode,
      stderr: finalizeSshText(boundedStderr.text, boundedStderr.wasTruncated),
      stdout,
    };
  }

  private async startParsing(): Promise<void> {
    if (!this.proc || !this.parser) return;
    await this.parser.consumeStream(this.proc.stdout);

    for (const pending of this.pendingQueue) {
      pending.reject(new Error("Connection closed"));
    }
    this.pendingQueue = [];

    // If we never completed the handshake, reject the ready promise
    if (this.readyReject) {
      const stderrMsg = this.lastStderr ? `: ${this.lastStderr}` : "";
      this.readyReject(new Error(`SSH connection closed before tmux handshake${stderrMsg}`));
      this.readyResolve = null;
      this.readyReject = null;
    }

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

export function appendBoundedSshText(
  existing: string,
  chunk: string,
  maxChars: number,
): { text: string; wasTruncated: boolean } {
  const sanitizedChunk = sanitizeSshText(chunk);
  if (!sanitizedChunk) return { text: existing, wasTruncated: false };

  const combined = existing + sanitizedChunk;
  if (combined.length <= maxChars) {
    return { text: combined, wasTruncated: false };
  }

  return {
    text: combined.slice(combined.length - maxChars),
    wasTruncated: true,
  };
}

export function finalizeSshText(text: string, wasTruncated = false): string {
  const compact = text.replace(/ {2,}/g, " ").trim();
  if (!compact) return "";
  return wasTruncated ? `[truncated] ${compact}` : compact;
}

export function sanitizeSshText(text: string): string {
  return stripNonPrintingControlChars(stripAnsiEscapes(text.replace(/[\r\n\t]+/g, " ")));
}

export function truncateSshText(text: string, maxChars: number): string {
  const compact = finalizeSshText(sanitizeSshText(text));
  if (compact.length <= maxChars) return compact;
  if (maxChars <= 1) return compact.slice(0, maxChars);
  return compact.slice(0, maxChars - 1) + "…";
}
