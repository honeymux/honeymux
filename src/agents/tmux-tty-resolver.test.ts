import { describe, expect, mock, test } from "bun:test";

import { EventEmitter } from "../util/event-emitter.ts";
import { TmuxTtyResolver } from "./tmux-tty-resolver.ts";

class FakeClient extends EventEmitter {
  listPaneTtyMappings = mock(async () => [
    {
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    },
  ]);

  trigger(event: string, ...args: unknown[]): void {
    this.emit(event, ...args);
  }
}

describe("TmuxTtyResolver", () => {
  test("queries once and reuses the cached mapping until invalidated", async () => {
    const client = new FakeClient();
    const resolver = new TmuxTtyResolver(client);
    resolver.start();

    await expect(resolver.resolveTty("/dev/pts/7")).resolves.toEqual({
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    });
    await expect(resolver.resolveTty("/dev/pts/7")).resolves.toEqual({
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    });

    expect(client.listPaneTtyMappings).toHaveBeenCalledTimes(1);
  });

  test("can resolve by pane id from the same cached snapshot", async () => {
    const client = new FakeClient();
    const resolver = new TmuxTtyResolver(client);
    resolver.start();

    await expect(resolver.resolvePaneId("%7")).resolves.toEqual({
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    });
    await expect(resolver.resolveTty("/dev/pts/7")).resolves.toEqual({
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    });

    expect(client.listPaneTtyMappings).toHaveBeenCalledTimes(1);
  });

  test("refreshes after a tmux pane/layout invalidation event", async () => {
    const client = new FakeClient();
    const resolver = new TmuxTtyResolver(client);
    resolver.start();

    await resolver.resolveTty("/dev/pts/7");
    client.listPaneTtyMappings.mockResolvedValueOnce([
      {
        paneId: "%8",
        sessionName: "beta",
        tty: "/dev/pts/8",
        windowId: "@4",
      },
    ]);

    client.trigger("window-pane-changed", "@4", "%8");

    await expect(resolver.resolveTty("/dev/pts/8")).resolves.toEqual({
      paneId: "%8",
      sessionName: "beta",
      tty: "/dev/pts/8",
      windowId: "@4",
    });
    expect(client.listPaneTtyMappings).toHaveBeenCalledTimes(2);
  });

  test("falls back to the last successful snapshot when refresh fails", async () => {
    const client = new FakeClient();
    const resolver = new TmuxTtyResolver(client);
    resolver.start();

    await resolver.resolveTty("/dev/pts/7");
    client.listPaneTtyMappings.mockRejectedValueOnce(new Error("tmux down"));
    client.trigger("layout-change", "@3", "layout");

    await expect(resolver.resolveTty("/dev/pts/7")).resolves.toEqual({
      paneId: "%7",
      sessionName: "alpha",
      tty: "/dev/pts/7",
      windowId: "@3",
    });
    expect(client.listPaneTtyMappings).toHaveBeenCalledTimes(2);
  });
});
