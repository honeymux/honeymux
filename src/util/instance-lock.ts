/**
 * Single-instance enforcement for honeymux.
 *
 * Uses a Unix domain socket as a lock — POSIX.1-2001, works on
 * Linux / macOS / BSD.  The kernel stops accepting connections when
 * the owning process dies, so there is no stale-lock problem.
 *
 * Protocol:
 *   1. On connect the lock holder sends a JSON line with its PID and
 *      start time.
 *   2. The peer may send "shutdown\n" to request a clean exit.  The
 *      holder calls process.exit(0) from within the event loop so the
 *      synchronous `exit` handler runs safely — no signal-handler
 *      context, no Bun segfaults.
 */
import { chmodSync, unlinkSync } from "node:fs";

import { appendBoundedLines } from "./bounded-line-buffer.ts";
import { getPrivateSocketPath } from "./runtime-paths.ts";

interface InstanceInfo {
  pid: number;
  startedAt: number;
}

const MAX_INSTANCE_LOCK_LINE_BYTES = 1024;

/**
 * Probe for a running honeymux instance by connecting to the lock
 * socket.  Returns the instance info on success, null if nobody is
 * listening (socket missing, stale, or connection refused).
 */
export function checkExistingInstance(): Promise<InstanceInfo | null> {
  const socketPath = getLockSocketPath();

  return new Promise<InstanceInfo | null>((resolve) => {
    let resolved = false;
    let buffer = "";

    const done = (result: InstanceInfo | null) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    Bun.connect({
      socket: {
        close() {
          done(null);
        },
        data(socket, data) {
          const result = appendBoundedLines(buffer, new TextDecoder().decode(data), MAX_INSTANCE_LOCK_LINE_BYTES);
          if (result.overflowed) {
            buffer = "";
            done(null);
            socket.end();
            return;
          }
          buffer = result.remainder;
          const line = result.lines[0];
          if (line != null) {
            try {
              done(JSON.parse(line));
            } catch {
              done(null);
            }
            socket.end();
          }
        },
        error() {
          done(null);
        },
        open() {},
      },
      unix: socketPath,
    }).catch(() => done(null));

    // Guard against a socket that accepts but never sends.
    setTimeout(() => done(null), 500);
  });
}

function getLockSocketPath(): string {
  return getPrivateSocketPath("honeymux-lock");
}

let lockListener: ReturnType<typeof Bun.listen> | null = null;
const lockStartedAt = Date.now();
let shutdownHandler: (() => void) | null = null;

/**
 * Acquire the instance lock by listening on a Unix domain socket.
 * Every incoming connection immediately receives this instance's
 * PID and start time as a JSON line.  A "shutdown" message triggers
 * the registered shutdown handler (or process.exit as a fallback).
 */
export function acquireLock(): void {
  const socketPath = getLockSocketPath();

  // Remove leftover socket file from a hard crash (SIGKILL, power loss).
  // Safe: checkExistingInstance() already confirmed nobody is listening.
  try {
    unlinkSync(socketPath);
  } catch {}

  lockListener = Bun.listen<{ buffer: string }>({
    socket: {
      close() {},
      data(socket, data) {
        const result = appendBoundedLines(
          socket.data.buffer,
          new TextDecoder().decode(data),
          MAX_INSTANCE_LOCK_LINE_BYTES,
        );
        if (result.overflowed) {
          socket.data.buffer = "";
          socket.end();
          return;
        }
        socket.data.buffer = result.remainder;

        for (const line of result.lines) {
          const msg = line.trim();
          if (msg === "shutdown") {
            socket.end();
            if (shutdownHandler) {
              // Delegate to the app's async cleanup (renderer.idle →
              // destroy → process.exit).  Avoids segfault from tearing
              // down the native Zig renderer while it's mid-frame.
              shutdownHandler();
            } else {
              // Renderer not yet created — safe to exit directly.
              process.exit(0);
            }
            return;
          }

          socket.end();
          return;
        }
      },
      error() {},
      open(socket) {
        socket.data = { buffer: "" };
        const info: InstanceInfo = { pid: process.pid, startedAt: lockStartedAt };
        socket.write(JSON.stringify(info) + "\n");
      },
    },
    unix: socketPath,
  });
  hardenLockSocketPath(socketPath);
}

export function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export function hardenLockSocketPath(socketPath: string): void {
  try {
    chmodSync(socketPath, 0o700);
  } catch {}
}

/**
 * Ask the existing instance to exit cleanly via the lock socket,
 * then wait for it to die.  Falls back to SIGKILL if the graceful
 * path doesn't work within 1 s.
 */
export async function killExistingInstance(pid: number): Promise<void> {
  // Send "shutdown" over the lock socket — processed in the old
  // instance's event loop, so it can call process.exit(0) safely.
  await requestShutdownViaSocket();

  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    await Bun.sleep(50);
    try {
      process.kill(pid, 0);
    } catch {
      return; // exited
    }
  }

  // Still alive after 1 s — force-kill as a last resort.
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
  await Bun.sleep(50);
}

/**
 * Register the function that should run when a remote shutdown is
 * requested via the lock socket.  Call this after the renderer is
 * created so the handler can do a proper async teardown (idle →
 * destroy) before exiting.
 */
export function onLockShutdown(handler: () => void): void {
  shutdownHandler = handler;
}

/** Release the instance lock. Safe to call multiple times. */
export function releaseLock(): void {
  if (lockListener) {
    lockListener.stop(true);
    lockListener = null;
  }
  try {
    unlinkSync(getLockSocketPath());
  } catch {}
}

/**
 * Connect to the lock socket and send "shutdown\n".  Returns once
 * the message is sent or the connection fails.
 */
function requestShutdownViaSocket(): Promise<void> {
  const socketPath = getLockSocketPath();

  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    Bun.connect({
      socket: {
        close() {
          done();
        },
        data() {},
        error() {
          done();
        },
        open(socket) {
          socket.write("shutdown\n");
          socket.end();
        },
      },
      unix: socketPath,
    }).catch(() => done());

    setTimeout(done, 500);
  });
}
