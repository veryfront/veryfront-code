/**
 * CSS Cache Manager
 *
 * Manages per-page CSS caching to avoid redundant SSR for CSS generation.
 *
 * @module rendering/orchestrator/css-cache
 */

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Timeout for CSS generation SSR (shorter than full SSR since it's optional) */
export const CSS_SSR_TIMEOUT_MS = 5_000;

/** Maximum number of entries in the CSS cache */
export const PAGE_CSS_CACHE_MAX_SIZE = 200;

/**
 * Per-page CSS cache to avoid redundant SSR for CSS generation.
 * Key: versioned JSON tuple of projectId, environment, slug, and contentVersion
 * Value: Generated CSS string
 * Uses LRU eviction so frequently-used pages' CSS is retained under cache pressure.
 */
const pageCssCache = new LRUCache<string, string>({
  maxEntries: PAGE_CSS_CACHE_MAX_SIZE,
  // The previous plain-Map cache was bounded by entry count only. Disable the
  // adapter's default 50 MiB byte cap so large CSS payloads aren't evicted
  // (or rejected) on insert; only the entry-count bound applies.
  maxSizeBytes: Number.MAX_SAFE_INTEGER,
});

// Register cache for monitoring
registerLRUCache("page-css-cache", pageCssCache);

/** Exposed for testing only — do not use in production code */
export const __pageCssCacheForTests = pageCssCache;

/** Create a cache key for page CSS */
export function getPageCssCacheKey(
  projectId: string,
  environment: string | undefined,
  slug: string,
  projectUpdatedAt: string | undefined,
): string {
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Page CSS cache key requires project identity",
    });
  }

  return `veryfront:page-css:v1:${
    JSON.stringify([
      projectId,
      environment ?? null,
      slug,
      projectUpdatedAt ?? null,
    ])
  }`;
}

/** Get cached CSS for a page, if available. */
export function getCachedPageCss(cacheKey: string): string | undefined {
  return pageCssCache.get(cacheKey);
}

/** Cache CSS for a page in the bounded process-local LRU. */
export function cachePageCss(cacheKey: string, css: string): void {
  pageCssCache.set(cacheKey, css);
}
