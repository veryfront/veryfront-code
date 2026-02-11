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
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors/error-registry.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";

const logger = baseLogger.component("cache");

/** Portable cache directory token */
export const CACHE_DIR_TOKEN = "__VF_CACHE_DIR__";

/**
 * Common patterns for hardcoded cache paths that should be tokenized.
 * Used for invariant checks.
 *
 * These patterns match absolute file:// paths containing cache directories.
 * The patterns are intentionally broad to catch any absolute path that contains
 * veryfront cache markers (veryfront-http-bundle, veryfront-mdx-esm, .cache).
 */
const HARDCODED_PATH_PATTERNS = [
  // Direct .cache in common root paths
  /file:\/\/\/app\/.cache\//,
  /file:\/\/\/app\/\.cache\//,
  // .cache anywhere under /Users/ (catches /Users/*/any/path/.cache/)
  /file:\/\/\/Users\/[^"'\s]*\.cache\//,
  /file:\/\/\/Users\/[^"'\s]*\/\.cache\//,
  // .cache anywhere under /home/
  /file:\/\/\/home\/[^"'\s]*\.cache\//,
  /file:\/\/\/home\/[^"'\s]*\/\.cache\//,
  // Temp directories
  /file:\/\/\/tmp\/[^"'\s]*\.cache\//,
  /file:\/\/\/var\/tmp\/[^"'\s]*\.cache\//,
  // Windows paths
  /file:\/\/\/[A-Za-z]:\/[^"'\s]*\.cache\//,
  // Veryfront-specific cache directories (match anywhere in path)
  // Note: These patterns exclude paths with __VF_CACHE_DIR__ token (already portable)
  /file:\/\/(?!__VF_CACHE_DIR__)[^"'\s]*veryfront-http-bundle\//,
  /file:\/\/(?!__VF_CACHE_DIR__)[^"'\s]*veryfront-mdx-esm\//,
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
 * Aggressively tokenize ALL veryfront cache paths from ANY environment.
 * This handles code that may contain paths from different machines (e.g., build server vs prod).
 *
 * Strategy:
 * 1. First tokenize the current machine's cache dir (fast path)
 * 2. Then use regex to replace any remaining veryfront cache paths
 *
 * This is more expensive than tokenizeCachePaths but guarantees portability.
 */
export function tokenizeAllVeryFrontPaths(code: string): string {
  if (!code) return code;

  // First, do the fast tokenization for current environment
  let result = tokenizeAllCachePaths(code);

  // Pattern to match any absolute path to veryfront-http-bundle directory
  // Captures everything up to and including veryfront-http-bundle/
  // Example: file:///Users/foo/bar/.cache/veryfront-http-bundle/ -> file://__VF_CACHE_DIR__/veryfront-http-bundle/
  result = result.replace(
    /file:\/\/([^"'\s]*?)\/veryfront-http-bundle\//g,
    `file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/`,
  );

  // Pattern to match any absolute path to veryfront-mdx-esm directory
  result = result.replace(
    /file:\/\/([^"'\s]*?)\/veryfront-mdx-esm\//g,
    `file://${CACHE_DIR_TOKEN}/veryfront-mdx-esm/`,
  );

  return result;
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

export { CACHE_INVARIANT_VIOLATION };

/**
 * Assert that code is safe to store in distributed cache (portable).
 * @throws VeryfrontError (cache-invariant-violation) if code contains hardcoded paths
 */
export function assertPortableCode(code: string): void {
  if (hasHardcodedCachePaths(code)) {
    logger.error("Invariant violation: hardcoded paths in portable code");
    throw CACHE_INVARIANT_VIOLATION.create({
      detail:
        "[CACHE INVARIANT VIOLATION] Code contains hardcoded cache paths that should be tokenized before storage in distributed cache.",
    });
  }
}
