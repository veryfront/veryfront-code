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
import { encodeCacheIdentitySegment, encodeCacheSourceIdentity } from "../source-identity.ts";

const MAX_QUERY_AWARE_CACHE_KEY_LENGTH = 4096;

function encodeQueryAwareSlug(slug: string): string {
  encodeCacheIdentitySegment(slug, "slug");
  if (!slug.includes(":q:") && !slug.includes("%")) return slug;
  return slug.replaceAll("%", "%25").replaceAll(":", "%3A");
}

function assertQueryAwareCacheKeyLength(key: string): string {
  if (key.length > MAX_QUERY_AWARE_CACHE_KEY_LENGTH) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Query-aware cache key exceeds the supported size",
    });
  }
  return key;
}

function encodeRenderContentKey(contentKey: string): string {
  encodeCacheIdentitySegment(contentKey, "contentKey");
  if (!/^m\d+:/.test(contentKey) && !contentKey.includes("%")) return contentKey;
  return contentKey.replaceAll("%", "%25").replaceAll(":", "%3A");
}

export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
  /**
   * Release asset manifest version currently being consumed for this render.
   * When set (a ready manifest is in use), it is folded into the prefix so
   * manifest-rewritten HTML is cached separately from JIT HTML. Omitted when
   * no manifest is consumed, preserving today's cache keys byte for byte.
   */
  manifestVersion?: number,
): string {
  if (
    manifestVersion !== undefined &&
    (!Number.isSafeInteger(manifestVersion) || manifestVersion < 0)
  ) {
    throw CACHE_INVARIANT_VIOLATION.create({ detail: "Invalid render manifest version" });
  }
  const encodedProjectId = encodeCacheIdentitySegment(projectId, "projectId");
  const encodedReleaseKey = encodeCacheIdentitySegment(releaseKey, "releaseKey");
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
  return `${cachePrefix}:${encodeRenderContentKey(contentKey)}`;
}

/** Build a project-isolated compiled component cache key. */
export function buildComponentCacheKey(
  projectId: string,
  filePath: string,
  contentHash: string,
): string {
  const encodedProjectId = encodeCacheIdentitySegment(projectId, "projectId");
  const encodedFilePath = encodeCacheIdentitySegment(filePath, "filePath");
  const encodedContentHash = encodeCacheIdentitySegment(contentHash, "contentHash");
  return `${CacheKeyPrefix.COMPONENT}:${encodedProjectId}:${encodedFilePath}:${encodedContentHash}`;
}

export function buildLayoutComponentCacheKey(
  projectId: string,
  componentPath: string,
  hash: string,
  contentSourceId: string,
): string {
  const encodedProjectId = encodeCacheIdentitySegment(projectId, "projectId");
  const encodedContentSourceId = encodeCacheIdentitySegment(
    contentSourceId,
    "contentSourceId",
  );
  const encodedComponentPath = encodeCacheIdentitySegment(componentPath, "componentPath");
  const encodedHash = encodeCacheIdentitySegment(hash, "hash");
  return `${CacheKeyPrefix.LAYOUT}:${encodedProjectId}:${encodedContentSourceId}:${encodedComponentPath}:${encodedHash}`;
}

/** Build a project-isolated rendered error-page cache key. */
export function buildErrorPageCacheKey(
  projectId: string | undefined,
  projectDir: string,
  pageType: string,
): string {
  const encodedProjectIdentity = encodeCacheIdentitySegment(
    projectId ?? projectDir,
    "project identity",
  );
  const encodedPageType = encodeCacheIdentitySegment(pageType, "pageType");
  return `${CacheKeyPrefix.ERROR_PAGE}:${encodedProjectIdentity}:${encodedPageType}`;
}

/** Build a source-isolated proxy manager cache key. */
export function buildProxyManagerCacheKey(
  projectSlug: string,
  productionMode: boolean,
  releaseId: string | null,
  branch: string | null,
  environmentName?: string | null,
): string {
  const mode = productionMode ? "production" : "preview";
  const encodedProjectSlug = encodeCacheIdentitySegment(projectSlug, "projectSlug");

  if (productionMode) {
    if (!releaseId) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Missing releaseId for production proxy cache identity",
      });
    }
    const source = environmentName
      ? encodeCacheSourceIdentity({ type: "environment", environmentName, releaseId })
      : encodeCacheSourceIdentity({ type: "release", releaseId });
    return `${CacheKeyPrefix.PROXY}:${encodedProjectSlug}:${mode}:${source.key}`;
  }

  const source = encodeCacheSourceIdentity({ type: "branch", branch: branch ?? "main" });
  return `${CacheKeyPrefix.PROXY}:${encodedProjectSlug}:${mode}:${source.qualifier}`;
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
  const normalizedSlug = encodeQueryAwareSlug(slug || "index");
  if (!url) return assertQueryAwareCacheKeyLength(normalizedSlug);

  const queryPart = sanitizeQueryParamsForCacheKey(url, options);
  const key = queryPart ? `${normalizedSlug}:q:${queryPart}` : normalizedSlug;
  return assertQueryAwareCacheKeyLength(key);
}
