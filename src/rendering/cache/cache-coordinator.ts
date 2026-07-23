import { rendererLogger as logger } from "#veryfront/utils";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "./types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "./stores/index.ts";
import { markRequestProfilePhase, metrics } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { cloneCachePayload, parseCachePayload } from "./cache-payload.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

/** Default TTL for cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;

function validateDurations(ttlMs: number, staleMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || ttlMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Cache coordinator ttlMs must be between 0 and ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  if (!Number.isFinite(staleMs) || staleMs < 0 || staleMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Cache coordinator staleMs must be between 0 and ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  if (ttlMs + staleMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Cache coordinator ttlMs + staleMs must not exceed ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
}

export interface CacheCoordinatorOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
  staleMs?: number;
  /**
   * Project identifier for cache key prefixing.
   * Required for multi-tenant isolation - all cache keys will be prefixed with this value.
   *
   * This should be a unique identifier per project:
   * - In production: The project UUID from the database
   * - In local dev: A hash generated from the projectDir (e.g., "proj_abc123")
   *
   * Note: This is NOT the human-readable projectSlug (like "minimal-app-router").
   * Use the unique ID to ensure cache isolation even if slugs are reused.
   */
  projectId?: string;
  /**
   * Content source identifier for cache isolation (e.g., "main", "release-123").
   * Ensures different branches/releases have separate cache entries.
   */
  contentSourceId?: string;
}

export type CacheLookupStatus = "hit" | "miss" | "stale" | "expired";

export interface CacheLookupResult {
  cachedResult?: RenderResult;
  depAwareSlug: string;
  moduleCacheKey: string;
  cachedModule?: RenderResult["pageModule"];
  cacheStatus: CacheLookupStatus;
  lookupDurationMs: number;
}

export class CacheCoordinator {
  private store: CacheStore;
  private ttlMs: number;
  private staleMs: number;
  private readonly defaultTtlMs = DEFAULT_CACHE_TTL_MS;
  private readonly projectId: string | undefined;
  private readonly contentSourceId: string | undefined;
  private readonly projectPrefix: string;
  private readonly cachePrefix: string;

  constructor(options: CacheCoordinatorOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.staleMs = options.staleMs ?? 0;
    validateDurations(this.ttlMs, this.staleMs);
    if (
      options.projectId !== undefined &&
      (options.projectId.trim().length === 0 || options.projectId.trim() !== options.projectId)
    ) {
      throw new TypeError("Cache coordinator projectId must be a non-blank trimmed string");
    }
    if (
      options.contentSourceId !== undefined &&
      (options.contentSourceId.trim().length === 0 ||
        options.contentSourceId.trim() !== options.contentSourceId)
    ) {
      throw new TypeError("Cache coordinator contentSourceId must be a non-blank trimmed string");
    }
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;

    // Missing identity gets a coordinator-local namespace: safe isolation is
    // more important than cross-instance reuse when callers omit tenancy.
    const cacheProjectId = this.projectId ?? `anonymous-${crypto.randomUUID()}`;
    this.projectPrefix = `${encodeURIComponent(cacheProjectId)}:`;
    this.cachePrefix = this.projectPrefix +
      `${encodeURIComponent(this.contentSourceId ?? "draft")}:`;

    if (!this.projectId) {
      logger.warn(
        "[CacheCoordinator] No projectId provided; using an ephemeral isolated namespace. " +
          "Distributed cache reuse is disabled across coordinator instances.",
      );
    }

    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
        enforceStoreTtl: false,
      });
  }

  /**
   * Build a fully-qualified cache key with project prefix.
   * @param slug - The base slug or cache key
   * @param cacheKey - Optional explicit cache key (still gets prefixed)
   */
  private buildCacheKey(slug: string, cacheKey?: string): string {
    const baseKey = cacheKey ?? slug;
    return `${this.cachePrefix}${baseKey}`;
  }

  checkCache(slug: string, cacheKey?: string): Promise<CacheLookupResult> {
    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.checkCache",
      async () => {
        const lookupStart = performance.now();
        const stored = await this.store.get(key);
        const cached = stored === undefined ? undefined : parseCachePayload(stored);

        if (stored !== undefined && cached === undefined) {
          await this.store.delete(key);
        }

        if (!cached) {
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          return { depAwareSlug: slug, moduleCacheKey: key, cacheStatus: "miss", lookupDurationMs };
        }

        if (this.isExpired(cached)) {
          if (this.isStaleUsable(cached)) {
            const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
            recordCacheLookup("stale", lookupDurationMs);
            return {
              cachedResult: this.hydrateResult(cached),
              depAwareSlug: slug,
              moduleCacheKey: key,
              cachedModule: cached.result.pageModule,
              cacheStatus: "stale",
              lookupDurationMs,
            };
          }

          await this.store.delete(key);
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("expired", lookupDurationMs);
          return {
            depAwareSlug: slug,
            moduleCacheKey: key,
            cacheStatus: "expired",
            lookupDurationMs,
          };
        }

        const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
        recordCacheLookup("hit", lookupDurationMs);
        return {
          cachedResult: this.hydrateResult(cached),
          depAwareSlug: slug,
          moduleCacheKey: key,
          cachedModule: cached.result.pageModule,
          cacheStatus: "hit",
          lookupDurationMs,
        };
      },
      { "cache.slug": slug, "cache.key": key, "cache.projectId": this.projectId ?? "unknown" },
    );
  }

  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void> {
    if (result.stream) return Promise.resolve();

    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.persistResult",
      async () => {
        const now = Date.now();
        const payload: CachePayload = {
          result: {
            html: result.html,
            css: result.css,
            frontmatter: result.frontmatter,
            headings: result.headings,
            nodeMap: result.nodeMap ? new Map(result.nodeMap) : undefined,
            stream: null,
            ssrHash: result.ssrHash,
            pageModule: result.pageModule,
          },
          nodeMapEntries: result.nodeMap ? Array.from(result.nodeMap.entries()) : undefined,
          storedAt: now,
          expiresAt: now + this.ttlMs,
          staleUntil: this.staleMs > 0 ? now + this.ttlMs + this.staleMs : undefined,
        };

        await this.store.set(key, cloneCachePayload(payload));
      },
      { "cache.slug": slug, "cache.key": key, "cache.projectId": this.projectId ?? "unknown" },
    );
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async clearSlug(slug: string): Promise<void> {
    const prefixedSlug = this.buildCacheKey(slug);

    if (this.store.deleteByPrefix) {
      await this.store.delete(prefixedSlug);
      await this.store.deleteByPrefix(`${prefixedSlug}:`);
    } else {
      await this.store.delete(prefixedSlug);
    }
  }

  /**
   * Clear all cache entries for the current project.
   * Only clears entries with the current project prefix.
   */
  async clearForProject(): Promise<void> {
    if (!this.projectId) {
      throw new TypeError("Project cache invalidation requires a projectId");
    }
    if (!this.store.deleteByPrefix) {
      throw new TypeError("Cache store does not support project-scoped invalidation");
    }

    await this.store.deleteByPrefix(this.projectPrefix);
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() >= entry.expiresAt;
  }

  private isStaleUsable(entry: CachePayload): boolean {
    return typeof entry.staleUntil === "number" && Date.now() <= entry.staleUntil;
  }

  private hydrateResult(entry: CachePayload): RenderResult {
    let nodeMap: Map<number, unknown> | undefined;
    if (entry.nodeMapEntries) {
      nodeMap = new Map<number, unknown>(entry.nodeMapEntries);
    } else if (entry.result.nodeMap instanceof Map) {
      nodeMap = entry.result.nodeMap;
    } else if (entry.result.nodeMap && typeof entry.result.nodeMap === "object") {
      nodeMap = new Map<number, unknown>(
        Object.entries(entry.result.nodeMap).map(([k, v]) => [Number(k), v]),
      );
    }

    return {
      ...entry.result,
      nodeMap,
      stream: null,
    };
  }
}

function roundDurationMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function recordCacheLookup(status: CacheLookupStatus, durationMs: number): void {
  markRequestProfilePhase("render.cache_lookup", durationMs);
  markRequestProfilePhase(`render.cache_${status}`);
  metrics.recordCacheGet(status === "hit" || status === "stale");
}
