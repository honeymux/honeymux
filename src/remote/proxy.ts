#!/usr/bin/env bun
/**
 * Proxy process that runs inside a local tmux pane converted to remote.
 *
 * Connects to Honeymux's remote proxy socket, registers with its pane ID,
 * then receives remote %output data and writes it to stdout (which appears
 * in the local tmux pane).
 *
 * Usage: bun src/remote/proxy.ts <localPaneId> <token>
 */
import type { Socket } from "bun";

import { getRemoteProxySocketPath } from "./proxy-server.ts";
import { TmuxQueryStripper } from "./query-stripper.ts";

export async function runRemoteProxyProcess(localPaneId: string, proxyToken: string): Promise<void> {
  // The proxy's pty is in canonical mode with echo by default. Raw mode
  // disables kernel-side echo, which is what kept tmux's replies to query
  // escape sequences from being re-rendered as `^[` in the pane.
  //
  // We additionally strip query sequences from the forwarded output before
  // they reach local tmux (see TmuxQueryStripper) so local tmux never has a
  // query to reply to, then forward stdin to the remote pane via honeymux.
  // This puts local tmux's input layer in the loop: the user's keystrokes
  // are processed by local tmux (prefix combos, command-prompt, copy-mode,
  // etc.) before whatever tmux didn't consume falls through to this proxy
  // and out to the remote.
  const stdin = process.stdin as { setRawMode?: (mode: boolean) => unknown } & NodeJS.ReadStream;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const socketPath = getRemoteProxySocketPath();
  const queryStripper = new TmuxQueryStripper();
  let activeSocket: Socket<unknown> | null = null;
  let retry = 0;

  const onStdinData = (chunk: Buffer): void => {
    const sock = activeSocket;
    if (!sock) return; // dropped while disconnected — kernel buffer keeps draining via resume()
    sock.write(chunk);
  };
  stdin.on("data", onStdinData);

  async function connectToHoneymux(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      Bun.connect({
        socket: {
          close() {
            activeSocket = null;
            resolve();
          },
          connectError(_sock, error) {
            activeSocket = null;
            reject(error);
          },
          data(_sock, data) {
            const filtered = queryStripper.filter(data);
            if (filtered.length > 0) process.stdout.write(filtered);
          },
          error() {
            activeSocket = null;
            resolve();
          },
          open(sock) {
            sock.write(JSON.stringify({ paneId: localPaneId, token: proxyToken }) + "\n");
            activeSocket = sock;
            retry = 0;
          },
        },
        unix: socketPath,
      });
    });
  }

  // Reconnecting loop — retries indefinitely.
  // The proxy stays alive through network outages and honeymux restarts.
  // Only exits when honeymux explicitly kills this pane (via kill-pane or respawn-pane).
  while (true) {
    try {
      await connectToHoneymux();
    } catch {
      // Connection failed — honeymux socket not ready
    }

    retry++;
    const delay = retry < 5 ? 1000 : retry < 15 ? 3000 : 10000;
    await Bun.sleep(delay);
  }
}

async function main(): Promise<void> {
  const localPaneId = process.argv[2];
  if (!localPaneId) {
    console.error("Usage: proxy.ts <paneId> <token>");
    process.exit(1);
  }

  const proxyToken = process.argv[3];
  if (!proxyToken) {
    console.error("Proxy token missing");
    process.exit(1);
  }

  await runRemoteProxyProcess(localPaneId, proxyToken);
}

if (import.meta.main) {
  await main();
}
