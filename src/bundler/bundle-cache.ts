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
const BUNDLE_VERSION = "3";

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
