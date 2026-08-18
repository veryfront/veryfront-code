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
import { buildDependencyPinningCacheVariant } from "../dependency-pinning.ts";
import { encodeCacheKeyLiteralSegment } from "../segment-codec.ts";
import { RENDER_COMPILE_MODE_SEGMENTS, type RenderCompileMode } from "../render-compile-mode.ts";

export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
  /**
   * Compile mode of the render this prefix caches. It is required because
   * `environment` does not imply it: a local development server and a hosted
   * preview server share `preview`, the same branch and the same release key,
   * yet compile with different modes. The cached render carries a hydration
   * bundle and a page module, so without this segment a development-compiled
   * bundle can be served to a production-mode render.
   */
  compileMode: RenderCompileMode,
  /**
   * Release asset manifest version currently being consumed for this render.
   * When set (a ready manifest is in use), it is folded into the prefix so
   * manifest-rewritten HTML is cached separately from JIT HTML.
   */
  manifestVersion?: number,
): string {
  const base = `${projectId}:${environment}:${releaseKey}:${VERSION}:${
    RENDER_COMPILE_MODE_SEGMENTS[compileMode]
  }`;
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
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  const legacyCacheKey = `${CacheKeyPrefix.COMPONENT}:${projectId}:${filePath}:${contentHash}`;
  const cacheVariant = buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
  return cacheVariant ? `${legacyCacheKey}:pins:${cacheVariant}` : legacyCacheKey;
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
  authority?: {
    projectId: string | null;
    credentialPrincipal: string;
  },
): string {
  const mode = productionMode ? "production" : "preview";
  if (authority && !authority.credentialPrincipal) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `Missing credential principal for proxy adapter ${projectSlug}`,
    });
  }
  const authorityKey = authority
    ? `:project:${encodeCacheKeyLiteralSegment(authority.projectId ?? "")}` +
      `:credential:${encodeCacheKeyLiteralSegment(authority.credentialPrincipal)}`
    : "";

  if (productionMode) {
    if (!releaseId) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: `Missing releaseId in production for ${projectSlug}`,
      });
    }
    const source = environmentName
      ? encodeCacheSourceIdentity({ type: "environment", environmentName, releaseId })
      : encodeCacheSourceIdentity({ type: "release", releaseId });
    return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${source.key}${authorityKey}`;
  }

  const source = encodeCacheSourceIdentity({ type: "branch", branch: branch ?? "main" });
  // ProxyFSAdapterManager asserts environmentName matches on reuse, so it must
  // be part of the key. Omitted when unnamed to keep existing keys stable.
  const environmentQualifier = environmentName
    ? `:env:${encodeCacheKeyLiteralSegment(environmentName)}`
    : "";
  return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${source.qualifier}${environmentQualifier}${authorityKey}`;
}

/**
 * Build a query-aware key that preserves query semantics for multi-tenant
 * caching. The result can contain internal `*HH` byte escapes; ApiCacheBackend
 * maps completed concrete keys to the API cache schema at its boundary.
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
