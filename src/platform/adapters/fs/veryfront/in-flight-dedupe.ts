interface InFlightEntry<T> {
  promise: Promise<T>;
  startedAt: number;
  identity: symbol;
}

interface InFlightDeduperOptions {
  timeoutMs: number;
  maxEntries: number;
  cleanupIntervalMs: number;
}

interface InFlightCleanupResult {
  cleanedCount: number;
  remainingCount: number;
}

export class InFlightRequestDeduper<T> {
  private readonly entries = new Map<string, InFlightEntry<T>>();
  private lastCleanupTime = 0;

  constructor(private readonly options: InFlightDeduperOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
      throw new RangeError("timeoutMs must be a finite non-negative number");
    }
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive safe integer");
    }
    if (
      !Number.isFinite(options.cleanupIntervalMs) ||
      options.cleanupIntervalMs < 0
    ) {
      throw new RangeError(
        "cleanupIntervalMs must be a finite non-negative number",
      );
    }
  }

  get(key: string): InFlightEntry<T> | undefined {
    return this.entries.get(key);
  }

  set(
    key: string,
    promise: Promise<T>,
    startedAt = Date.now(),
    identity = Symbol(key),
  ): number {
    if (!Number.isFinite(startedAt)) {
      throw new RangeError("startedAt must be finite");
    }
    this.entries.set(key, { promise, startedAt, identity });
    return this.evictOverflow();
  }

  delete(key: string, expectedIdentity?: symbol): void {
    if (
      expectedIdentity !== undefined &&
      this.entries.get(key)?.identity !== expectedIdentity
    ) {
      return;
    }
    this.entries.delete(key);
  }

  cleanup(now = Date.now()): InFlightCleanupResult | undefined {
    if (!Number.isFinite(now)) throw new RangeError("now must be finite");
    const elapsed = now - this.lastCleanupTime;
    if (elapsed >= 0 && elapsed < this.options.cleanupIntervalMs) {
      return undefined;
    }

    this.lastCleanupTime = now;
    let cleanedCount = 0;

    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt > this.options.timeoutMs) {
        this.entries.delete(key);
        cleanedCount++;
      }
    }

    cleanedCount += this.evictOverflow();

    if (cleanedCount === 0) return undefined;
    return {
      cleanedCount,
      remainingCount: this.entries.size,
    };
  }

  private evictOverflow(): number {
    if (this.entries.size <= this.options.maxEntries) return 0;

    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].startedAt - b[1].startedAt,
    );
    const overflowCount = this.entries.size - this.options.maxEntries;
    for (const [key] of sorted.slice(0, overflowCount)) {
      this.entries.delete(key);
    }
    return overflowCount;
  }
}
