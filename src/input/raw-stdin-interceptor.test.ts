import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { installRawStdinInterceptor } from "./raw-stdin-interceptor.ts";

describe("raw stdin interceptor", () => {
  let cleanup: (() => void) | null = null;
  let dataListeners: Array<(chunk: Buffer) => void> = [];
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = mock((_chunk: any) => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    for (const listener of dataListeners) {
      process.stdin.off("data", listener);
    }
    dataListeners = [];
    process.stdout.write = originalStdoutWrite;
  });

  function captureForwardedInput(): string[] {
    const forwarded: string[] = [];
    const listener = (chunk: Buffer) => {
      forwarded.push(chunk.toString("utf-8"));
    };
    dataListeners.push(listener);
    process.stdin.on("data", listener);
    return forwarded;
  }

  test("does not treat focus replies embedded in paste as standalone focus events", () => {
    const writes: string[] = [];

    cleanup = installRawStdinInterceptor(
      (data) => {
        writes.push(data);
      },
      {
        mapCoordinates: () => null,
      },
    );

    (process.stdin as any).emit("data", Buffer.from("\x1b[200~X\x1b[IY\x1b[201~", "utf-8"));

    expect(writes).toEqual(["\x1b[200~X\x1b[IY\x1b[201~"]);
  });

  test("preserves UTF-8 characters split across input buffers", () => {
    const forwarded = captureForwardedInput();

    cleanup = installRawStdinInterceptor(() => {}, {
      mapCoordinates: () => null,
    });

    const smile = Buffer.from("🙂", "utf-8");
    (process.stdin as any).emit("data", smile.subarray(0, 2));
    (process.stdin as any).emit("data", smile.subarray(2));

    expect(forwarded).toEqual(["🙂"]);
  });

  test("forwards focus events split across buffers to the PTY", () => {
    const forwarded = captureForwardedInput();
    const writes: string[] = [];

    cleanup = installRawStdinInterceptor(
      (data) => {
        writes.push(data);
      },
      {
        mapCoordinates: () => null,
      },
    );

    (process.stdin as any).emit("data", Buffer.from("\x1b[", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("I", "utf-8"));

    expect(writes).toEqual(["\x1b[I"]);
    expect(forwarded).toEqual([]);
  });

  test("routes SGR mouse reports split across buffers before OpenTUI sees them", () => {
    const forwarded = captureForwardedInput();
    const writes: string[] = [];

    cleanup = installRawStdinInterceptor(
      (data) => {
        writes.push(data);
      },
      {
        mapCoordinates: () => ({ x: 4, y: 6 }),
      },
    );

    (process.stdin as any).emit("data", Buffer.from("\x1b[<0;10;", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("5M", "utf-8"));

    expect(writes).toEqual(["\x1b[<0;4;6M"]);
    expect(forwarded).toEqual([]);
  });

  test("forwards focus events split as lone ESC + [I across buffers", () => {
    const forwarded = captureForwardedInput();
    const writes: string[] = [];

    cleanup = installRawStdinInterceptor(
      (data) => {
        writes.push(data);
      },
      {
        mapCoordinates: () => null,
      },
    );

    (process.stdin as any).emit("data", Buffer.from("hello\x1b", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("[Iworld", "utf-8"));

    expect(writes).toEqual(["\x1b[I"]);
    expect(forwarded).toEqual(["hello", "world"]);
  });

  test("forwards focus out events split as lone ESC + [O across buffers", () => {
    const forwarded = captureForwardedInput();
    const writes: string[] = [];

    cleanup = installRawStdinInterceptor(
      (data) => {
        writes.push(data);
      },
      {
        mapCoordinates: () => null,
      },
    );

    (process.stdin as any).emit("data", Buffer.from("x\x1b", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("[Oy", "utf-8"));

    expect(writes).toEqual(["\x1b[O"]);
    expect(forwarded).toEqual(["x", "y"]);
  });

  test("preserves SGR color codes split across buffers", () => {
    const forwarded = captureForwardedInput();

    cleanup = installRawStdinInterceptor(() => {}, {
      mapCoordinates: () => null,
    });

    // Split SGR color code: \x1b[39m (default foreground)
    // Text before the sequence is emitted first, then the complete sequence arrives with remaining text.
    (process.stdin as any).emit("data", Buffer.from("text\x1b[3", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("9mmore", "utf-8"));

    expect(forwarded).toEqual(["text", "\x1b[39mmore"]);
  });

  test("preserves incomplete CSI sequences at chunk boundaries", () => {
    const forwarded = captureForwardedInput();

    cleanup = installRawStdinInterceptor(() => {}, {
      mapCoordinates: () => null,
    });

    // Split cursor up sequence: \x1b[5A
    // Text before the sequence is emitted first, then the complete sequence arrives.
    (process.stdin as any).emit("data", Buffer.from("prompt\x1b[5", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("A", "utf-8"));

    expect(forwarded).toEqual(["prompt", "\x1b[5A"]);
  });

  test("flushes lone ESC after carry timeout", async () => {
    const forwarded = captureForwardedInput();

    cleanup = installRawStdinInterceptor(() => {}, {
      mapCoordinates: () => null,
    });

    // Send a lone ESC — should be buffered, not forwarded immediately.
    (process.stdin as any).emit("data", Buffer.from("\x1b", "utf-8"));
    expect(forwarded).toEqual([]);

    // After the carry timeout (20 ms), the ESC should be flushed.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(forwarded).toEqual(["\x1b"]);
  });

  test("does not double-flush ESC when follow-up bytes arrive before timeout", async () => {
    const forwarded = captureForwardedInput();

    cleanup = installRawStdinInterceptor(() => {}, {
      mapCoordinates: () => null,
    });

    // Send lone ESC, then complete the CSI sequence before timeout fires.
    (process.stdin as any).emit("data", Buffer.from("\x1b", "utf-8"));
    (process.stdin as any).emit("data", Buffer.from("[A", "utf-8"));

    // The complete sequence should be forwarded, not a lone ESC.
    expect(forwarded).toEqual(["\x1b[A"]);

    // Wait past the timeout — nothing extra should appear.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(forwarded).toEqual(["\x1b[A"]);
  });
});
