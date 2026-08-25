import { rendererLogger as logger } from "#veryfront/utils";
import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload, CacheStore } from "./types.ts";
import { MemoryCacheStore, type MemoryCacheStoreOptions } from "./stores/index.ts";
import { markRequestProfilePhase, metrics } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  bindHtmlNonceFromCache,
  isHtmlNonceCacheCompatible,
  sealHtmlNonceForCache,
} from "#veryfront/html/nonce-injection.ts";
import { cloneCachePayload, parseCachePayload } from "./cache-payload.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";
import { getErrorMessage } from "#veryfront/errors";

/** Default TTL for cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_PENDING_CACHE_EVICTIONS = 128;

function normalizeDurationMilliseconds(value: number, label: "ttlMs" | "staleMs"): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_CACHE_TTL_MILLISECONDS) {
    throw new RangeError(
      `Cache coordinator ${label} must be between 0 and ${MAX_CACHE_TTL_MILLISECONDS}`,
    );
  }
  return Math.ceil(value);
}

export interface CacheCoordinatorOptions {
  store?: CacheStore;
  memory?: MemoryCacheStoreOptions;
  /** Logical freshness window in milliseconds. Zero means no logical expiration. */
  ttlMs?: number;
  /** Stale-while-refresh window in milliseconds; ignored when `ttlMs` is zero. */
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
  private readonly ttlMs: number;
  private readonly staleMs: number;
  private readonly defaultTtlMs = DEFAULT_CACHE_TTL_MS;
  private readonly projectId: string | undefined;
  private readonly contentSourceId: string | undefined;
  private readonly cachePrefix: string;
  private readonly pendingEvictions = new Map<string, Promise<void>>();

  constructor(options: CacheCoordinatorOptions = {}) {
    this.ttlMs = normalizeDurationMilliseconds(
      options.ttlMs ?? this.defaultTtlMs,
      "ttlMs",
    );
    this.staleMs = normalizeDurationMilliseconds(options.staleMs ?? 0, "staleMs");
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;

    // Build cache prefix for tenant isolation
    // Format: projectId:contentSourceId: (or empty if no projectId)
    this.cachePrefix = this.projectId
      ? `${this.projectId}:${this.contentSourceId ?? "draft"}:`
      : "";

    if (!this.projectId) {
      logger.warn(
        "[CacheCoordinator] No projectId provided - cache keys will not be tenant-isolated. " +
          "This may cause cross-project cache pollution in multi-tenant deployments.",
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

  checkCache(slug: string, cacheKey?: string, nonce?: string): Promise<CacheLookupResult> {
    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.checkCache",
      async () => {
        const lookupStart = performance.now();
        const stored = await this.store.get(key);

        if (stored === undefined) {
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          return { depAwareSlug: slug, moduleCacheKey: key, cacheStatus: "miss", lookupDurationMs };
        }

        const cached = parseCachePayload(stored);

        // A stored value that fails validation is unusable; drop it so the next
        // render repopulates the key instead of replaying corrupt data.
        if (cached === undefined) {
          this.scheduleEviction(key, stored, "invalid payload");
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          return { depAwareSlug: slug, moduleCacheKey: key, cacheStatus: "miss", lookupDurationMs };
        }

        if (!isHtmlNonceCacheCompatible(cached.htmlNoncePlaceholder, nonce)) {
          this.scheduleEviction(key, stored, "nonce-incompatible payload");
          const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
          recordCacheLookup("miss", lookupDurationMs);
          return {
            depAwareSlug: slug,
            moduleCacheKey: key,
            cacheStatus: "miss",
            lookupDurationMs,
          };
        }

        if (this.isExpired(cached)) {
          if (this.isStaleUsable(cached)) {
            const lookupDurationMs = roundDurationMs(performance.now() - lookupStart);
            recordCacheLookup("stale", lookupDurationMs);
            return {
              cachedResult: this.hydrateResult(cached, nonce),
              depAwareSlug: slug,
              moduleCacheKey: key,
              cachedModule: cached.result.pageModule,
              cacheStatus: "stale",
              lookupDurationMs,
            };
          }

          this.scheduleEviction(key, stored, "expired payload");
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
          cachedResult: this.hydrateResult(cached, nonce),
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

  persistResult(
    result: RenderResult,
    slug: string,
    cacheKey?: string,
    nonce?: string,
  ): Promise<void> {
    if (result.stream) return Promise.resolve();

    const key = this.buildCacheKey(slug, cacheKey);

    return withSpan(
      "cache.persistResult",
      async () => {
        const now = Date.now();
        const sealedHtml = sealHtmlNonceForCache(result.html, nonce);
        const payload: CachePayload = {
          result: {
            html: sealedHtml.html,
            css: result.css,
            frontmatter: result.frontmatter,
            headings: result.headings,
            nodeMap: result.nodeMap,
            stream: null,
            ssrHash: result.ssrHash,
            pageModule: result.pageModule,
            ...(result.headers ? { headers: result.headers } : {}),
          },
          ...(sealedHtml.placeholder === undefined
            ? {}
            : { htmlNoncePlaceholder: sealedHtml.placeholder }),
          storedAt: now,
          expiresAt: this.ttlMs > 0 ? now + this.ttlMs : undefined,
          staleUntil: this.ttlMs > 0 && this.staleMs > 0
            ? now + this.ttlMs + this.staleMs
            : undefined,
        };

        // Caching is best-effort: a result too large to snapshot, or a store
        // that refuses the write, must not fail the render that produced it.
        try {
          await this.store.set(key, cloneCachePayload(payload));
        } catch (error) {
          logger.warn("[CacheCoordinator] Skipped caching render result", {
            slug,
            key,
            reason: getErrorMessage(error),
          });
        }
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
      await this.store.deleteByPrefix(prefixedSlug);
    } else {
      await this.store.delete(prefixedSlug);
    }
  }

  /**
   * Clear all cache entries for the current project.
   * Only clears entries with the current project prefix.
   */
  async clearForProject(): Promise<void> {
    if (!this.projectId || !this.store.deleteByPrefix) {
      await this.clearAll();
      return;
    }

    await this.store.deleteByPrefix(this.cachePrefix);
  }

  async destroy(): Promise<void> {
    await this.store.destroy();
  }

  private isExpired(entry: CachePayload): boolean {
    return typeof entry.expiresAt === "number" && Date.now() >= entry.expiresAt;
  }

  private scheduleEviction(key: string, expected: CachePayload, reason: string): void {
    const deleteIfUnchanged = this.store.deleteIfUnchanged;
    if (
      deleteIfUnchanged === undefined ||
      this.pendingEvictions.has(key) ||
      this.pendingEvictions.size >= MAX_PENDING_CACHE_EVICTIONS
    ) {
      return;
    }

    const eviction = Promise.resolve()
      .then(async () => {
        await deleteIfUnchanged.call(this.store, key, expected);
      })
      .catch((error: unknown) => {
        logger.warn("[CacheCoordinator] Cache eviction failed", {
          key,
          reason,
          error: getErrorMessage(error),
        });
      })
      .finally(() => {
        if (this.pendingEvictions.get(key) === eviction) {
          this.pendingEvictions.delete(key);
        }
      });
    this.pendingEvictions.set(key, eviction);
  }

  private isStaleUsable(entry: CachePayload): boolean {
    return typeof entry.staleUntil === "number" && Date.now() <= entry.staleUntil;
  }

  private hydrateResult(entry: CachePayload, nonce?: string): RenderResult {
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
      html: bindHtmlNonceFromCache(
        entry.result.html,
        entry.htmlNoncePlaceholder,
        nonce,
      ),
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
