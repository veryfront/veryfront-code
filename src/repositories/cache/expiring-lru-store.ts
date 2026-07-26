import { expiresImmediately, resolveCacheTtlSeconds } from "#veryfront/cache/backends/ttl.ts";

interface ExpiringEntry<T> {
  value: T;
  /** `null` is reserved for explicitly unbounded test-fixture entries. */
  expiresAt: number | null;
}

/**
 * Small synchronous LRU store shared by repository caches and their test fake.
 *
 * `Map` insertion order is the recency list. Reads and updates move an entry to
 * the tail, while capacity eviction removes from the head.
 */
export class ExpiringLruStore<T> {
  private readonly entries = new Map<string, ExpiringEntry<T>>();

  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("Repository cache maxEntries must be a positive safe integer");
    }
  }

  private isExpired(entry: ExpiringEntry<T>, now: number): boolean {
    return entry.expiresAt !== null && now >= entry.expiresAt;
  }

  private deleteIfExpired(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    if (!entry || !this.isExpired(entry, now)) return false;
    this.entries.delete(key);
    return true;
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) this.entries.delete(key);
    }
  }

  private evictLeastRecentlyUsed(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }

  get(key: string): T | null {
    const now = Date.now();
    if (this.deleteIfExpired(key, now)) return null;

    const entry = this.entries.get(key);
    if (!entry) return null;

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return !this.deleteIfExpired(key, Date.now()) && this.entries.has(key);
  }

  getRemainingTtlSeconds(key: string): number | null {
    const now = Date.now();
    if (this.deleteIfExpired(key, now)) return null;

    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt === null) return Number.POSITIVE_INFINITY;
    return (entry.expiresAt - now) / 1_000;
  }

  set(
    key: string,
    value: T,
    ttlSeconds?: number,
    defaultTtlSeconds?: number,
  ): void {
    const ttl = resolveCacheTtlSeconds(ttlSeconds, defaultTtlSeconds);
    if (expiresImmediately(ttl)) {
      this.entries.delete(key);
      return;
    }

    const now = Date.now();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.purgeExpired(now);
    while (this.entries.size >= this.maxEntries) this.evictLeastRecentlyUsed();

    this.entries.set(key, {
      value,
      expiresAt: ttl === undefined ? null : now + ttl * 1_000,
    });
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      deleted++;
    }
    return deleted;
  }

  clear(): number {
    const deleted = this.entries.size;
    this.entries.clear();
    return deleted;
  }

  snapshot(): Map<string, T> {
    this.purgeExpired(Date.now());
    return new Map([...this.entries].map(([key, entry]) => [key, entry.value]));
  }

  get size(): number {
    this.purgeExpired(Date.now());
    return this.entries.size;
  }
}
