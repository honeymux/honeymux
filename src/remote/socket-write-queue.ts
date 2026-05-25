export interface SocketWriteQueue {
  clear(): void;
  flush(): boolean;
  readonly pendingBytes: number;
  write(data: Uint8Array): boolean;
}

export interface SocketWriteQueueOptions {
  maxQueuedBytes: number;
  onWriteError?: () => void;
  onWriteOverflow?: () => void;
}

export interface SocketWriteTarget {
  end?: () => unknown;
  write(data: Uint8Array): number;
}

/**
 * Preserve byte-stream ordering across Bun socket backpressure.
 *
 * Bun sockets are unbuffered: write() may accept only a prefix of the input.
 * Call flush() from the socket's drain callback to write queued suffixes.
 */
export function createSocketWriteQueue(target: SocketWriteTarget, options: SocketWriteQueueOptions): SocketWriteQueue {
  const queue: Uint8Array[] = [];
  let closed = false;
  let headOffset = 0;
  let pendingBytes = 0;

  const clear = (): void => {
    queue.length = 0;
    headOffset = 0;
    pendingBytes = 0;
  };

  const close = (): false => {
    closed = true;
    clear();
    try {
      target.end?.();
    } catch {}
    return false;
  };

  const failWrite = (): false => {
    options.onWriteError?.();
    return close();
  };

  const overflow = (): false => {
    options.onWriteOverflow?.();
    return close();
  };

  const enqueue = (data: Uint8Array): boolean => {
    if (data.byteLength === 0) return true;
    if (pendingBytes + data.byteLength > options.maxQueuedBytes) return overflow();
    queue.push(data);
    pendingBytes += data.byteLength;
    return true;
  };

  const flush = (): boolean => {
    if (closed) return false;

    while (queue.length > 0) {
      const head = queue[0]!;
      const chunk = headOffset === 0 ? head : head.subarray(headOffset);
      const written = target.write(chunk);
      if (written < 0) return failWrite();
      if (written === 0) return true;

      const accepted = Math.min(written, chunk.byteLength);
      pendingBytes -= accepted;
      if (accepted < chunk.byteLength) {
        headOffset += accepted;
        return true;
      }

      queue.shift();
      headOffset = 0;
    }

    return true;
  };

  const write = (data: Uint8Array): boolean => {
    if (closed) return false;
    if (data.byteLength === 0) return true;

    if (queue.length > 0 && !flush()) return false;
    if (queue.length > 0) return enqueue(data);

    const written = target.write(data);
    if (written < 0) return failWrite();
    if (written === 0) return enqueue(data);

    const accepted = Math.min(written, data.byteLength);
    if (accepted === data.byteLength) return true;
    return enqueue(data.subarray(accepted));
  };

  return {
    clear,
    flush,
    get pendingBytes() {
      return pendingBytes;
    },
    write,
  };
}
