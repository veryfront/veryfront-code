import { rendererLogger } from "#veryfront/utils";
import { markRequestProfilePhase, metrics, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "../cache/types.ts";
import { cloneCachePayload, parseCachePayload } from "../cache/cache-payload.ts";
import type { CacheLookupStatus } from "../cache/cache-coordinator.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "../cache/stores/index.ts";
import type { RenderContext } from "../context/render-context.ts";
import { createCacheKey } from "../context/render-context.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

const logger = rendererLogger.component("context-aware-cache");

/** Default TTL for context-aware cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
/** Default stale window for expired public render entries (30 minutes). */
const DEFAULT_CACHE_STALE_MS = 30 * 60 * 1_000;
/** Default max entries for the in-memory cache store */
const DEFAULT_MAX_ENTRIES = 500;

function validateDurations(ttlMs: number, staleMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || ttlMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Context-aware cache ttlMs must be between 0 and ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  if (!Number.isFinite(staleMs) || staleMs < 0 || staleMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Context-aware cache staleMs must be between 0 and ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  if (ttlMs + staleMs > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Context-aware cache ttlMs + staleMs must not exceed ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
}

export interface ContextAwareCacheOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  ttlMs?: number;
  staleMs?: number;
}

export interface ContextAwareCacheLookupResult {
  cachedResult?: RenderResult;
  cacheKey: string;
  hit: boolean;
  status: CacheLookupStatus;
  lookupDurationMs: number;
}

export class ContextAwareCacheCoordinator {
  private store: CacheStore;
  private ttlMs: number;
  private staleMs: number;
  private readonly defaultTtlMs = DEFAULT_CACHE_TTL_MS;

  constructor(options: ContextAwareCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? this.defaultTtlMs;
    this.staleMs = options.staleMs ?? DEFAULT_CACHE_STALE_MS;
    validateDurations(this.ttlMs, this.staleMs);
    this.store = options.store ??
      new MemoryCacheStore({
        maxEntries: options.memory?.maxEntries ?? DEFAULT_MAX_ENTRIES,
        ttlMs: options.memory?.ttlMs ?? this.ttlMs,
        enforceStoreTtl: false,
      });
  }

  checkCache(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): Promise<ContextAwareCacheLookupResult> {
    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);

    return withSpan(
      SpanNames.CACHE_CHECK_SPECULATIVE,
      async () => {
        const lookupStart = performance.now();
        const stored = await this.store.get(cacheKey);
        const cached = stored === undefined ? undefined : parseCachePayload(stored);

        if (stored !== undefined && cached === undefined) {
          await this.store.delete(cacheKey);
        }

        if (!cached) {
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          logger.debug("Cache miss", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });
          return { cacheKey, hit: false, status: "miss", lookupDurationMs };
        }

        if (this.isExpired(cached)) {
          if (this.isStaleUsable(cached, ctx)) {
            const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
            recordCacheLookup("stale", lookupDurationMs);
            logger.debug("Cache stale hit", {
              slug,
              cacheKey,
              projectId: ctx.projectId,
              environment: ctx.environment,
              lookupDurationMs,
            });

            return {
              cachedResult: this.cloneResult(cached.result, cached.nodeMapEntries),
              cacheKey,
              hit: true,
              status: "stale",
              lookupDurationMs,
            };
          }

          await this.store.delete(cacheKey);

          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("expired", lookupDurationMs);
          logger.debug("Cache expired", {
            slug,
            cacheKey,
            projectId: ctx.projectId,
            environment: ctx.environment,
            lookupDurationMs,
          });

          return { cacheKey, hit: false, status: "expired", lookupDurationMs };
        }

        const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
        recordCacheLookup("hit", lookupDurationMs);
        logger.debug("Cache hit", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
          lookupDurationMs,
        });

        return {
          cachedResult: this.cloneResult(cached.result, cached.nodeMapEntries),
          cacheKey,
          hit: true,
          status: "hit",
          lookupDurationMs,
        };
      },
      {
        "cache.key": cacheKey,
        "cache.slug": slug,
        "cache.project_id": ctx.projectId,
        "cache.environment": ctx.environment,
        "cache.color_scheme": colorScheme ?? "default",
      },
    );
  }

  async persistResult(
    result: RenderResult,
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): Promise<void> {
    if (!result || result.stream) return;

    const cacheKey = this.getCacheKey(slug, ctx, colorScheme, cacheKeyOverride);
    const now = Date.now();

    const payload: CachePayload = {
      result: this.cloneResult(result),
      nodeMapEntries: result.nodeMap ? Array.from(result.nodeMap.entries()) : undefined,
      storedAt: now,
      expiresAt: now + this.ttlMs,
      staleUntil: this.shouldServeStale(ctx) && this.staleMs > 0
        ? now + this.ttlMs + this.staleMs
        : undefined,
    };
    await this.store.set(cacheKey, cloneCachePayload(payload));

    logger.debug("Cached result", {
      slug,
      projectId: ctx.projectId,
      environment: ctx.environment,
      cacheKey,
    });
  }

  async clearForContext(ctx: RenderContext): Promise<void> {
    const startTime = Date.now();

    if (typeof ctx.cachePrefix !== "string" || ctx.cachePrefix.length === 0) {
      throw new TypeError("Context cache invalidation requires a non-empty cache prefix");
    }
    if (!this.store.deleteByPrefix) {
      throw new TypeError("Cache store does not support context-scoped invalidation");
    }

    logger.debug("Clearing cache for context", {
      projectId: ctx.projectId,
      environment: ctx.environment,
      cachePrefix: ctx.cachePrefix,
    });

    const deleted = await this.store.deleteByPrefix(ctx.cachePrefix);

    logger.debug("✓ Cleared cache for context", {
      projectId: ctx.projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearForProject(projectId: string): Promise<void> {
    const startTime = Date.now();
    if (typeof projectId !== "string" || projectId.trim().length === 0) {
      throw new TypeError("Project cache invalidation requires a non-empty projectId");
    }
    const prefix = `${encodeURIComponent(projectId)}:`;

    if (!this.store.deleteByPrefix) {
      throw new TypeError("Cache store does not support project-scoped invalidation");
    }

    logger.debug("Clearing cache for project", { projectId, prefix });

    const deleted = await this.store.deleteByPrefix(prefix);

    logger.debug("✓ Cleared cache for project", {
      projectId,
      entriesDeleted: deleted,
      durationMs: Date.now() - startTime,
    });
  }

  async clearSlug(slug: string, ctx: RenderContext): Promise<void> {
    if (this.store.deleteByPrefix) {
      const exactKey = createCacheKey(ctx, `page:${slug}`);
      await this.store.delete(exactKey);
      await this.store.deleteByPrefix(`${exactKey}:`);
      logger.debug("Cleared slug from cache by prefix", {
        slug,
        projectId: ctx.projectId,
        exactKey,
      });
      return;
    }

    const keys = [
      createCacheKey(ctx, `page:${slug}`),
      createCacheKey(ctx, `page:${slug}:theme-light`),
      createCacheKey(ctx, `page:${slug}:theme-dark`),
    ];

    await Promise.all(keys.map((key) => this.store.delete(key)));

    logger.debug("Cleared slug from cache (all variants)", {
      slug,
      projectId: ctx.projectId,
      keys,
    });
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
    logger.debug("Cleared all cached data");
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  getStats(): { size: number } {
    const stats = this.store.getStats?.();
    if (stats) return stats;
    if (this.store.size) return { size: this.store.size() };
    return { size: 0 };
  }

  private getCacheKey(
    slug: string,
    ctx: RenderContext,
    colorScheme?: "light" | "dark",
    cacheKeyOverride?: string,
  ): string {
    // Use hyphen instead of equals sign (API cache key validation only allows: a-z A-Z 0-9 _ : . * - /)
    const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
    const baseKey = cacheKeyOverride && cacheKeyOverride.length > 0 ? cacheKeyOverride : slug;
    const contentKey = baseKey.startsWith("page:") ? baseKey : `page:${baseKey}`;
    const themedKey = themeKey && !/:theme-(light|dark)$/.test(contentKey)
      ? `${contentKey}${themeKey}`
      : contentKey;
    return createCacheKey(ctx, themedKey);
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() >= entry.expiresAt;
  }

  private isStaleUsable(entry: CachePayload, ctx: RenderContext): boolean {
    return this.shouldServeStale(ctx) &&
      typeof entry.staleUntil === "number" &&
      Date.now() <= entry.staleUntil;
  }

  private shouldServeStale(ctx: RenderContext): boolean {
    return ctx.environment === "production" && ctx.mode === "production";
  }

  private cloneResult(
    result: RenderResult,
    nodeMapEntries?: Array<[number, unknown]>,
  ): RenderResult {
    return cloneCachePayload({
      result: { ...result, stream: null },
      nodeMapEntries,
      storedAt: 0,
    }).result;
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
