import type { GhosttyTerminalRenderable } from "ghostty-opentui/terminal-buffer";

import { describe, expect, mock, test } from "bun:test";

import type { PtyBridge } from "../../util/pty.ts";

import { reattachSessionPty, refreshAttachedTmuxClient } from "./tmux-client-resync.ts";

describe("tmux client resync", () => {
  function createPtyBridge(): PtyBridge {
    return {
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      pid: 1234,
      resize: mock((_cols: number, _rows: number) => {}),
      write: mock((_data: string) => {}),
    };
  }

  test("reattaches the PTY after resetting the terminal buffer", () => {
    const resetMock = mock(() => {});
    const spawnMock = mock((_targetSession: string) => {});
    const pty = createPtyBridge();

    const ptyRef = {
      current: pty,
    };
    const terminalRef = {
      current: {
        reset: resetMock,
      } as unknown as GhosttyTerminalRenderable,
    };

    reattachSessionPty({
      ptyRef,
      sessionName: "alpha",
      spawnPtyBridge: spawnMock,
      terminalRef,
    });

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith("alpha");
    expect(ptyRef.current).toBeNull();
  });

  test("prefers tmux refresh-client over resizing the PTY", async () => {
    const refreshMock = mock(async () => {});
    const resizeMock = mock((_cols: number, _rows: number) => {});

    await refreshAttachedTmuxClient({
      client: {
        refreshPtyClient: refreshMock,
      } as any,
      dims: { cols: 120, rows: 40 },
      pty: { ...createPtyBridge(), resize: resizeMock },
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(resizeMock).not.toHaveBeenCalled();
  });

  test("falls back to a temporary resize when tmux refresh fails", async () => {
    const resizeMock = mock((_cols: number, _rows: number) => {});

    await refreshAttachedTmuxClient({
      client: {
        refreshPtyClient: mock(async () => {
          throw new Error("refresh failed");
        }),
      } as any,
      dims: { cols: 120, rows: 40 },
      pty: { ...createPtyBridge(), resize: resizeMock },
    });

    expect(resizeMock).toHaveBeenCalledTimes(1);
    expect(resizeMock).toHaveBeenNthCalledWith(1, 119, 40);

    await new Promise<void>((resolve) => setTimeout(resolve, 70));

    expect(resizeMock).toHaveBeenCalledTimes(2);
    expect(resizeMock).toHaveBeenNthCalledWith(2, 120, 40);
  });
});
