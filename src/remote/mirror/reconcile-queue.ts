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
 * Optional debounce waits for a quiet period after the latest request
 * before each run starts. This prevents an expensive reconcile from
 * snapshotting a transient intermediate layout mid-burst (e.g. while the
 * user is dragging the sidebar) and then taking several follow-up passes
 * to settle on the final dimensions.
 */
export interface ReconcileQueueOptions {
  /** Quiet period after the latest request before a run starts, ms. Default 0. */
  debounceMs?: number;
  /** Tag used in log messages for diagnostics. */
  label?: string;
  /** The actual reconcile work, including snapshot capture + executor. */
  run: () => Promise<void>;
  /** Optional clock injection for tests. Defaults to Bun.sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export class ReconcileQueue {
  // Set synchronously inside `request()` before `drain()` is invoked. This
  // prevents re-entrant `request()` calls — fired from event handlers that
  // execute inside the synchronous prologue of `drain()` (e.g. a sleep mock
  // or any other code path that runs during the first `await sleep(...)`) —
  // from starting a parallel drain because `this.loop` has not yet been
  // assigned by `this.loop = this.drain()` (the RHS evaluates first).
  private active = false;
  private dirty = false;
  private loop: Promise<void> | null = null;
  private requestVersion = 0;
  private stopped = false;

  constructor(private options: ReconcileQueueOptions) {}

  request(): void {
    if (this.stopped) return;
    this.requestVersion += 1;
    this.dirty = true;
    if (!this.active) {
      this.active = true;
      this.loop = this.drain();
    }
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
        await this.respectDebounce();
        if (this.stopped) break;
        this.dirty = false;
        await this.runOnce();
      }
    } finally {
      this.active = false;
      this.loop = null;
    }
  }

  private async respectDebounce(): Promise<void> {
    const debounce = this.options.debounceMs ?? 0;
    if (debounce <= 0) return;
    const sleep = this.options.sleep ?? defaultSleep;
    // Trailing-edge debounce: sleep for `debounce`, and if any new
    // request arrived during the sleep, sleep again. This way we only
    // run after a quiet period — bursts of layout-change events
    // settle into one reconcile with the final state, not one per
    // intermediate frame.
    let observedVersion: number;
    do {
      observedVersion = this.requestVersion;
      await sleep(debounce);
    } while (!this.stopped && this.requestVersion !== observedVersion);
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
