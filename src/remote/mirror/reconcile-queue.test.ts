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

  test("waits for a quiet period before each run (trailing-edge debounce)", async () => {
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

    // Single request: debounce sleeps once, then runs.
    queue.request();
    await queue.whenIdle();
    expect(sleep).toHaveBeenCalledTimes(1);
    const [firstDelay] = sleep.mock.calls[0]!;
    expect(firstDelay as unknown as number).toBe(100);

    // Second request after the first run idles: another single sleep, then run.
    sleep.mockClear();
    queue.request();
    await queue.whenIdle();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(runs.length).toBe(2);
  });

  test("re-sleeps when a new request arrives during the quiet period", async () => {
    let arrived: (() => void) | null = null;
    const sleepCalls: number[] = [];
    const sleep = mock(async (ms: number) => {
      sleepCalls.push(ms);
      // On the first sleep, inject a new request so the queue must re-sleep.
      if (sleepCalls.length === 1 && arrived) {
        arrived();
        arrived = null;
      }
    });
    const runs = { value: 0 };
    const queue = new ReconcileQueue({
      debounceMs: 50,
      label: "test",
      run: async () => {
        runs.value += 1;
      },
      sleep,
    });

    arrived = () => queue.request();
    queue.request();
    await queue.whenIdle();

    // Two sleeps (initial quiet attempt + re-sleep after the injected request)
    // but only one run, because both requests fell within the same quiet window.
    expect(sleepCalls.length).toBe(2);
    expect(runs.value).toBe(1);
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
