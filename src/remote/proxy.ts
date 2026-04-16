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
import { log } from "../util/log.ts";
import { getRemoteProxySocketPath } from "./proxy-server.ts";

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

log("proxy", `started: paneId=${localPaneId}`);

// The proxy's pty is in canonical mode with echo by default. When local
// tmux responds to query escape sequences it sees in the pane output we
// forward (e.g. XTVERSION, DA1, DSR), it writes its reply bytes into our
// pty — and the kernel line discipline echoes those bytes back out in
// caret-notation (ESC → "^["), which tmux reads as pane output and
// renders as literal text. Disabling raw-mode echo stops the round trip,
// and draining stdin keeps the kernel pty buffer from filling up and
// blocking tmux's writes.
const stdin = process.stdin as { setRawMode?: (mode: boolean) => unknown } & NodeJS.ReadStream;
if (stdin.isTTY && typeof stdin.setRawMode === "function") {
  stdin.setRawMode(true);
}
stdin.resume();
stdin.on("data", () => {});

const socketPath = getRemoteProxySocketPath();
let retry = 0;

async function connectToHoneymux(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    Bun.connect({
      socket: {
        close() {
          log("proxy", `socket closed (pane=${localPaneId})`);
          resolve();
        },
        connectError(_sock, error) {
          log("proxy", `connect error (pane=${localPaneId}): ${error.message}`);
          reject(error);
        },
        data(_sock, data) {
          // Remote-pane escape handling is delegated to the local tmux pane.
          process.stdout.write(data);
        },
        error() {
          resolve();
        },
        open(sock) {
          log("proxy", `connected to honeymux socket (pane=${localPaneId})`);
          sock.write(JSON.stringify({ paneId: localPaneId, token: proxyToken }) + "\n");
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
