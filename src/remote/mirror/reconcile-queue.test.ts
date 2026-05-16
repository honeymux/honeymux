import { describe, expect, mock, test } from "bun:test";

import { ReconcileQueue } from "./reconcile-queue.ts";

function makeImmediate<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ReconcileQueue", () => {
  test("starts a run on first request and finishes it", async () => {
    const runCount = { value: 0 };
    const queue = new ReconcileQueue({
      label: "test",
      run: async () => {
        runCount.value += 1;
      },
    });

    queue.request();
    await queue.whenIdle();

    expect(runCount.value).toBe(1);
  });

  test("coalesces concurrent requests into a single follow-up run", async () => {
    const runs: number[] = [];
    const runStarted: Array<{ promise: Promise<void>; resolve: () => void }> = [];
    let gate = makeImmediate<void>();
    const queue = new ReconcileQueue({
      label: "test",
      run: async () => {
        runs.push(runs.length);
        const signal = makeImmediate<void>();
        runStarted.push(signal);
        signal.resolve();
        await gate.promise;
      },
    });

    queue.request();
    // Wait for run 0 to actually enter its body. Several microtask yields
    // are needed because drain() awaits respectDebounce → runOnce → options.run
    // before the push happens.
    while (runStarted.length === 0) await Promise.resolve();
    await runStarted.shift()!.promise;
    expect(runs).toEqual([0]);

    // Three additional requests while run 0 is in flight: coalesce to one re-run.
    queue.request();
    queue.request();
    queue.request();

    // Release run 0 and prepare a fresh gate for run 1.
    const prevGate = gate;
    gate = makeImmediate<void>();
    prevGate.resolve();

    // Wait for run 1 to start.
    while (runStarted.length === 0) await Promise.resolve();
    await runStarted.shift()!.promise;
    expect(runs).toEqual([0, 1]);

    // No further requests; release run 1 and confirm the loop exits.
    gate.resolve();
    await queue.whenIdle();
    expect(runs).toEqual([0, 1]);
  });

  test("re-arms on a thrown run so the next request retries the failed work", async () => {
    let attempts = 0;
    const queue = new ReconcileQueue({
      label: "test",
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first attempt fails");
      },
    });

    queue.request();
    await queue.whenIdle();

    // First run threw; the queue should have re-armed and run again.
    expect(attempts).toBe(2);
  });

  test("respects debounceMs between back-to-back runs", async () => {
    const runs: number[] = [];
    const sleep = mock(async (_ms: number) => {});
    const queue = new ReconcileQueue({
      debounceMs: 100,
      label: "test",
      run: async () => {
        runs.push(Date.now());
      },
      sleep,
    });

    queue.request();
    await queue.whenIdle();
    expect(sleep).not.toHaveBeenCalled(); // first run is immediate

    queue.request();
    await queue.whenIdle();
    // Second run should have waited.
    expect(sleep).toHaveBeenCalledTimes(1);
    const [delay] = sleep.mock.calls[0]!;
    expect(delay as unknown as number).toBeLessThanOrEqual(100);
  });

  test("stop() prevents future requests from starting a run", async () => {
    let runs = 0;
    const queue = new ReconcileQueue({
      label: "test",
      run: async () => {
        runs += 1;
      },
    });

    queue.stop();
    queue.request();
    queue.request();
    await queue.whenIdle();

    expect(runs).toBe(0);
  });
});
