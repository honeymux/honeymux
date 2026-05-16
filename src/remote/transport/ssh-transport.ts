import type { ControlModeStatus, ControlModeTransport } from "../../tmux/transports/transport.ts";
import type { RemoteServerConfig } from "../types.ts";

import { trackChildPid, untrackChildPid } from "../../util/child-pids.ts";
import { log } from "../../util/log.ts";
import { cleanEnv } from "../../util/pty.ts";
import { stripAnsiEscapes, stripNonPrintingControlChars } from "../../util/text.ts";
import { appendSshDestination, buildRemoteShellCommand } from "../ssh.ts";

const HOOK_FORWARD_LOOPBACK_HOST = "127.0.0.1";
const MAX_SSH_STDERR_CHARS = 8 * 1024;
const MAX_SSH_WARNING_CHARS = 512;
// OpenSSH error patterns when a remote forward is rejected. The stream-local
// pattern is kept too even though TCP `-R` shouldn't trip it, in case the
// server somehow refuses TCP `-R` as well (e.g. AllowTcpForwarding=no).
const REMOTE_FORWARD_REJECTED_PATTERNS = [
  "remote port forwarding failed for listen port",
  "remote port forwarding failed for listen path",
];

export interface SshHookForwardConfig {
  /** Local 127.0.0.1 TCP port the agent ingress is listening on. */
  localTcpPort: number;
  /**
   * Sticky rejection state. RemoteControlClient sets this when it has observed
   * the SSH server reject our `-R` request on a prior attempt; passing it back
   * here causes the new transport instance to omit `-R` from the argv so we
   * don't keep re-asking and getting refused.
   */
  rejected?: boolean;
}

type Handler<A extends unknown[]> = (...args: A) => void;

interface WritableLikeStdin {
  end(): void;
  flush(): void;
  write(data: Uint8Array | string): number;
}

export class SshTransport implements ControlModeTransport {
  /**
   * True once the SSH server has rejected our hook forward; further reconnect
   * attempts skip the `-R` request entirely so the tunnel itself can still
   * succeed without hooks. Consumers should also stop writing the
   * `@hmx-agent-socket-path` tmux option for this server.
   */
  get hookForwardingRejected(): boolean {
    return this._hookForwardingFailed;
  }
  /** Remote-side TCP port sshd allocated for the `-R` forward; undefined until parsed from stderr. */
  get hookTcpPort(): number | undefined {
    return this.resolvedRemoteForwardPort ?? undefined;
  }
  /** SSH process pid; undefined when not running. */
  get sshPid(): number | undefined {
    return this.proc?.pid;
  }
  get status(): ControlModeStatus {
    return this._status;
  }
  /**
   * Last sanitized chunk of SSH stderr from the most recent connection. Useful
   * for diagnostic messages on connect failure.
   */
  get stderrSummary(): string {
    return finalizeSshText(this.lastStderr, this.lastStderrWasTruncated);
  }
  private _hookForwardingFailed = false;
  private _status: ControlModeStatus = "idle";
  private dataHandlers = new Set<Handler<[Uint8Array]>>();
  private exitEmitted = false;
  private exitHandlers = new Set<Handler<[]>>();
  private forwardingRejectedHandlers = new Set<Handler<[]>>();
  private hookPortHandlers = new Set<Handler<[number]>>();
  private lastStderr = "";
  private lastStderrWasTruncated = false;
  private proc: {
    kill(): void;
    pid: number;
    stderr: ReadableStream<Uint8Array>;
    stdin: WritableLikeStdin;
    stdout: ReadableStream<Uint8Array>;
  } | null = null;
  private resolvedRemoteForwardPort: null | number = null;
  private statusHandlers = new Set<Handler<[ControlModeStatus, string | undefined]>>();
  private stderrLineBuffer = "";
  private warningHandlers = new Set<Handler<[string]>>();

  constructor(
    private config: RemoteServerConfig,
    private hookForward?: SshHookForwardConfig,
  ) {
    if (hookForward?.rejected) this._hookForwardingFailed = true;
  }

  onData(handler: Handler<[Uint8Array]>): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onExit(handler: Handler<[]>): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  /**
   * Fires synchronously the moment the SSH server's rejection of our `-R`
   * forward is parsed from stderr. Use this to capture the sticky state
   * before the SSH process exits — relying on the `hookForwardingRejected`
   * getter at the end of the connect attempt races the stderr-drain task,
   * which is fire-and-forget.
   */
  onForwardingRejected(handler: Handler<[]>): () => void {
    this.forwardingRejectedHandlers.add(handler);
    return () => this.forwardingRejectedHandlers.delete(handler);
  }

  /** Fires once the SSH server has announced the allocated remote forward port. */
  onHookPortResolved(handler: Handler<[number]>): () => void {
    this.hookPortHandlers.add(handler);
    return () => this.hookPortHandlers.delete(handler);
  }

  onStatusChange(handler: Handler<[ControlModeStatus, string | undefined]>): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Diagnostic messages drawn from SSH stderr. */
  onWarning(handler: Handler<[string]>): () => void {
    this.warningHandlers.add(handler);
    return () => this.warningHandlers.delete(handler);
  }

  async start(tmuxArgs: ReadonlyArray<string>): Promise<void> {
    if (this.proc) throw new Error("SshTransport already started");
    this.setStatus("connecting");
    this.lastStderr = "";
    this.lastStderrWasTruncated = false;
    this.stderrLineBuffer = "";
    this.resolvedRemoteForwardPort = null;
    this.exitEmitted = false;

    const argv = ["ssh", ...this.buildSshArgs(true), "tmux", "-L", "honeymux", ...tmuxArgs];
    const proc = Bun.spawn(argv, {
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

    this.proc = {
      kill: () => proc.kill(),
      pid: proc.pid,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      stdin: proc.stdin as unknown as WritableLikeStdin,
      stdout: proc.stdout as ReadableStream<Uint8Array>,
    };
    this.setStatus("connected");
    this.drainStderr(this.proc.stderr);
    void this.pumpStdout(this.proc.stdout);
  }

  stop(): void {
    if (!this.proc) {
      this.emitExit();
      return;
    }
    try {
      this.proc.stdin.end();
      this.proc.kill();
    } catch {
      // ignore
    }
    // Don't emit exit here — pumpStdout's finally fires it once the
    // stream is fully drained, matching the local PTY transport.
  }

  write(bytes: Uint8Array | string): void {
    if (!this.proc) return;
    this.proc.stdin.write(bytes);
    this.proc.stdin.flush();
  }

  /**
   * Build SSH connection args. When `includeHookForward` is set and a hook
   * port is configured and forwarding hasn't been rejected on a prior attempt,
   * adds `-R 127.0.0.1:0:127.0.0.1:<localPort>` so the remote loopback gets
   * a port that tunnels back to the local agent ingress. The remote-side port
   * is sshd-allocated; we parse it from stderr.
   *
   * `ExitOnForwardFailure` is deliberately NOT set: a hostile sshd refusing
   * `-R` should not break the entire control-mode session. We detect the
   * rejection from stderr instead and gracefully disable hooks.
   */
  private buildSshArgs(includeHookForward: boolean): string[] {
    const args = buildSshConnectionArgs(this.config, { includeKeepalive: true });
    if (includeHookForward && this.hookForward && !this._hookForwardingFailed) {
      args.push("-R", `${HOOK_FORWARD_LOOPBACK_HOST}:0:${HOOK_FORWARD_LOOPBACK_HOST}:${this.hookForward.localTcpPort}`);
    }
    appendSshDestination(args, this.config.host);
    return args;
  }

  private drainStderr(stderr: ReadableStream<Uint8Array>): void {
    this.lastStderr = "";
    this.lastStderrWasTruncated = false;
    void (async () => {
      try {
        const reader = stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.processStderrChunk(decoder.decode(value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) this.processStderrChunk(tail);
      } catch {
        // ignore
      }
      const summary = finalizeSshText(this.lastStderr, this.lastStderrWasTruncated);
      if (summary) {
        log("remote", `ssh stderr (${this.config.name}): ${summary}`);
      }
    })();
  }

  private emitExit(): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.setStatus("disconnected");
    for (const h of this.exitHandlers) h();
  }

  private emitWarning(message: string): void {
    for (const h of this.warningHandlers) h(message);
  }

  /**
   * Capture the sshd-allocated remote forward port. OpenSSH prints
   * `Allocated port N for remote forward to <host>:<port>` on stderr when the
   * `-R 0:...` request is honored. We require the destination to be our exact
   * local loopback target so we don't accidentally bind to a port allocated
   * for a user-config `RemoteForward` entry. Operates on a fully-buffered
   * line so it sees the same line boundaries as the rejection matcher;
   * line-by-line dispatch preserves the in-stream order between successful
   * and rejected announcements.
   */
  private maybeCaptureAllocatedPortFromLine(line: string): void {
    if (!this.hookForward || this.resolvedRemoteForwardPort !== null) return;
    const localPort = this.hookForward.localTcpPort;
    // Anchored to the exact `to <host>:<localPort>` destination so user-config
    // RemoteForward entries (which sshd also announces) can't poison this.
    const pattern = new RegExp(
      `^Allocated port (\\d{1,5}) for remote forward to ${HOOK_FORWARD_LOOPBACK_HOST.replace(/\./g, "\\.")}:${localPort}\\b`,
    );
    const match = pattern.exec(line);
    if (!match) return;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return;
    this.resolvedRemoteForwardPort = port;
    for (const h of this.hookPortHandlers) h(port);
  }

  private maybeMarkHookForwardingFailure(line: string): void {
    if (this._hookForwardingFailed || !this.hookForward) return;
    // If sshd has already allocated our port, subsequent "remote port forwarding
    // failed" messages MUST be for someone else's forward (a user-config
    // RemoteForward, typically). OpenSSH announces our allocation before printing
    // unrelated forward failures, so this ordering is reliable.
    if (this.resolvedRemoteForwardPort !== null) return;
    if (!REMOTE_FORWARD_REJECTED_PATTERNS.some((pattern) => line.includes(pattern))) return;
    this._hookForwardingFailed = true;
    log(
      "remote",
      `remote ssh server rejected hook port forward (${this.config.name}); agent hooks disabled for this server`,
    );
    this.emitWarning(
      `SSH server rejected loopback port forwarding for ${this.config.name}; agent hooks are disabled for this connection.`,
    );
    // Synchronous fan-out so RemoteControlClient can latch the sticky bit
    // before the SSH process exits — the stderr drain task is fire-and-forget
    // and may not have run by the time attemptConnect checks the getter.
    for (const h of this.forwardingRejectedHandlers) h();
  }

  /**
   * Process a stderr chunk by appending to a line buffer and dispatching
   * each completed line through both pattern detectors in stream order.
   *
   * Why line-oriented dispatch: OpenSSH may print a rejection for one
   * forward and a successful allocation for another within a single read,
   * and the order matters — see `maybeMarkHookForwardingFailure`, which
   * uses "have we already allocated our port" as a guard. Processing on a
   * per-line basis preserves stderr's actual ordering so the guard fires
   * correctly even when both messages arrive in the same chunk.
   */
  private processStderrChunk(chunk: string): void {
    if (!chunk) return;
    const next = appendBoundedSshText(this.lastStderr, chunk, MAX_SSH_STDERR_CHARS);
    this.lastStderr = next.text;
    this.lastStderrWasTruncated ||= next.wasTruncated;

    this.stderrLineBuffer += chunk;
    let newlineIdx = this.stderrLineBuffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.stderrLineBuffer.slice(0, newlineIdx);
      this.stderrLineBuffer = this.stderrLineBuffer.slice(newlineIdx + 1);
      // Apply both detectors in stderr order. Reject-then-allocate sets the
      // sticky bit; allocate-then-reject leaves it clear (the rejection
      // is for an unrelated forward).
      this.maybeCaptureAllocatedPortFromLine(line);
      this.maybeMarkHookForwardingFailure(line);
      newlineIdx = this.stderrLineBuffer.indexOf("\n");
    }
    // Cap the partial-line buffer; pathological streams without newlines
    // shouldn't grow unbounded. Truncate without matching — the matchers
    // operate on completed lines only.
    if (this.stderrLineBuffer.length > 4096) {
      this.stderrLineBuffer = this.stderrLineBuffer.slice(-1024);
    }

    const message = truncateSshText(chunk, MAX_SSH_WARNING_CHARS);
    if (message) {
      this.emitWarning(message);
    }
  }

  private async pumpStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          for (const h of this.dataHandlers) h(value);
        }
      }
    } catch {
      // stream errors fall through to exit
    } finally {
      reader.releaseLock?.();
      this.emitExit();
    }
  }

  private setStatus(status: ControlModeStatus, error?: string): void {
    if (this._status === status) return;
    this._status = status;
    for (const h of this.statusHandlers) h(status, error);
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

/**
 * Build the BatchMode/keepalive/auth options shared by every SSH spawn for
 * a configured server. Does NOT append the destination — callers add `-R` or
 * other per-call args first, then call `appendSshDestination`.
 */
export function buildSshConnectionArgs(
  config: RemoteServerConfig,
  { includeKeepalive }: { includeKeepalive: boolean },
): string[] {
  const args: string[] = ["-o", "BatchMode=yes"];
  if (includeKeepalive) {
    args.push("-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3");
  }
  if (config.port) args.push("-p", String(config.port));
  if (config.identityFile) args.push("-i", config.identityFile);
  if (config.agentForwarding) args.push("-A");
  return args;
}

export function finalizeSshText(text: string, wasTruncated = false): string {
  const compact = text.replace(/ {2,}/g, " ").trim();
  if (!compact) return "";
  return wasTruncated ? `[truncated] ${compact}` : compact;
}

/**
 * Run a one-shot remote shell command (NOT a control-mode session). Used for
 * the agent-hook install path and other non-mirror RPC. The command is
 * POSIX-quoted via `buildRemoteShellCommand`.
 */
export async function runRemoteShellCommand(
  config: RemoteServerConfig,
  argv: string[],
  options: { stdin?: string } = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const sshArgs = buildBareSshArgs(config);
  const hasStdin = options.stdin !== undefined;
  const proc = Bun.spawn(["ssh", ...sshArgs, buildRemoteShellCommand(argv)], {
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

export function sanitizeSshText(text: string): string {
  return stripNonPrintingControlChars(stripAnsiEscapes(text.replace(/[\r\n\t]+/g, " ")));
}

export function truncateSshText(text: string, maxChars: number): string {
  const compact = finalizeSshText(sanitizeSshText(text));
  if (compact.length <= maxChars) return compact;
  if (maxChars <= 1) return compact.slice(0, maxChars);
  return compact.slice(0, maxChars - 1) + "…";
}

function buildBareSshArgs(config: RemoteServerConfig): string[] {
  const args = buildSshConnectionArgs(config, { includeKeepalive: false });
  appendSshDestination(args, config.host);
  return args;
}
