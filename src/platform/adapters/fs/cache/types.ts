export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  size: number;
}

export interface FileCacheOptions {
  enabled?: boolean;
  ttl?: number;
  maxSize?: number;
  maxMemory?: number;
  /**
   * Lifetime of a process-local immutable release entry, in milliseconds.
   * `0` disables that tier. Defaults to the configured process-wide value; a
   * non-finite value falls back to that default too, because Infinity would
   * stamp entries that never expire. See cache/immutable-l1.ts for what this
   * bounds.
   *
   * The store behind it is process-global and keyed by authority scope, not
   * by instance, but this lifetime is enforced twice: stamped at admission
   * when THIS instance admits an entry, and applied as a maximum age on every
   * lookup THIS instance performs. An instance configured with a short TTL
   * therefore never serves an entry older than its own bound, even one a
   * long-TTL instance admitted; the entry itself remains for instances whose
   * lifetime still allows it.
   */
  immutableL1Ttl?: number;
}

export interface CacheStats {
  size: number;
  memoryUsed: number;
  hits: number;
  misses: number;
  hitRate: number;
}
