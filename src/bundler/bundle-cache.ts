/**
 * Bundle Cache Storage Layer
 *
 * Interfaces with the veryfront-api project cache endpoints for storing
 * and retrieving production bundles. Uses content hash as cache key for
 * automatic invalidation when project content changes.
 *
 * @module bundler/bundle-cache
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { MEMORY_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";

export interface BundleCacheEntry {
  /** Bundled code */
  code: string;
  /** Content hash used to generate this bundle */
  contentHash: string;
  /** Bundle creation timestamp */
  createdAt: string;
  /** Bundle version for compatibility checks */
  bundleVersion: string;
  /** Metafile for debugging/analysis */
  metafile?: Record<string, unknown>;
}

export interface BundleCacheConfig {
  /** veryfront-api base URL */
  apiBaseUrl?: string;
  /** API token for authentication */
  apiToken?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Enable local memory cache for frequently accessed bundles */
  enableLocalCache?: boolean;
  /** Max entries in local cache */
  localMaxEntries?: number;
}

// Current bundle format version - increment when format changes
// v3: React externalized via esm.sh; bare imports bundled for single React instance
// v4: Bare imports external by default to avoid SSR issues with browser-only modules
// v5: Third-party esm.sh URLs include deps=react@version to pin React version (fix "two Reacts")
// v6: Memory cache key includes bundle version and React version for proper invalidation
// v7: Bundle third-party packages (not external) and redirect their React imports to our version
// v8: Fix collectProjectFiles to use getAllSourceFiles for virtual filesystems (API-backed projects)
//     and set effectiveProjectDir="/" for proxy mode to fix "two Reacts" problem
// v9: Fix esm.sh URLs in user files that are missing deps=/external= params
//     These direct esm.sh imports bypass bare import handling, causing React version mismatch
// v10: Keep external but add deps= params to fix React version without bundling (avoid timeout)
// v11: Remove deps=csstype from React URLs to match what external packages expect
//      External packages with external=react use React without deps=csstype, creating different modules
// v12: Fix React subpaths (jsx-runtime) to NOT use external=react
//      jsx-runtime is PART of React, using external=react caused it to load a separate React instance
// v13: Use esm.sh direct path format for React core (/react@ver/es2022/react.mjs)
//      Query param URLs (?target=es2022) differ from internal paths used by external packages
// v14: Use esm.sh alias param to redirect bare "react" imports to pinned version
//      Without alias, bare "react" resolves to esm.sh/react (latest=19.2.4), not our 19.1.1
// v15: Use esm.sh internal React URL format with deps=csstype@3.2.3 build key
//      esm.sh packages internally resolve React to X-ZGNzc3R5cGVAMy4yLjM (deps=csstype@3.2.3)
// v16: Add alias param to ALL external package URLs (not just react-dom)
//      Ensures @tanstack/react-query and other packages resolve bare "react" to our exact URL
// v17-18: Various React URL format experiments
// v19: Fix MDX plugin to NEVER use adapter.fs during esbuild plugin callbacks
//      AsyncLocalStorage context is lost in esbuild's native code execution,
//      causing "No request context available" errors. All MDX files must be pre-loaded.
// v20: Use esm.sh direct path format for React URLs (no query params, no build keys)
//      /react@ver/es2022/react.mjs instead of /react@ver?target=es2022&deps=csstype
//      This matches esm.sh internal resolution and ensures single React instance
// v21: Use esm.sh alias parameter to redirect bare "react" imports in third-party packages
//      alias=react:https://esm.sh/react@19.1.1/es2022/react.mjs ensures all packages
//      resolve to the same React instance, fixing "two Reacts" problem at runtime
// v22: Bundle third-party packages instead of externalizing to fix "two Reacts" at runtime
//      When packages are external, esm.sh serves them with bare "react" imports that
//      resolve to the latest React. Bundling ensures all React imports go through our handler.
// v23: Remove external=react,react-dom from esm.sh URLs to fix "two Reacts" at runtime.
//      The external= param causes esm.sh to output bare "import 'react'" which Deno resolves
//      to the latest React at runtime (e.g., 19.2.4), not our pinned version (19.1.1).
//      Using deps= only, esm.sh resolves React internally to /v135/react@19.1.1/es2022/react.mjs
//      which ensures all packages use the same React instance.
// v24: Remove deps=csstype@3.2.3 from React URLs to match third-party package imports.
// v25: Use deps=react@19.1.1 instead of external=react for react-dom URLs.
// v26: Use DIRECT PATH format for ALL React URLs to fix Deno module caching issue.
//      Deno caches modules by their FETCH URL, not internal esm.sh path. So:
//        https://esm.sh/react@19.1.1?target=es2022  ← one cache entry
//        https://esm.sh/react@19.1.1/es2022/react.mjs  ← different cache entry!
//      Third-party packages import React via direct path (no query params).
//      Now ALL React URLs use direct path format to hit the same Deno cache entry.
// v27: Fix all remaining external=react,react-dom usages to deps=react@version,react-dom@version.
//      The external= param causes esm.sh to emit bare "import 'react'" which resolves to latest
//      React at runtime. Using deps= makes esm.sh embed pinned version URLs internally.
//      Fixed: addEsmShDeps(), bare-strategy.ts, markdown.tsx hardcoded URL.
// v28: Fix isReactCore regex to not match "react-hook-form" when checking for React packages.
//      The old check `/react`.startsWith() matched react-hook-form, skipping deps addition.
// v29: Use relative paths for bundle keys (layout paths, page paths) so they match between
//      LayoutCollector and the bundle. Previously filesystem adapter used absolute paths.
// v30: Bundle App component (components/app.tsx) and apply as outermost wrapper during SSR.
//      This enables providers like QueryClientProvider to wrap all components including layouts.
// v31: Use ./ prefix for local file imports (pages, layouts, app) in virtual entry code.
//      Bare paths like "components/app.tsx" were being treated as npm packages by the
//      bare import plugin and rewritten to esm.sh URLs. The ./ prefix ensures they're
//      recognized as relative imports and resolved from the project's virtual filesystem.
// v32: Fix virtual FS and MDX plugins to try relative path keys when resolving imports.
//      When ./components/app.tsx resolves to ${projectDir}/components/app.tsx, the map
//      may have keys like "components/app.tsx" (relative). Now we try both formats.
// v33: Fix the early virtual namespace handler (for paths starting with ".") to also
//      try relative path keys. This handler runs before the generic relative path handler.
// v34: Add debug logging and direct key lookup for relative path resolution.
// v35: Add fallback handler for relative paths when namespace isn't "virtual".
// v36: Fix resolveRelativePath to handle root projectDir "/" correctly.
//      When projectDir="/" normalized to "", all paths "start with" empty string,
//      causing off-by-one slice that stripped the first character from paths.
export const BUNDLE_VERSION = "36";

/**
 * Bundle cache for storing and retrieving production bundles.
 *
 * Uses a two-tier caching strategy:
 * 1. Local memory cache (L1) - Fast access for frequently requested bundles
 * 2. API cache (L2) - Distributed storage via veryfront-api
 */
export class BundleCache {
  private apiBaseUrl: string;
  private timeoutMs: number;
  private circuitBreaker;
  private localCache: MemoryCacheBackend | null;
  private getToken: () => string | null;

  constructor(config: BundleCacheConfig = {}) {
    this.apiBaseUrl = config.apiBaseUrl ?? this.getDefaultApiUrl();
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.circuitBreaker = getCircuitBreaker("bundle-cache", {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      successThreshold: 2,
    });

    // Initialize local cache if enabled
    this.localCache = config.enableLocalCache !== false
      ? new MemoryCacheBackend(config.localMaxEntries ?? MEMORY_CACHE_MAX_ENTRIES)
      : null;

    // Token resolver - can be overridden for testing
    const staticToken = config.apiToken;
    this.getToken = () => staticToken ?? this.getTokenFromEnv();
  }

  private getDefaultApiUrl(): string {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    return (
      g.Deno?.env?.get("VERYFRONT_API_BASE_URL") ??
        g.process?.env?.VERYFRONT_API_BASE_URL ??
        "https://api.veryfront.com"
    );
  }

  private getTokenFromEnv(): string | null {
    // deno-lint-ignore no-explicit-any
    const g = globalThis as any;
    return g.Deno?.env?.get("VERYFRONT_API_TOKEN") ?? g.process?.env?.VERYFRONT_API_TOKEN ?? null;
  }

  /**
   * Generate cache key for a bundle
   */
  private getBundleKey(_projectId: string, contentHash: string): string {
    return `bundle:v${BUNDLE_VERSION}:${contentHash}`;
  }

  /**
   * Get a cached bundle if it exists
   */
  async get(projectId: string, contentHash: string): Promise<BundleCacheEntry | null> {
    const cacheKey = this.getBundleKey(projectId, contentHash);

    return withSpan(
      SpanNames.CACHE_BUNDLE_GET,
      async (span?: Span) => {
        span?.setAttributes({
          "cache.key": cacheKey,
          "project.id": projectId,
          "content.hash": contentHash,
        });

        // Try local cache first
        if (this.localCache) {
          const localValue = await this.localCache.get(cacheKey);
          if (localValue) {
            span?.setAttribute("cache.hit.tier", "local");
            try {
              return JSON.parse(localValue) as BundleCacheEntry;
            } catch {
              // Invalid local cache entry, continue to API
              await this.localCache.del(cacheKey);
            }
          }
        }

        // Try API cache
        const apiValue = await this.getFromApi(projectId, cacheKey);
        if (apiValue) {
          span?.setAttribute("cache.hit.tier", "api");

          // Populate local cache
          if (this.localCache) {
            await this.localCache.set(cacheKey, JSON.stringify(apiValue), 3600);
          }

          return apiValue;
        }

        span?.setAttribute("cache.hit", false);
        return null;
      },
      { "cache.operation": "bundle.get" },
    );
  }

  /**
   * Store a bundle in cache
   */
  async set(
    projectId: string,
    contentHash: string,
    entry: Omit<BundleCacheEntry, "bundleVersion" | "createdAt">,
  ): Promise<void> {
    const cacheKey = this.getBundleKey(projectId, contentHash);

    const fullEntry: BundleCacheEntry = {
      ...entry,
      bundleVersion: BUNDLE_VERSION,
      createdAt: new Date().toISOString(),
    };

    return withSpan(
      SpanNames.CACHE_BUNDLE_SET,
      async (span?: Span) => {
        span?.setAttributes({
          "cache.key": cacheKey,
          "project.id": projectId,
          "content.hash": contentHash,
          "bundle.size": entry.code.length,
        });

        // Store in local cache
        if (this.localCache) {
          await this.localCache.set(cacheKey, JSON.stringify(fullEntry), 3600);
        }

        // Store in API cache
        await this.setToApi(projectId, cacheKey, fullEntry);
      },
      { "cache.operation": "bundle.set" },
    );
  }

  /**
   * Delete a cached bundle
   */
  async delete(projectId: string, contentHash: string): Promise<void> {
    const cacheKey = this.getBundleKey(projectId, contentHash);

    // Delete from local cache
    if (this.localCache) {
      await this.localCache.del(cacheKey);
    }

    // Delete from API cache
    await this.deleteFromApi(projectId, cacheKey);
  }

  /**
   * Invalidate all bundles for a project
   */
  async invalidateProject(projectId: string): Promise<void> {
    // Clear local cache entries for this project
    if (this.localCache) {
      await this.localCache.delByPattern(`bundle:*`);
    }

    // Invalidate via API
    await this.invalidateProjectViaApi(projectId);
  }

  // API methods

  private async getFromApi(projectId: string, cacheKey: string): Promise<BundleCacheEntry | null> {
    const token = this.getToken();
    if (!token) {
      logger.debug("[BundleCache] No API token available");
      return null;
    }

    try {
      return await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectId}/cache/get?key=${
          encodeURIComponent(cacheKey)
        }`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            // Consume the response body to prevent resource leaks
            await response.body?.cancel();
            if (response.status === 404) return null;
            throw new Error(`HTTP ${response.status}`);
          }

          const data = (await response.json()) as { value: string | null };
          if (!data.value) return null;

          return JSON.parse(data.value) as BundleCacheEntry;
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.debug("[BundleCache] Circuit breaker open, skipping API get");
        return null;
      }
      logger.debug("[BundleCache] API get failed", { error: String(error) });
      return null;
    }
  }

  private async setToApi(
    projectId: string,
    cacheKey: string,
    entry: BundleCacheEntry,
  ): Promise<void> {
    const token = this.getToken();
    if (!token) {
      logger.debug("[BundleCache] No API token available for set");
      return;
    }

    try {
      await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectId}/cache/set`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              key: cacheKey,
              value: JSON.stringify(entry),
              ttl: 86400 * 7, // 7 days TTL for bundles
            }),
            signal: controller.signal,
          });

          // Consume the response body to prevent resource leaks
          await response.body?.cancel();

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof CircuitBreakerOpen) {
        logger.debug("[BundleCache] Circuit breaker open, skipping API set");
        return;
      }
      logger.debug("[BundleCache] API set failed", { error: String(error) });
    }
  }

  private async deleteFromApi(projectId: string, cacheKey: string): Promise<void> {
    const token = this.getToken();
    if (!token) return;

    try {
      await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectId}/cache/del`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ key: cacheKey }),
            signal: controller.signal,
          });
          // Consume the response body to prevent resource leaks
          await res.body?.cancel();
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch {
      // Ignore delete failures
    }
  }

  private async invalidateProjectViaApi(projectId: string): Promise<void> {
    const token = this.getToken();
    if (!token) return;

    try {
      await this.circuitBreaker.execute(async () => {
        const url = `${this.apiBaseUrl}/projects/${projectId}/cache/del-pattern`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ pattern: `bundle:*` }),
            signal: controller.signal,
          });
          // Consume the response body to prevent resource leaks
          await res.body?.cancel();
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch {
      // Ignore invalidation failures
    }
  }

  /**
   * Clear all local cache entries
   */
  clearLocalCache(): void {
    this.localCache?.clear();
  }
}

// Singleton instance
let bundleCacheInstance: BundleCache | null = null;

/**
 * Get or create the bundle cache singleton
 */
export function getBundleCache(config?: BundleCacheConfig): BundleCache {
  if (!bundleCacheInstance) {
    bundleCacheInstance = new BundleCache(config);
  }
  return bundleCacheInstance;
}

/**
 * Reset the bundle cache singleton (for testing)
 */
export function resetBundleCache(): void {
  bundleCacheInstance?.clearLocalCache();
  bundleCacheInstance = null;
}

/**
 * Compute a content hash for project files
 */
export async function computeProjectContentHash(
  projectFiles: Map<string, string>,
): Promise<string> {
  // Sort files for deterministic hash
  const sortedEntries = [...projectFiles.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Create content string
  const content = sortedEntries.map(([path, code]) => `${path}:${code}`).join("\n");

  // Compute SHA-256 hash
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
