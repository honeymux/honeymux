import { describe, expect, mock, test } from "bun:test";

import { createSocketWriteQueue } from "./socket-write-queue.ts";

function bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "binary"));
}

function decode(data: Uint8Array): string {
  return Buffer.from(data).toString("binary");
}

describe("createSocketWriteQueue", () => {
  test("queues an unwritten suffix after a partial socket write", () => {
    const accepted: string[] = [];
    const writeLimits = [3, 99];
    const queue = createSocketWriteQueue(
      {
        write(data) {
          const limit = writeLimits.shift() ?? 99;
          const acceptedBytes = Math.min(limit, data.byteLength);
          accepted.push(decode(data.subarray(0, acceptedBytes)));
          return acceptedBytes;
        },
      },
      { maxQueuedBytes: 16 },
    );

    expect(queue.write(bytes("abcdef"))).toBe(true);
    expect(queue.pendingBytes).toBe(3);

    expect(queue.flush()).toBe(true);

    expect(accepted.join("")).toBe("abcdef");
    expect(queue.pendingBytes).toBe(0);
  });

  test("preserves write order while additional chunks arrive under backpressure", () => {
    const accepted: string[] = [];
    const writeLimits = [2, 0, 99, 99];
    const queue = createSocketWriteQueue(
      {
        write(data) {
          const limit = writeLimits.shift() ?? 99;
          const acceptedBytes = Math.min(limit, data.byteLength);
          accepted.push(decode(data.subarray(0, acceptedBytes)));
          return acceptedBytes;
        },
      },
      { maxQueuedBytes: 16 },
    );

    expect(queue.write(bytes("abcd"))).toBe(true);
    expect(queue.write(bytes("ef"))).toBe(true);
    expect(queue.pendingBytes).toBe(4);

    expect(queue.flush()).toBe(true);

    expect(accepted.join("")).toBe("abcdef");
    expect(queue.pendingBytes).toBe(0);
  });

  test("tries to flush queued bytes before applying the queue cap to new data", () => {
    const accepted: string[] = [];
    const end = mock(() => {});
    const writeLimits = [1, 99, 99];
    const queue = createSocketWriteQueue(
      {
        end,
        write(data) {
          const limit = writeLimits.shift() ?? 99;
          const acceptedBytes = Math.min(limit, data.byteLength);
          accepted.push(decode(data.subarray(0, acceptedBytes)));
          return acceptedBytes;
        },
      },
      { maxQueuedBytes: 3 },
    );

    expect(queue.write(bytes("abcd"))).toBe(true);
    expect(queue.pendingBytes).toBe(3);

    expect(queue.write(bytes("ef"))).toBe(true);

    expect(accepted.join("")).toBe("abcdef");
    expect(end).not.toHaveBeenCalled();
    expect(queue.pendingBytes).toBe(0);
  });

  test("closes on queue overflow instead of silently dropping bytes", () => {
    const end = mock(() => {});
    const onWriteOverflow = mock(() => {});
    const queue = createSocketWriteQueue(
      {
        end,
        write(data) {
          return Math.min(1, data.byteLength);
        },
      },
      { maxQueuedBytes: 2, onWriteOverflow },
    );

    expect(queue.write(bytes("abcd"))).toBe(false);

    expect(end).toHaveBeenCalledTimes(1);
    expect(onWriteOverflow).toHaveBeenCalledTimes(1);
    expect(queue.pendingBytes).toBe(0);
  });

  test("closes on socket write failure", () => {
    const end = mock(() => {});
    const onWriteError = mock(() => {});
    const queue = createSocketWriteQueue(
      {
        end,
        write() {
          return -1;
        },
      },
      { maxQueuedBytes: 16, onWriteError },
    );

    expect(queue.write(bytes("abc"))).toBe(false);

    expect(end).toHaveBeenCalledTimes(1);
    expect(onWriteError).toHaveBeenCalledTimes(1);
  });
});
