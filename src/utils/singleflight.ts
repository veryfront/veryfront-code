import { unrefTimer } from "#veryfront/compat/process.ts";

export interface SingleflightOptions {
  /** Last-resort age after which a never-settling leader may be replaced. */
  staleAfterMs?: number;
  /** Called after this exact leader is evicted as stale. */
  onStaleEvicted?: () => void;
}

export interface SingleflightControl {
  /** Whether this operation is still the exact leader registered for its key. */
  isCurrent(): boolean;
}

interface SingleflightEntry<T> {
  promise: Promise<T>;
  staleTimer?: ReturnType<typeof setTimeout>;
}

export class Singleflight<T> {
  private inflight = new Map<string, SingleflightEntry<T>>();

  async do(
    key: string,
    operation: (control: SingleflightControl) => Promise<T>,
    options: SingleflightOptions = {},
  ): Promise<T> {
    if (options.staleAfterMs !== undefined && options.staleAfterMs <= 0) {
      throw new RangeError("Singleflight staleAfterMs must be greater than zero");
    }

    const existing = this.inflight.get(key);
    if (existing) return existing.promise;

    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry: SingleflightEntry<T> = { promise };
    const control: SingleflightControl = {
      isCurrent: () => this.inflight.get(key) === entry,
    };
    this.inflight.set(key, entry);

    try {
      void operation(control).then(resolvePromise, rejectPromise);
    } catch (error) {
      rejectPromise(error);
    }

    if (options.staleAfterMs !== undefined) {
      entry.staleTimer = setTimeout(() => {
        if (this.inflight.get(key) !== entry) return;
        this.inflight.delete(key);
        options.onStaleEvicted?.();
      }, options.staleAfterMs);
      unrefTimer(entry.staleTimer);
    }

    try {
      return await promise;
    } finally {
      if (entry.staleTimer !== undefined) clearTimeout(entry.staleTimer);
      if (this.inflight.get(key) === entry) this.inflight.delete(key);
    }
  }

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  get size(): number {
    return this.inflight.size;
  }
}
