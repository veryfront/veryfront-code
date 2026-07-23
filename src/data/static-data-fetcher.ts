import type { CacheManager } from "./data-fetching-cache.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { getSemaphore } from "#veryfront/utils/semaphore.ts";
import {
  MAX_CONCURRENT_REVALIDATIONS,
  REVALIDATION_PER_PROJECT_LIMIT,
  REVALIDATION_TIMEOUT_MS,
} from "#veryfront/utils/constants/cache.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CircuitBreakerOpen, getCircuitBreaker } from "#veryfront/utils/circuit-breaker.ts";
import { resolveDataProjectScope } from "./project-scope.ts";
import { parseDataResult, snapshotStaticDataResult } from "./result-validation.ts";
import { hashString } from "#veryfront/cache/hash.ts";

/** Semaphore to limit concurrent revalidations and prevent resource exhaustion */
const revalidationSemaphore = getSemaphore("revalidation", MAX_CONCURRENT_REVALIDATIONS, {
  acquireTimeoutMs: 5000, // Don't wait more than 5s for a permit
});

/**
 * Per-project revalidation tracking for multi-tenant fairness.
 * Prevents one project with many stale entries from starving other projects.
 *
 * Bounded in practice: an entry is created on slot acquire and deleted in
 * releaseRevalidationSlot once its count returns to 0, so the map only holds
 * projects with in-flight revalidations. Its high-water mark is the number of
 * projects revalidating concurrently, not the total number of projects seen.
 */
const projectRevalidationCounts = new Map<string, number>();

/** Acquire a revalidation slot for a project (returns false if at per-project limit) */
function acquireRevalidationSlot(projectScope: string): boolean {
  if (REVALIDATION_PER_PROJECT_LIMIT <= 0) return true;

  const current = projectRevalidationCounts.get(projectScope) ?? 0;
  if (current >= REVALIDATION_PER_PROJECT_LIMIT) return false;

  projectRevalidationCounts.set(projectScope, current + 1);
  return true;
}

/** Release a revalidation slot for a project */
function releaseRevalidationSlot(projectScope: string): void {
  const current = projectRevalidationCounts.get(projectScope) ?? 0;

  if (current <= 1) {
    projectRevalidationCounts.delete(projectScope);
    return;
  }

  projectRevalidationCounts.set(projectScope, current - 1);
}

type StaticDataHandler = NonNullable<PageWithData["getStaticData"]>;
type StaticDataContext = Omit<DataContext, "request" | "query">;

interface CacheWriteGuard {
  generation: number;
  keyGeneration: number;
}

export class StaticDataFetcher {
  private pendingRevalidations = new Map<string, Promise<void>>();
  private pendingFetches = new Map<string, Promise<DataResult>>();
  private activeCacheWrites = new Map<string, number>();
  private keyGenerations = new Map<string, number>();
  private generation = 0;
  private destroyed = false;

  constructor(private cacheManager: CacheManager) {}

  async fetch(
    pageModule: PageWithData,
    context: DataContext,
    dataSource = "default",
  ): Promise<DataResult> {
    const getStaticData = pageModule.getStaticData;
    if (typeof getStaticData !== "function") return { props: {} };

    const pathname = context.url?.pathname ?? "unknown";
    const pathnameHash = hashString(pathname);
    const cacheKey = this.cacheManager.createCacheKey(context, dataSource);

    // No caching in preview mode (cacheKey is null)
    if (!cacheKey) {
      return snapshotStaticDataResult(
        await withSpan(
          "data.fetch_static",
          () =>
            this.fetchFreshNoCache(
              getStaticData,
              context,
              this.createStaticDataContext(context),
            ),
          {
            "data.fetch_method": "getStaticData",
            "data.pathname_hash": pathnameHash,
            "data.cache": "disabled",
          },
        ),
      );
    }
    const cacheKeyHash = hashString(cacheKey);

    const cached = await withSpan(
      SpanNames.DATA_CACHE_GET,
      () => Promise.resolve(this.cacheManager.get(cacheKey)),
      { "data.cache_key_hash": cacheKeyHash, "data.pathname_hash": pathnameHash },
    );

    if (!cached) {
      const existingFetch = this.pendingFetches.get(cacheKey);
      if (existingFetch) return snapshotStaticDataResult(await existingFetch);

      const guard = this.beginCacheWrite(cacheKey);
      const pendingFetch = withSpan(
        "data.fetch_static",
        () =>
          this.fetchFresh(
            getStaticData,
            context,
            this.createStaticDataContext(context),
            cacheKey,
            guard,
          ),
        {
          "data.fetch_method": "getStaticData",
          "data.pathname_hash": pathnameHash,
          "data.cache": "miss",
        },
      ).finally(() => this.finishCacheWrite(cacheKey));
      this.pendingFetches.set(cacheKey, pendingFetch);
      const clearPendingFetch = () => {
        if (this.pendingFetches.get(cacheKey) === pendingFetch) {
          this.pendingFetches.delete(cacheKey);
        }
      };
      void pendingFetch.then(clearPendingFetch, clearPendingFetch);
      return snapshotStaticDataResult(await pendingFetch);
    }

    if (this.cacheManager.shouldRevalidate(cached) && !this.pendingRevalidations.has(cacheKey)) {
      const guard = this.beginCacheWrite(cacheKey);
      const pendingRevalidation = this.revalidateInBackground(
        getStaticData,
        context,
        this.createStaticDataContext(context),
        cacheKey,
        guard,
      ).finally(() => this.finishCacheWrite(cacheKey));
      this.pendingRevalidations.set(cacheKey, pendingRevalidation);
      const clearPendingRevalidation = () => {
        if (this.pendingRevalidations.get(cacheKey) === pendingRevalidation) {
          this.pendingRevalidations.delete(cacheKey);
        }
      };
      void pendingRevalidation.then(clearPendingRevalidation, clearPendingRevalidation);
    }

    return cached.data;
  }

  private createStaticDataContext(
    context: DataContext,
  ): StaticDataContext {
    const params = Object.fromEntries(
      Object.entries(context.params).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    );
    const url = new URL(context.url);
    url.search = "";
    url.hash = "";
    return { params, url };
  }

  private executeStaticData(
    getStaticData: StaticDataHandler,
    context: StaticDataContext,
    timeoutMs: number,
    label: string,
  ): Promise<DataResult> {
    return withTimeoutThrow(
      Promise.resolve(getStaticData(context)),
      timeoutMs,
      label,
    ).then((value) => parseDataResult(value, "getStaticData"));
  }

  private storeCacheEntry(
    cacheKey: string,
    result: DataResult,
    guard: CacheWriteGuard,
  ): void {
    if (!this.canWriteCache(cacheKey, guard)) return;
    this.cacheManager.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      revalidate: result.revalidate,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.pendingFetches.clear();
    this.pendingRevalidations.clear();
  }

  /** Prevent matching in-flight work from restoring invalidated cache entries. */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.generation++;
      this.keyGenerations.clear();
      this.pendingFetches.clear();
      this.pendingRevalidations.clear();
      return;
    }

    const activeKeys = new Set([
      ...this.pendingFetches.keys(),
      ...this.pendingRevalidations.keys(),
    ]);
    for (const cacheKey of activeKeys) {
      if (!cacheKey.includes(pattern)) continue;
      this.keyGenerations.set(
        cacheKey,
        (this.keyGenerations.get(cacheKey) ?? 0) + 1,
      );
      this.pendingFetches.delete(cacheKey);
      this.pendingRevalidations.delete(cacheKey);
    }
  }

  private beginCacheWrite(cacheKey: string): CacheWriteGuard {
    this.activeCacheWrites.set(
      cacheKey,
      (this.activeCacheWrites.get(cacheKey) ?? 0) + 1,
    );
    return {
      generation: this.generation,
      keyGeneration: this.keyGenerations.get(cacheKey) ?? 0,
    };
  }

  private finishCacheWrite(cacheKey: string): void {
    const activeWrites = this.activeCacheWrites.get(cacheKey) ?? 0;
    if (activeWrites > 1) {
      this.activeCacheWrites.set(cacheKey, activeWrites - 1);
      return;
    }
    this.activeCacheWrites.delete(cacheKey);
    this.keyGenerations.delete(cacheKey);
  }

  private canWriteCache(cacheKey: string, guard: CacheWriteGuard): boolean {
    return !this.destroyed &&
      guard.generation === this.generation &&
      guard.keyGeneration === (this.keyGenerations.get(cacheKey) ?? 0);
  }

  private async fetchFreshNoCache(
    getStaticData: StaticDataHandler,
    context: DataContext,
    staticContext: StaticDataContext,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const pathnameHash = hashString(pathname);
    const start = performance.now();

    try {
      return await this.executeStaticData(
        getStaticData,
        staticContext,
        DATA_FETCH_TIMEOUT_MS,
        "getStaticData",
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathnameHash,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
        throw error;
      }

      this.logError("DATA_FETCH_ERROR getStaticData failed", error, {
        pathnameHash,
        durationMs,
      });
      throw error;
    }
  }

  private async fetchFresh(
    getStaticData: StaticDataHandler,
    context: DataContext,
    staticContext: StaticDataContext,
    cacheKey: string,
    guard: CacheWriteGuard,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const pathnameHash = hashString(pathname);
    // Use trusted ambient tenancy when available and a hashed host scope otherwise.
    const projectScope = resolveDataProjectScope(context);
    const cacheKeyHash = hashString(cacheKey);
    const start = performance.now();

    // Circuit breaker per project to prevent cascade failures
    const circuitBreaker = getCircuitBreaker(`static-data-fetch:${projectScope}`, {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      successThreshold: 2,
    });

    try {
      const result = await circuitBreaker.execute(() =>
        this.executeStaticData(
          getStaticData,
          staticContext,
          DATA_FETCH_TIMEOUT_MS,
          "getStaticData",
        )
      );

      await withSpan(
        SpanNames.DATA_CACHE_SET,
        () => {
          this.storeCacheEntry(cacheKey, result, guard);
          return Promise.resolve();
        },
        {
          "data.cache_key_hash": cacheKeyHash,
          "data.revalidate": result.revalidate ?? 0,
        },
      );

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (error instanceof CircuitBreakerOpen) {
        serverLogger.warn("DATA_FETCH_CIRCUIT_OPEN circuit breaker open, failing fast", {
          pathnameHash,
          projectScope,
          retryAfterMs: error.nextAttemptMs,
          cacheKeyHash,
        });
        throw error;
      }

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathnameHash,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
          cacheKeyHash,
        });
        throw error;
      }

      this.logError("DATA_FETCH_ERROR getStaticData failed", error, {
        pathnameHash,
        durationMs,
        cacheKeyHash,
      });
      throw error;
    }
  }

  private async revalidateInBackground(
    getStaticData: StaticDataHandler,
    context: DataContext,
    staticContext: StaticDataContext,
    cacheKey: string,
    guard: CacheWriteGuard,
  ): Promise<void> {
    const pathname = context.url?.pathname ?? "unknown";
    const pathnameHash = hashString(pathname);
    // Keep fairness keyed to trusted, non-identifying project scope.
    const projectScope = resolveDataProjectScope(context);
    const cacheKeyHash = hashString(cacheKey);

    // Check per-project limit before acquiring global semaphore
    if (!acquireRevalidationSlot(projectScope)) {
      serverLogger.debug("DATA_REVALIDATION_SKIPPED per-project limit reached", {
        pathnameHash,
        projectScope,
        cacheKeyHash,
        limit: REVALIDATION_PER_PROJECT_LIMIT,
      });
      return;
    }

    try {
      await revalidationSemaphore.acquire(async () => {
        const start = performance.now();

        try {
          const result = await this.executeStaticData(
            getStaticData,
            staticContext,
            REVALIDATION_TIMEOUT_MS,
            "getStaticData revalidation",
          );

          this.storeCacheEntry(cacheKey, result, guard);
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_REVALIDATION_TIMEOUT background revalidation timed out", {
              pathnameHash,
              durationMs,
              timeoutMs: REVALIDATION_TIMEOUT_MS,
              cacheKeyHash,
            });
            return;
          }

          this.logError("DATA_REVALIDATION_ERROR background revalidation failed", error, {
            pathnameHash,
            durationMs,
            cacheKeyHash,
          });
        }
      });
    } catch (_) {
      // expected: semaphore timeout when too many concurrent revalidations
      serverLogger.warn("DATA_REVALIDATION_SKIPPED semaphore timeout", {
        pathnameHash,
        cacheKeyHash,
        activeRevalidations: revalidationSemaphore.active,
        waitingRevalidations: revalidationSemaphore.waitingCount,
      });
    } finally {
      releaseRevalidationSlot(projectScope);
    }
  }

  /**
   * Log errors unconditionally. Production errors should always be logged
   * for debugging and monitoring purposes.
   *
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    serverLogger.error(message, {
      ...context,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}
