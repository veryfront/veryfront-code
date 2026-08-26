export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  size: number;
  /**
   * The backend lifetime the writing instance stored the entry with, in
   * milliseconds from `timestamp`. Recorded because instances configure their
   * TTLs independently: a reader must bound what it holds in the process-local
   * immutable tier by the writer's actual backend expiry, not by its own
   * configured `ttl`. Absent from entries serialized before this field
   * existed; readers fall back to their own `ttl` for those.
   */
  backendTtlMs?: number;
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
   * stamp entries that never expire. A value above `IMMUTABLE_L1_MAX_TTL_MS`
   * is clamped to it, the same security maximum the env resolver enforces,
   * because this lifetime is the width of the credential-revocation and
   * cross-pod publish-visibility windows. The effective lifetime also never
   * exceeds `ttl`: `ttl` is the freshness bound the public config exposes,
   * and this tier must not serve a value the backend cache has already
   * expired. See cache/immutable-l1.ts for what this bounds.
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
