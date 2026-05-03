interface PaneTabOpQueue {
  enqueue<T>(op: () => Promise<T>): Promise<T>;
  isBusy: () => boolean;
  requestValidation: (validate: () => Promise<void>) => void;
}

export function createPaneTabOpQueue(): PaneTabOpQueue {
  const queue: Array<() => Promise<void>> = [];
  let running = false;
  let deferredValidation: (() => Promise<void>) | null = null;

  async function drain(): Promise<void> {
    if (running) return;
    let nextValidation: (() => Promise<void>) | null;
    running = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) continue;
        await next();
      }
    } finally {
      running = false;
      nextValidation = deferredValidation;
      deferredValidation = null;
    }
    if (!nextValidation) return;
    void enqueue(nextValidation).catch(() => {});
  }

  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await op());
        } catch (error) {
          reject(error);
        }
      });
      void drain();
    });
  }

  function isBusy(): boolean {
    return running || queue.length > 0;
  }

  function requestValidation(validate: () => Promise<void>): void {
    if (isBusy()) {
      deferredValidation = validate;
      return;
    }
    void enqueue(validate).catch(() => {});
  }

  return { enqueue, isBusy, requestValidation };
}
