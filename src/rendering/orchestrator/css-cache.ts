/**
 * CSS Cache Manager
 *
 * Manages per-page CSS caching to avoid redundant SSR for CSS generation.
 * Supports injection of CacheRepository for testing.
 *
 * @module rendering/orchestrator/css-cache
 */

import type { CacheRepository } from "#veryfront/repositories/types.ts";

/** Timeout for CSS generation SSR (shorter than full SSR since it's optional) */
export const CSS_SSR_TIMEOUT_MS = 5_000;

/**
 * Per-page CSS cache to avoid redundant SSR for CSS generation.
 * Key: projectId:environment:slug:contentVersion
 * Value: Generated CSS string
 */
const pageCssCache = new Map<string, string>();

/** Maximum number of entries in the CSS cache */
export const PAGE_CSS_CACHE_MAX_SIZE = 200;

/** Injected cache repository for testing */
let injectedCssCacheRepo: CacheRepository<string> | null = null;

/**
 * Inject a CacheRepository for CSS cache testing.
 * Call with null to restore default Map-based caching.
 */
export function __injectCssCacheForTests(cacheRepo: CacheRepository<string> | null): void {
  injectedCssCacheRepo = cacheRepo;
}

/** Create a cache key for page CSS */
export function getPageCssCacheKey(
  projectId: string | undefined,
  environment: string | undefined,
  slug: string,
  projectUpdatedAt: string | undefined,
): string {
  return `${projectId || "default"}:${environment || "preview"}:${slug}:${
    projectUpdatedAt || "draft"
  }`;
}

/** Cache CSS for a page - internal implementation */
function cachePageCssInternal(cacheKey: string, css: string): void {
  if (pageCssCache.size >= PAGE_CSS_CACHE_MAX_SIZE && !pageCssCache.has(cacheKey)) {
    const firstKey = pageCssCache.keys().next().value as string | undefined;
    if (firstKey) pageCssCache.delete(firstKey);
  }
  pageCssCache.set(cacheKey, css);
}

/** Get cached CSS for a page (if available) - sync for backward compatibility */
export function getCachedPageCss(cacheKey: string): string | undefined {
  // Note: Can't use injected repo synchronously, falls back to internal cache
  if (injectedCssCacheRepo) return undefined;
  return pageCssCache.get(cacheKey);
}

/** Cache CSS for a page - async to support injected repo */
async function cachePageCssAsync(cacheKey: string, css: string): Promise<void> {
  if (injectedCssCacheRepo) {
    await injectedCssCacheRepo.set(cacheKey, css);
    return;
  }
  cachePageCssInternal(cacheKey, css);
}

/** Cache CSS for a page - sync for backward compatibility */
export function cachePageCss(cacheKey: string, css: string): void {
  // Fire-and-forget if using injected repo
  if (injectedCssCacheRepo) {
    void cachePageCssAsync(cacheKey, css);
    return;
  }
  cachePageCssInternal(cacheKey, css);
}
