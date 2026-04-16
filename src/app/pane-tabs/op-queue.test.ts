import { describe, expect, mock, test } from "bun:test";

import { createPaneTabOpQueue } from "./op-queue.ts";

describe("pane tab op queue", () => {
  test("serializes queued operations", async () => {
    const queue = createPaneTabOpQueue();
    const steps: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      steps.push("first:start");
      await firstDone;
      steps.push("first:end");
    });
    const second = queue.enqueue(async () => {
      steps.push("second");
    });

    expect(steps).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(steps).toEqual(["first:start", "first:end", "second"]);
  });

  test("runs validation immediately when idle", async () => {
    const queue = createPaneTabOpQueue();
    const validate = mock(async () => {});

    queue.requestValidation(validate);
    await queue.enqueue(async () => {});

    expect(validate).toHaveBeenCalledTimes(1);
  });

  test("defers validation until the queue drains", async () => {
    const queue = createPaneTabOpQueue();
    const validate = mock(async () => {});
    let releaseOp!: () => void;
    const runningOp = new Promise<void>((resolve) => {
      releaseOp = resolve;
    });

    const inFlight = queue.enqueue(async () => {
      await runningOp;
    });

    expect(queue.isBusy()).toBe(true);
    queue.requestValidation(validate);
    queue.requestValidation(validate);
    expect(validate).toHaveBeenCalledTimes(0);

    releaseOp();
    await inFlight;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(validate).toHaveBeenCalledTimes(1);
  });
});
