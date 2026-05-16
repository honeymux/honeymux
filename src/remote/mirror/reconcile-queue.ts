import { log } from "../../util/log.ts";

/**
 * Serialized executor for the mirror reconciler.
 *
 * Coalesces concurrent `request()` calls: while a reconcile is in flight,
 * additional requests set a dirty flag rather than queueing — the running
 * pass observes the flag at the end of its work and re-runs once. This
 * collapses bursts of `%layout-change` / `%window-add` events into a
 * single follow-up pass instead of fanning them into N reconciliations.
 *
 * Optional debounce between back-to-back runs prevents pathological
 * livelock under continuous event streams.
 */
export interface ReconcileQueueOptions {
  /** Minimum gap between successive runs, ms. Default 0. */
  debounceMs?: number;
  /** Tag used in log messages for diagnostics. */
  label?: string;
  /** The actual reconcile work, including snapshot capture + executor. */
  run: () => Promise<void>;
  /** Optional clock injection for tests. Defaults to Date.now + Bun.sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export class ReconcileQueue {
  private dirty = false;
  private lastRunAt = 0;
  private loop: Promise<void> | null = null;
  private stopped = false;

  constructor(private options: ReconcileQueueOptions) {}

  request(): void {
    if (this.stopped) return;
    this.dirty = true;
    if (!this.loop) this.loop = this.drain();
  }

  /**
   * Stop accepting new requests. Any in-flight loop runs to completion
   * but does not re-enter on dirty. Idempotent.
   */
  stop(): void {
    this.stopped = true;
  }

  /** Wait for the current loop (if any) to finish. */
  async whenIdle(): Promise<void> {
    if (this.loop) await this.loop;
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        await this.respectDebounce();
        await this.runOnce();
        this.lastRunAt = nowMs();
      }
    } finally {
      this.loop = null;
    }
  }

  private async respectDebounce(): Promise<void> {
    const debounce = this.options.debounceMs ?? 0;
    if (debounce <= 0 || this.lastRunAt === 0) return;
    const elapsed = nowMs() - this.lastRunAt;
    if (elapsed >= debounce) return;
    const sleep = this.options.sleep ?? defaultSleep;
    await sleep(debounce - elapsed);
  }

  private async runOnce(): Promise<void> {
    try {
      await this.options.run();
    } catch (err) {
      const label = this.options.label ?? "reconcile";
      const msg = err instanceof Error ? err.message : String(err);
      log("remote", `${label}: run failed: ${msg}`);
      // Re-arm so the next iteration attempts repair. Pure reconciler
      // guarantees idempotency, so retrying the same operation is safe.
      this.dirty = true;
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

function nowMs(): number {
  return Date.now();
}
