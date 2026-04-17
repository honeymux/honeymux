import { createHash } from "node:crypto";

import type { RemoteConnectionStatus, RemoteServerConfig } from "./types.ts";

import { MIN_CONTROL_CLIENT_SIZE } from "../tmux/control-client-bootstrap.ts";
import { ControlModeParser } from "../tmux/control-mode-parser.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { log } from "../util/log.ts";
import { cleanEnv } from "../util/pty.ts";
import { stripAnsiEscapes, stripNonPrintingControlChars } from "../util/text.ts";
import { appendSshDestination, buildRemoteShellCommand } from "./ssh.ts";

interface PendingCommand {
  reject: (error: Error) => void;
  resolve: (output: string) => void;
}

interface RemoteHookForwardConfig {
  localSocketPath: string;
}

const REMOTE_HOOK_SOCKET_PATH_SCRIPT = [
  "state_home=${XDG_STATE_HOME:-$HOME/.local/state}",
  'runtime="$state_home/honeymux/runtime"',
  'mkdir -p "$runtime"',
  'chmod 700 "$runtime" 2>/dev/null || true',
  'rm -f "$runtime/$1"',
  `printf '%s/%s\\n' "$runtime" "$1"`,
].join("\n");
const MAX_SSH_STDERR_CHARS = 8 * 1024;
const MAX_SSH_WARNING_CHARS = 512;

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
 *   warning(message: string)
 */
export class RemoteControlClient extends EventEmitter {
  get isConnected(): boolean {
    return !this.closed && this.proc !== null;
  }
  get remoteHookSocketPath(): string | undefined {
    return this.resolvedRemoteHookSocketPath ?? undefined;
  }
  get sshPid(): number | undefined {
    return this.proc?.pid;
  }
  private closed = false;
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
  private resolvedRemoteHookSocketPath: null | string = null;

  constructor(
    private config: RemoteServerConfig,
    private mirrorSession: string,
    private hookForward?: RemoteHookForwardConfig,
  ) {
    super();
  }

  /** Connect to the remote tmux in control mode. Creates session if needed. */
  async connect(): Promise<void> {
    this.closed = false;
    this.pendingQueue = [];
    this.parser = null;

    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    await this.ensureRemoteHookSocketPath();

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
    if (includeHookForward && this.hookForward && this.resolvedRemoteHookSocketPath) {
      args.push("-o", "ExitOnForwardFailure=yes");
      args.push("-o", "StreamLocalBindUnlink=yes");
      args.push("-R", `${this.resolvedRemoteHookSocketPath}:${this.hookForward.localSocketPath}`);
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
          const chunk = decoder.decode(value, { stream: true });
          const next = appendBoundedSshText(this.lastStderr, chunk, MAX_SSH_STDERR_CHARS);
          this.lastStderr = next.text;
          this.lastStderrWasTruncated ||= next.wasTruncated;
          const message = truncateSshText(chunk, MAX_SSH_WARNING_CHARS);
          if (message) {
            this.emit("warning", message);
          }
        }
        const tail = decoder.decode();
        if (tail) {
          const next = appendBoundedSshText(this.lastStderr, tail, MAX_SSH_STDERR_CHARS);
          this.lastStderr = next.text;
          this.lastStderrWasTruncated ||= next.wasTruncated;
          const message = truncateSshText(tail, MAX_SSH_WARNING_CHARS);
          if (message) {
            this.emit("warning", message);
          }
        }
      } catch {}
      this.lastStderr = finalizeSshText(this.lastStderr, this.lastStderrWasTruncated);
      if (this.lastStderr) {
        log("remote", `ssh stderr (${this.config.name}): ${this.lastStderr}`);
      }
    })();
  }

  private async ensureRemoteHookSocketPath(): Promise<void> {
    if (!this.hookForward || this.resolvedRemoteHookSocketPath) return;

    const remoteCommand = buildRemoteHookSocketPathProbeCommand(this.getRemoteHookSocketName());
    try {
      const { exitCode, stderr, stdout } = await this.runRemoteProcess(remoteCommand);
      if (exitCode !== 0) {
        const detail = stderr ? `: ${stderr}` : "";
        this.emit("warning", `remote hook socket path probe failed${detail}`);
        return;
      }

      const path = stdout.trim();
      if (!path.startsWith("/")) {
        this.emit("warning", `remote hook socket path probe returned invalid path: ${path || "<empty>"}`);
        return;
      }

      this.resolvedRemoteHookSocketPath = path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("warning", `remote hook socket path probe failed: ${message}`);
    }
  }

  private getRemoteHookSocketName(): string {
    const digest = createHash("sha256").update(`${this.config.name}\0${this.mirrorSession}`).digest("hex").slice(0, 16);
    return `hmx-remote-hook-${digest}.sock`;
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

export function buildRemoteHookSocketPathProbeCommand(socketName: string): string {
  return buildRemoteShellCommand(["sh", "-lc", REMOTE_HOOK_SOCKET_PATH_SCRIPT, "sh", socketName]);
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
