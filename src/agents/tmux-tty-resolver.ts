import type { TmuxPaneTtyMapping } from "../tmux/types.ts";

type TmuxTtyResolverClient = {
  listPaneTtyMappings(): Promise<TmuxPaneTtyMapping[]>;
  off(event: string, handler: (...args: any[]) => void): unknown;
  on(event: string, handler: (...args: any[]) => void): unknown;
};

const INVALIDATION_EVENTS = [
  "exit",
  "layout-change",
  "session-renamed",
  "window-add",
  "window-close",
  "window-pane-changed",
] as const;

export class TmuxTtyResolver {
  private cache = new Map<string, TmuxPaneTtyMapping>();
  private refreshPromise: Promise<void> | null = null;
  private stale = true;
  private started = false;

  constructor(private client: TmuxTtyResolverClient) {}

  async resolveTty(tty: string): Promise<TmuxPaneTtyMapping | undefined> {
    const cached = this.cache.get(tty);
    if (cached && !this.stale) return cached;

    try {
      await this.refresh();
    } catch {
      // Keep the last successful snapshot as a fallback on transient tmux errors.
    }

    return this.cache.get(tty);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const event of INVALIDATION_EVENTS) {
      this.client.on(event, this.handleInvalidation);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const event of INVALIDATION_EVENTS) {
      this.client.off(event, this.handleInvalidation);
    }
    this.cache.clear();
    this.refreshPromise = null;
    this.stale = true;
  }

  private readonly handleInvalidation = () => {
    this.stale = true;
  };

  private async refresh(): Promise<void> {
    if (!this.stale && this.cache.size > 0) return;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const mappings = await this.client.listPaneTtyMappings();
      const next = new Map<string, TmuxPaneTtyMapping>();
      for (const mapping of mappings) {
        next.set(mapping.tty, mapping);
      }
      this.cache = next;
      this.stale = false;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }
}
