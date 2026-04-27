import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { probeTerminal } from "./terminal-probe.ts";

let originalStdinIsTTY: PropertyDescriptor | undefined;
let originalStdoutIsTTY: PropertyDescriptor | undefined;
let originalStdoutWrite: typeof process.stdout.write;
let writeChunks: string[];

function emitCpr(row: number, col: number): void {
  process.stdin.emit("data", Buffer.from(`\x1b[${row};${col}R`, "latin1"));
}

function restoreProperty(target: object, property: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }

  delete (target as Record<string, unknown>)[property];
}

beforeEach(() => {
  originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  originalStdoutWrite = process.stdout.write;
  writeChunks = [];

  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  process.stdout.write = ((
    chunk: Uint8Array | string,
    encoding?: ((error?: Error | null) => void) | BufferEncoding,
    cb?: (error?: Error | null) => void,
  ) => {
    writeChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    if (typeof encoding === "function") {
      encoding();
    } else if (cb) {
      cb();
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  restoreProperty(process.stdin, "isTTY", originalStdinIsTTY);
  restoreProperty(process.stdout, "isTTY", originalStdoutIsTTY);
});

describe("terminal probe output", () => {
  test("uses BEL terminators for OSC color queries", async () => {
    const resultPromise = probeTerminal({
      queryCursorStyle: false,
      queryPalette: true,
      timeout: 1_000,
    });

    const phase1 = writeChunks[0]!;
    expect(phase1).toContain("\x1b]10;?\x07");
    expect(phase1).toContain("\x1b]11;?\x07");
    expect(phase1).toContain("\x1b]4;0;?\x07");
    expect(phase1).toContain("\x1b]4;15;?\x07");
    expect(phase1).not.toContain("\x1b]10;?\x1b\\");
    expect(phase1).not.toContain("\x1b]11;?\x1b\\");

    emitCpr(1, 10);
    emitCpr(1, 11);

    const result = await resultPromise;
    expect(result.isUtf8).toBe(true);
  });
});
