interface InFlightEntry<T> {
  promise: Promise<T>;
  startedAt: number;
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

  constructor(private readonly options: InFlightDeduperOptions) {}

  get(key: string): InFlightEntry<T> | undefined {
    return this.entries.get(key);
  }

  set(key: string, promise: Promise<T>, startedAt = Date.now()): void {
    this.entries.set(key, { promise, startedAt });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  cleanup(now = Date.now()): InFlightCleanupResult | undefined {
    if (now - this.lastCleanupTime < this.options.cleanupIntervalMs) return undefined;

    this.lastCleanupTime = now;
    let cleanedCount = 0;

    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt > this.options.timeoutMs) {
        this.entries.delete(key);
        cleanedCount++;
      }
    }

    if (this.entries.size > this.options.maxEntries) {
      const sorted = [...this.entries.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
      const overflowCount = this.entries.size - this.options.maxEntries;
      for (const [key] of sorted.slice(0, overflowCount)) {
        this.entries.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount === 0) return undefined;
    return {
      cleanedCount,
      remainingCount: this.entries.size,
    };
  }
}
