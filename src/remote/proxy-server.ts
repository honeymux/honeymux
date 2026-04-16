import type { Socket } from "bun";

import { chmodSync, unlinkSync } from "node:fs";

import { appendBoundedLines } from "../util/bounded-line-buffer.ts";
import { EventEmitter } from "../util/event-emitter.ts";
import { getPrivateSocketPath } from "../util/runtime-paths.ts";

interface ProxySocketData {
  buffer: string;
  paneId: null | string;
}

const MAX_PROXY_REGISTRATION_LINE_BYTES = 8 * 1024;
const MAX_PENDING_PROXY_OUTPUT_BYTES = 256 * 1024;

/**
 * Unix socket server for proxy process communication.
 *
 * Each proxy process connects, sends a registration message with its pane ID,
 * then receives raw %output bytes from the remote tmux, which it writes to
 * stdout to display in the local pane.
 *
 * Events:
 *   proxy-registered(paneId: string) — a proxy process connected and registered
 *   proxy-disconnected(paneId: string) — a proxy process disconnected
 */
export class RemoteProxyServer extends EventEmitter {
  private pendingOutput = new Map<string, Uint8Array>();
  private pendingTokens = new Map<string, string>();
  private proxyConnections = new Map<string, Socket<ProxySocketData>>();
  private server: ReturnType<typeof Bun.listen> | null = null;
  private socketPath: string;

  constructor() {
    super();
    this.socketPath = getRemoteProxySocketPath();
  }

  /** Register an expected proxy connection with a one-time token. */
  expectProxy(paneId: string, token: string): void {
    this.pendingOutput.delete(paneId);
    this.pendingTokens.set(paneId, token);
  }

  /** Drop any expected or buffered state for a proxy pane. */
  forgetProxy(paneId: string): void {
    this.pendingOutput.delete(paneId);
    this.pendingTokens.delete(paneId);
  }

  /** Send remote %output bytes to the proxy for a specific local pane. */
  sendOutput(localPaneId: string, data: Uint8Array): void {
    const socket = this.proxyConnections.get(localPaneId);
    if (socket) {
      socket.write(data);
      return;
    }

    if (this.pendingTokens.has(localPaneId)) {
      this.pendingOutput.set(
        localPaneId,
        appendPendingProxyOutput(this.pendingOutput.get(localPaneId), data, MAX_PENDING_PROXY_OUTPUT_BYTES),
      );
    }
  }

  start(): void {
    try {
      unlinkSync(this.socketPath);
    } catch {}

    this.server = Bun.listen<ProxySocketData>({
      socket: {
        close: (socket) => {
          if (socket.data.paneId) {
            this.proxyConnections.delete(socket.data.paneId);
            this.emit("proxy-disconnected", socket.data.paneId);
          }
        },
        data: (socket, data) => {
          if (socket.data.paneId) {
            // Already registered — proxy shouldn't send data after registration
            // (input routing bypasses the proxy)
            return;
          }

          // Accumulate until we get the registration message (newline-delimited JSON)
          const result = appendBoundedLines(
            socket.data.buffer,
            new TextDecoder().decode(data),
            MAX_PROXY_REGISTRATION_LINE_BYTES,
          );
          if (result.overflowed) {
            socket.data.buffer = "";
            socket.end();
            return;
          }
          socket.data.buffer = result.remainder;
          const line = result.lines[0];
          if (!line) return;

          try {
            const msg = JSON.parse(line);
            if (msg.paneId) {
              // Reject if pane already has an active connection
              if (this.proxyConnections.has(msg.paneId)) {
                socket.end();
                return;
              }
              // Validate one-time token
              const expected = this.pendingTokens.get(msg.paneId);
              if (!expected || msg.token !== expected) {
                socket.end();
                return;
              }
              this.pendingTokens.delete(msg.paneId);
              socket.data.paneId = msg.paneId;
              this.proxyConnections.set(msg.paneId, socket);
              const pendingOutput = this.pendingOutput.get(msg.paneId);
              if (pendingOutput && pendingOutput.byteLength > 0) {
                socket.write(pendingOutput);
              }
              this.pendingOutput.delete(msg.paneId);
              this.emit("proxy-registered", msg.paneId);
            }
          } catch {
            // Invalid registration — close
            socket.end();
          }
        },
        error: () => {},
        open: (socket) => {
          socket.data = { buffer: "", paneId: null };
        },
      },
      unix: this.socketPath,
    });
    try {
      chmodSync(this.socketPath, 0o700);
    } catch {}
  }

  stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    try {
      unlinkSync(this.socketPath);
    } catch {}
    this.pendingOutput.clear();
    this.pendingTokens.clear();
    this.proxyConnections.clear();
  }
}

export function appendPendingProxyOutput(
  existing: Uint8Array | undefined,
  chunk: Uint8Array,
  maxBytes: number,
): Uint8Array {
  const current = existing ?? new Uint8Array(0);
  if (chunk.byteLength >= maxBytes) {
    return chunk.slice(chunk.byteLength - maxBytes);
  }

  const totalBytes = current.byteLength + chunk.byteLength;
  if (totalBytes <= maxBytes) {
    return Buffer.concat([current, chunk]);
  }

  const keepFromExisting = Math.max(0, maxBytes - chunk.byteLength);
  return Buffer.concat([current.slice(current.byteLength - keepFromExisting), chunk]);
}

export function getRemoteProxySocketPath(): string {
  return getPrivateSocketPath("hmx-remote-proxy");
}
