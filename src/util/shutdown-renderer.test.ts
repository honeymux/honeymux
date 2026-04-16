import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";

import { waitForStdinQuiet } from "./shutdown-renderer.ts";

class FakeStdin extends EventEmitter {}

describe("waitForStdinQuiet", () => {
  test("resolves after a quiet period with no data", async () => {
    const stdin = new FakeStdin();
    const start = Date.now();

    await waitForStdinQuiet(stdin as any, 20, 100);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15);
    expect(stdin.listenerCount("data")).toBe(0);
  });

  test("extends the quiet window when trailing input arrives", async () => {
    const stdin = new FakeStdin();
    const start = Date.now();

    setTimeout(() => {
      stdin.emit("data", Buffer.from("\x1b[0;5:3u"));
    }, 10);

    await waitForStdinQuiet(stdin as any, 30, 120);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(120);
    expect(stdin.listenerCount("data")).toBe(0);
  });

  test("caps the wait when input keeps arriving", async () => {
    const stdin = new FakeStdin();
    const start = Date.now();

    const interval = setInterval(() => {
      stdin.emit("data", Buffer.from("\x1b[0;5:3u"));
    }, 10);

    try {
      await waitForStdinQuiet(stdin as any, 30, 80);
    } finally {
      clearInterval(interval);
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(140);
    expect(stdin.listenerCount("data")).toBe(0);
  });
});
