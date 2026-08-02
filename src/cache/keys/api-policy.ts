// Keep this provider-neutral contract aligned with the shared cache API schema.
/** Maximum concrete key or glob length accepted by the cache API. */
export const API_CACHE_KEY_MAX_LENGTH = 512;
/** Namespace reserved for deterministic API-boundary key rewrites. */
export const SANITIZED_CACHE_KEY_MARKER = "vf-sanitized:";

export const CACHE_KEY_ALLOWED_PATTERN = /^[a-zA-Z0-9_:./-]+$/;
export const CACHE_PATTERN_ALLOWED_PATTERN = /^[a-zA-Z0-9_:.*/-]+$/;

/** Whether a concrete key can cross the API cache boundary unchanged. */
export function isValidCacheKey(key: string): boolean {
  return key.length > 0 &&
    key.length <= API_CACHE_KEY_MAX_LENGTH &&
    CACHE_KEY_ALLOWED_PATTERN.test(key);
}

/** Whether a concrete key can cross the API boundary without being rewritten. */
export function isCacheKeyPassThroughSafe(key: string): boolean {
  return isValidCacheKey(key) && !key.includes(SANITIZED_CACHE_KEY_MARKER);
}

/** Whether a deletion glob can cross the API cache boundary unchanged. */
export function isValidCachePattern(pattern: string): boolean {
  return pattern.length > 0 &&
    pattern.length <= API_CACHE_KEY_MAX_LENGTH &&
    CACHE_PATTERN_ALLOWED_PATTERN.test(pattern);
}
