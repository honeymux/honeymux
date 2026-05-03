import type { Socket } from "bun";

import { chmodSync, unlinkSync } from "node:fs";

import { EventEmitter } from "../util/event-emitter.ts";
import { getPrivateSocketPath } from "../util/runtime-paths.ts";

interface ProxySocketData {
  buffer: Uint8Array;
  paneId: null | string;
}

const MAX_PROXY_REGISTRATION_LINE_BYTES = 8 * 1024;
const MAX_PENDING_PROXY_OUTPUT_BYTES = 256 * 1024;
const NEWLINE = 0x0a;

/**
 * Unix socket server for proxy process communication.
 *
 * Each proxy process connects, sends a registration message with its pane ID,
 * then keeps a bidirectional channel open: remote `%output` bytes flow from
 * honeymux to the proxy (which writes them to stdout to display in the local
 * pane), and post-tmux-processed stdin bytes flow from the proxy back to
 * honeymux to be sent to the remote pane.
 *
 * Events:
 *   proxy-registered(paneId: string) — a proxy process connected and registered
 *   proxy-disconnected(paneId: string) — a proxy process disconnected
 *   proxy-input(paneId: string, data: Uint8Array) — bytes typed at the local
 *       pane's pty that local tmux did not consume; should be forwarded to
 *       the corresponding remote pane.
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
            // Post-registration: bytes are stdin from the proxy's local pane,
            // already filtered through local tmux's input layer. Forward on
            // to the remote pane.
            this.emit("proxy-input", socket.data.paneId, data);
            return;
          }

          const nlIdx = indexOfByte(data, NEWLINE);
          if (nlIdx === -1) {
            const next = appendUntilLimit(socket.data.buffer, data, MAX_PROXY_REGISTRATION_LINE_BYTES);
            if (next === null) {
              socket.end();
              return;
            }
            socket.data.buffer = next;
            return;
          }

          const lineBytes = appendUntilLimit(
            socket.data.buffer,
            data.subarray(0, nlIdx),
            MAX_PROXY_REGISTRATION_LINE_BYTES,
          );
          if (lineBytes === null) {
            socket.end();
            return;
          }
          socket.data.buffer = EMPTY_BUFFER;

          try {
            const msg = JSON.parse(new TextDecoder().decode(lineBytes));
            if (!msg.paneId) {
              socket.end();
              return;
            }
            if (this.proxyConnections.has(msg.paneId)) {
              socket.end();
              return;
            }
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
          } catch {
            socket.end();
            return;
          }

          // If input bytes arrived in the same chunk after the registration
          // newline, forward them now under the freshly-registered paneId.
          if (nlIdx + 1 < data.length && socket.data.paneId) {
            this.emit("proxy-input", socket.data.paneId, data.subarray(nlIdx + 1));
          }
        },
        error: () => {},
        open: (socket) => {
          socket.data = { buffer: EMPTY_BUFFER, paneId: null };
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

function appendUntilLimit(prefix: Uint8Array, chunk: Uint8Array, maxBytes: number): Uint8Array | null {
  const total = prefix.byteLength + chunk.byteLength;
  if (total > maxBytes) return null;
  if (prefix.byteLength === 0) return chunk;
  const out = new Uint8Array(total);
  out.set(prefix, 0);
  out.set(chunk, prefix.byteLength);
  return out;
}

function indexOfByte(buf: Uint8Array, byte: number): number {
  for (let i = 0; i < buf.length; i++) if (buf[i] === byte) return i;
  return -1;
}

const EMPTY_BUFFER = new Uint8Array(0);
