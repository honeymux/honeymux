import { describe, expect, mock, test } from "bun:test";

import { resolveActivePaneId, syncActivePaneRef } from "./active-pane-sync.ts";

function deferred<T>(): { promise: Promise<T>; reject: (error: unknown) => void; resolve: (value: T) => void } {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res, rej) => {
    reject = rej;
    resolve = res;
  });
  return { promise, reject, resolve };
}

describe("active pane sync", () => {
  test("keeps a newer active pane ref when an older sync resolves", async () => {
    const panes = deferred<Array<{ active: boolean; id: string }>>();
    const activePaneIdRef = { current: "%2" };
    const sync = syncActivePaneRef({
      activePaneIdRef,
      client: {
        getAllPaneInfo: mock(async () => []),
        listPanesInWindow: mock(() => panes.promise),
      },
      fallbackPaneId: "%2",
      windowId: "@1",
    });

    activePaneIdRef.current = "%1";
    panes.resolve([{ active: true, id: "%2" }]);
    await sync;

    expect(activePaneIdRef.current).toBe("%1");
  });

  test("resolves the active pane id", () => {
    expect(
      resolveActivePaneId([
        { active: false, id: "%1" },
        { active: true, id: "%2" },
      ]),
    ).toBe("%2");
  });

  test("updates the ref when no newer focus change occurred", async () => {
    const activePaneIdRef = { current: "%1" };

    await syncActivePaneRef({
      activePaneIdRef,
      client: {
        getAllPaneInfo: mock(async () => []),
        listPanesInWindow: mock(async () => [
          { active: false, id: "%1" },
          { active: true, id: "%2" },
        ]),
      },
      fallbackPaneId: "%1",
      windowId: "@1",
    });

    expect(activePaneIdRef.current).toBe("%2");
  });
});
