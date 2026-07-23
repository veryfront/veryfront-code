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
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { encodeCacheSourceIdentity } from "../source-identity.ts";

export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
  /**
   * Release asset manifest version currently being consumed for this render.
   * When set (a ready manifest is in use), it is folded into the prefix so
   * manifest-rewritten HTML is cached separately from JIT HTML. Omitted when
   * no manifest is consumed — preserving today's cache keys byte-for-byte.
   */
  manifestVersion?: number,
): string {
  if (!projectId) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Missing projectId for render cache prefix",
    });
  }
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedReleaseKey = encodeCacheSourceIdentity(
    environment === "production"
      ? { type: "release", releaseId: releaseKey }
      : { type: "branch", branch: releaseKey },
  ).qualifier;
  const base = `${encodedProjectId}:${environment}:${encodedReleaseKey}:${VERSION}`;
  return manifestVersion === undefined ? base : `${base}:m${manifestVersion}`;
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
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Missing releaseId for production contentSourceId",
      });
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
  environmentName?: string | null,
): string {
  const mode = productionMode ? "production" : "preview";

  if (productionMode) {
    if (!releaseId) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `Missing releaseId in production for ${projectSlug}`,
      });
    }
    const source = environmentName
      ? encodeCacheSourceIdentity({ type: "environment", environmentName, releaseId })
      : encodeCacheSourceIdentity({ type: "release", releaseId });
    return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${source.key}`;
  }

  const source = encodeCacheSourceIdentity({ type: "branch", branch: branch ?? "main" });
  return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${source.qualifier}`;
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
  const normalizedSlug = slug || "index";
  if (!url) return normalizedSlug;

  const queryPart = sanitizeQueryParamsForCacheKey(url, options);
  return queryPart ? `${normalizedSlug}:q:${queryPart}` : normalizedSlug;
}
