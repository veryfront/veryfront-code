/**
 * Resolve and validate a cache TTL using the contract shared by every backend.
 * Values at or below zero mean immediate expiry: remove any existing value and
 * do not store a replacement.
 */
export function resolveCacheTtlSeconds(
  ttlSeconds: number | undefined,
  defaultTtlSeconds?: number,
): number | undefined {
  const resolved = ttlSeconds ?? defaultTtlSeconds;
  if (
    resolved !== undefined &&
    (!Number.isFinite(resolved) || resolved > MAX_CACHE_TTL_SECONDS)
  ) {
    throw new RangeError(
      `Cache TTL must be a finite number of seconds at most ${MAX_CACHE_TTL_SECONDS}`,
    );
  }
  return resolved;
}

/**
 * Resolve a TTL for protocols that accept only whole seconds. Positive
 * fractions round up so integer conversion never expires an entry earlier than
 * requested; non-positive values retain their immediate-expiry meaning.
 */
export function resolveIntegerCacheTtlSeconds(
  ttlSeconds: number | undefined,
  defaultTtlSeconds?: number,
): number | undefined {
  const resolved = resolveCacheTtlSeconds(ttlSeconds, defaultTtlSeconds);
  return resolved !== undefined && resolved > 0 ? Math.ceil(resolved) : resolved;
}

export function expiresImmediately(ttlSeconds: number | undefined): boolean {
  return ttlSeconds !== undefined && ttlSeconds <= 0;
}

/**
 * Convert a positive millisecond TTL to a whole-second protocol TTL. Partial
 * seconds round up so the backing store never expires an entry earlier than
 * the configured logical freshness window.
 */
export function cacheTtlMillisecondsToSeconds(ttlMilliseconds: number): number {
  if (
    !Number.isFinite(ttlMilliseconds) ||
    ttlMilliseconds <= 0 ||
    ttlMilliseconds > MAX_CACHE_TTL_MILLISECONDS
  ) {
    throw new RangeError(
      `Cache TTL milliseconds must be greater than 0 and at most ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  return Math.ceil(ttlMilliseconds / 1_000);
}

/** Validate a constructor-level TTL for whole-second cache protocols. */
export function requirePositiveIntegerCacheTtlSeconds(ttlSeconds: number): number {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > MAX_CACHE_TTL_SECONDS
  ) {
    throw new RangeError(
      `Cache TTL seconds must be a positive integer at most ${MAX_CACHE_TTL_SECONDS}`,
    );
  }
  return ttlSeconds;
}
/** Shared default used when a CacheBackend caller omits a TTL. */
export const DEFAULT_CACHE_TTL_SECONDS = 300;

/**
 * Protocol-safe upper bound (signed 32-bit seconds, roughly 68 years). Besides
 * fitting Redis-style integer TTLs, its millisecond form can be added to a
 * contemporary epoch timestamp without exceeding Number.MAX_SAFE_INTEGER or
 * the JavaScript Date range.
 */
export const MAX_CACHE_TTL_SECONDS = 2_147_483_647;
export const MAX_CACHE_TTL_MILLISECONDS = MAX_CACHE_TTL_SECONDS * 1_000;
