/**
 * Cache Path Portability Utilities
 *
 * Centralizes logic for replacing absolute filesystem paths with portable tokens
 * (e.g., __VF_CACHE_DIR__) before storing code in distributed caches (Redis/API).
 * This ensures that cached code can be shared across different environments
 * (e.g., Build Server -> Production Pod) without "cache path mismatch" errors.
 *
 * @module core/cache/paths
 */

import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";

/** Portable cache directory token */
export const CACHE_DIR_TOKEN = "__VF_CACHE_DIR__";

/**
 * Common patterns for hardcoded cache paths that should be tokenized.
 * Used for invariant checks.
 */
const HARDCODED_PATH_PATTERNS = [
  /file:\/\/\/app\/.cache\//,
  /file:\/\/\/app\/\.cache\//,
  /file:\/\/\/Users\/[^/]+\/\.cache\//,
  /file:\/\/\/Users\/[^/]+\/.cache\//,
  /file:\/\/\/home\/[^/]+\/\.cache\//,
  /file:\/\/\/home\/[^/]+\/.cache\//,
  /file:\/\/\/tmp\/[^/]*\.cache\//,
  /file:\/\/\/var\/tmp\/[^/]*\.cache\//,
  /file:\/\/\/[A-Za-z]:\/.*\.cache\//,
];

/**
 * Check if code contains hardcoded cache paths that should be tokenized.
 */
export function hasHardcodedCachePaths(code: string): boolean {
  return HARDCODED_PATH_PATTERNS.some((pattern) => pattern.test(code));
}

/**
 * Replace local cache directory with portable token.
 */
export function tokenizeCachePaths(code: string, localCacheDir: string): string {
  if (!code) return code;
  // Normalize the cache dir (remove trailing slash if present)
  const normalizedDir = localCacheDir.endsWith("/") ? localCacheDir.slice(0, -1) : localCacheDir;
  return code.replaceAll(`file://${normalizedDir}`, `file://${CACHE_DIR_TOKEN}`);
}

/**
 * Replace portable token with local cache directory.
 */
export function detokenizeCachePaths(code: string, localCacheDir: string): string {
  if (!code) return code;
  // Normalize the cache dir (remove trailing slash if present)
  const normalizedDir = localCacheDir.endsWith("/") ? localCacheDir.slice(0, -1) : localCacheDir;
  return code.replaceAll(`file://${CACHE_DIR_TOKEN}`, `file://${normalizedDir}`);
}

/**
 * Tokenize all cache paths in code using the system's base cache directory.
 * Preferred function for tokenizing paths before storing in distributed cache.
 */
export function tokenizeAllCachePaths(code: string): string {
  return tokenizeCachePaths(code, getCacheBaseDir());
}

/**
 * Detokenize all cache paths in code using the system's base cache directory.
 * Preferred function for detokenizing paths after loading from distributed cache.
 */
export function detokenizeAllCachePaths(code: string): string {
  return detokenizeCachePaths(code, getCacheBaseDir());
}

/**
 * Error thrown when a cache invariant is violated (e.g., absolute path leaked to Redis).
 */
export class CacheInvariantError extends Error {
  constructor(message: string) {
    super(`[CACHE INVARIANT VIOLATION] ${message}`);
    this.name = "CacheInvariantError";
  }
}

/**
 * Assert that code is safe to store in distributed cache (portable).
 * @throws CacheInvariantError if code contains hardcoded paths
 */
export function assertPortableCode(code: string): void {
  if (hasHardcodedCachePaths(code)) {
    logger.error("[CACHE] Invariant violation: hardcoded paths in portable code");
    throw new CacheInvariantError(
      "Code contains hardcoded cache paths that should be tokenized before storage in distributed cache.",
    );
  }
}
