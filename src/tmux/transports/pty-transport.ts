import type { ControlModeStatus, ControlModeTransport } from "./transport.ts";

import { trackChildPid, untrackChildPid } from "../../util/child-pids.ts";
import { cleanEnv } from "../../util/pty.ts";
import { tmuxCmd } from "../../util/tmux-server.ts";

type Handler<A extends unknown[]> = (...args: A) => void;

export class PtyTransport implements ControlModeTransport {
  get status(): ControlModeStatus {
    return this._status;
  }
  private _status: ControlModeStatus = "idle";
  private dataHandlers = new Set<Handler<[Uint8Array]>>();
  private exitEmitted = false;
  private exitHandlers = new Set<Handler<[]>>();
  private proc: {
    kill(): void;
    stdin: { end(): void; flush(): void; write(data: Uint8Array | string): number };
    stdout: ReadableStream<Uint8Array>;
  } | null = null;
  private statusHandlers = new Set<Handler<[ControlModeStatus, string | undefined]>>();

  onData(handler: Handler<[Uint8Array]>): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onExit(handler: Handler<[]>): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  onStatusChange(handler: Handler<[ControlModeStatus, string | undefined]>): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  async start(tmuxArgs: ReadonlyArray<string>): Promise<void> {
    if (this.proc) throw new Error("PtyTransport already started");
    this.setStatus("connecting");

    const proc = Bun.spawn(tmuxCmd(...tmuxArgs), {
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
      stdin: proc.stdin as unknown as {
        end(): void;
        flush(): void;
        write(data: Uint8Array | string): number;
      },
      stdout: proc.stdout as ReadableStream<Uint8Array>,
    };
    this.setStatus("connected");
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
    // Don't emit exit here — let pumpStdout's finally fire it once the
    // stream is genuinely drained, so consumers see a fully-parsed
    // event stream before the exit signal.
  }

  write(bytes: Uint8Array | string): void {
    if (!this.proc) return;
    this.proc.stdin.write(bytes);
    this.proc.stdin.flush();
  }

  private emitExit(): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.setStatus("disconnected");
    for (const h of this.exitHandlers) h();
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
