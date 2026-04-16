import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";
import type { MutableRefObject } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PtyBridge } from "../../util/pty.ts";
import type { RuntimeDims } from "./runtime-context.ts";

interface ReattachSessionPtyOptions {
  ptyRef: MutableRefObject<PtyBridge | null>;
  sessionName: string;
  spawnPtyBridge: ((targetSession: string) => unknown) | null;
  terminalRef: MutableRefObject<GhosttyTerminalRenderable | null>;
}

interface RefreshAttachedTmuxClientOptions {
  client: TmuxControlClient | null;
  dims: Pick<RuntimeDims, "cols" | "rows">;
  pty: PtyBridge | null;
}

export function reattachSessionPty({
  ptyRef,
  sessionName,
  spawnPtyBridge,
  terminalRef,
}: ReattachSessionPtyOptions): void {
  if (!spawnPtyBridge) return;

  const oldPty = ptyRef.current;
  ptyRef.current = null;

  try {
    terminalRef.current?.reset();
  } catch {
    // ignore
  }

  try {
    oldPty?.kill();
  } catch {
    // ignore
  }

  spawnPtyBridge(sessionName);
}

export async function refreshAttachedTmuxClient({
  client,
  dims,
  pty,
}: RefreshAttachedTmuxClientOptions): Promise<void> {
  if (client) {
    try {
      await client.refreshPtyClient();
      return;
    } catch {
      // Fall back to a size toggle if tmux can't target the attached client.
    }
  }

  if (pty && dims.cols > 1 && dims.rows > 0) {
    pty.resize(dims.cols - 1, dims.rows);
    setTimeout(() => pty.resize(dims.cols, dims.rows), 50);
  }
}
