/********************************************************************************
 * Render/Layout/Component Cache Key Builders
 *
 * Cache key builders for render caching, layout components, error pages,
 * proxy manager, and query-aware cache keys.
 *
 * @module core/cache/keys/builders/render
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { CacheKeyPrefix } from "../prefixes.ts";
import type { QueryParamCacheOptions } from "../prefixes.ts";
import { sanitizeQueryParamsForCacheKey } from "../utils.ts";

export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
): string {
  return `${projectId}:${environment}:${releaseKey}:${VERSION}`;
}

/**
 * Compute content source identifier for cache isolation.
 *
 * This is the SINGLE SOURCE OF TRUTH for contentSourceId computation.
 * Used by proxy to compute the value, and by fallback paths when proxy header is unavailable.
 *
 * @param isLocal - Whether this is a local development project
 * @param environment - "preview" or "production"
 * @param branch - Branch name (for preview/local modes)
 * @param releaseId - Release ID (required for production, ignored for preview/local)
 * @returns Content source ID string:
 *   - Local: "local-{branch}"
 *   - Preview: "preview-{branch}"
 *   - Production: "release-{releaseId}"
 */
export function computeContentSourceId(
  isLocal: boolean,
  environment: "preview" | "production",
  branch: string | null | undefined,
  releaseId: string | null | undefined,
): string {
  if (isLocal) return `local-${branch ?? "main"}`;

  if (environment === "production") {
    if (!releaseId) {
      throw new Error("Missing releaseId for production contentSourceId");
    }
    return `release-${releaseId}`;
  }

  return `preview-${branch ?? "main"}`;
}

export function buildRenderCacheKey(cachePrefix: string, contentKey: string): string {
  return `${cachePrefix}:${contentKey}`;
}

export function buildComponentCacheKey(
  projectId: string,
  filePath: string,
  contentHash: string,
): string {
  return `${CacheKeyPrefix.COMPONENT}:${projectId}:${filePath}:${contentHash}`;
}

export function buildLayoutComponentCacheKey(
  projectId: string,
  componentPath: string,
  hash: string,
  contentSourceId: string,
): string {
  return `${CacheKeyPrefix.LAYOUT}:${projectId}:${contentSourceId}:${componentPath}:${hash}`;
}

export function buildErrorPageCacheKey(
  projectId: string | undefined,
  projectDir: string,
  pageType: string,
): string {
  return `${CacheKeyPrefix.ERROR_PAGE}:${projectId ?? projectDir}:${pageType}`;
}

export function buildProxyManagerCacheKey(
  projectSlug: string,
  productionMode: boolean,
  releaseId: string | null,
  branch: string | null,
): string {
  const mode = productionMode ? "production" : "preview";

  if (productionMode) {
    if (!releaseId) {
      throw new Error(`Missing releaseId in production for ${projectSlug}`);
    }
    return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${releaseId}`;
  }

  return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${branch ?? "main"}`;
}

/**
 * Build a query-aware cache key that is safe for multi-tenant caching.
 *
 * @param slug - Base page slug
 * @param url - Optional URL with query params
 * @param options - Query param handling options
 * @returns Cache key string
 */
export function buildQueryAwareCacheKey(
  slug: string,
  url?: URL,
  options?: QueryParamCacheOptions,
): string {
  if (!url) return slug;

  const queryPart = sanitizeQueryParamsForCacheKey(url, options);
  return queryPart ? `${slug}:q:${queryPart}` : slug;
}
