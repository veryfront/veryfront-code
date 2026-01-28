// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
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
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

/** Semaphore to limit concurrent revalidations and prevent resource exhaustion */
const revalidationSemaphore = getSemaphore("revalidation", MAX_CONCURRENT_REVALIDATIONS, {
  acquireTimeoutMs: 5000, // Don't wait more than 5s for a permit
});

/**
 * Per-project revalidation tracking for multi-tenant fairness.
 * Prevents one project with many stale entries from starving other projects.
 */
const projectRevalidationCounts = new Map<string, number>();

/** Acquire a revalidation slot for a project (returns false if at per-project limit) */
function acquireRevalidationSlot(projectId: string): boolean {
  if (REVALIDATION_PER_PROJECT_LIMIT <= 0) return true;
  const current = projectRevalidationCounts.get(projectId) ?? 0;
  if (current >= REVALIDATION_PER_PROJECT_LIMIT) return false;
  projectRevalidationCounts.set(projectId, current + 1);
  return true;
}

/** Release a revalidation slot for a project */
function releaseRevalidationSlot(projectId: string): void {
  const current = projectRevalidationCounts.get(projectId) ?? 0;
  if (current <= 1) {
    projectRevalidationCounts.delete(projectId);
  } else {
    projectRevalidationCounts.set(projectId, current - 1);
  }
}

export class StaticDataFetcher {
  private pendingRevalidations = new Map<string, Promise<void>>();

  constructor(
    private cacheManager: CacheManager,
    private adapter?: RuntimeAdapter,
  ) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (typeof pageModule.getStaticData !== "function") return { props: {} };

    const pathname = context.url?.pathname ?? "unknown";
    const cacheKey = this.cacheManager.createCacheKey(context);

    // No caching in preview mode (cacheKey is null)
    if (!cacheKey) {
      return withSpan("data.fetch_static", () => this.fetchFreshNoCache(pageModule, context), {
        "data.fetch_method": "getStaticData",
        "data.pathname": pathname,
        "data.cache": "disabled",
      });
    }

    const cached = await withSpan(
      SpanNames.DATA_CACHE_GET,
      () => Promise.resolve(this.cacheManager.get(cacheKey)),
      { "data.cache_key": cacheKey, "data.pathname": pathname },
    );

    if (!cached) {
      return withSpan("data.fetch_static", () => this.fetchFresh(pageModule, context, cacheKey), {
        "data.fetch_method": "getStaticData",
        "data.pathname": pathname,
        "data.cache": "miss",
      });
    }

    if (this.cacheManager.shouldRevalidate(cached) && !this.pendingRevalidations.has(cacheKey)) {
      this.pendingRevalidations.set(
        cacheKey,
        this.revalidateInBackground(pageModule, context, cacheKey),
      );
    }

    return cached.data;
  }

  private async fetchFreshNoCache(
    pageModule: PageWithData,
    context: DataContext,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const start = performance.now();

    try {
      return await withTimeoutThrow(
        Promise.resolve(pageModule.getStaticData!({ params: context.params, url: context.url })),
        DATA_FETCH_TIMEOUT_MS,
        `getStaticData for ${pathname}`,
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathname,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
      } else {
        this.logError("DATA_FETCH_ERROR getStaticData failed", error, { pathname, durationMs });
      }

      throw error;
    }
  }

  private async fetchFresh(
    pageModule: PageWithData,
    context: DataContext,
    cacheKey: string,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname ?? "unknown";
    const start = performance.now();

    try {
      const result = await withTimeoutThrow(
        Promise.resolve(pageModule.getStaticData!({ params: context.params, url: context.url })),
        DATA_FETCH_TIMEOUT_MS,
        `getStaticData for ${pathname}`,
      );

      await withSpan(
        SpanNames.DATA_CACHE_SET,
        () => {
          this.cacheManager.set(cacheKey, {
            data: result,
            timestamp: Date.now(),
            revalidate: result.revalidate,
          });
          return Promise.resolve();
        },
        { "data.cache_key": cacheKey, "data.revalidate": result.revalidate ?? 0 },
      );

      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      if (error instanceof TimeoutError) {
        serverLogger.error("DATA_FETCH_TIMEOUT getStaticData timed out", {
          pathname,
          durationMs,
          timeoutMs: DATA_FETCH_TIMEOUT_MS,
          cacheKey,
        });
      } else {
        this.logError("DATA_FETCH_ERROR getStaticData failed", error, {
          pathname,
          durationMs,
          cacheKey,
        });
      }

      throw error;
    }
  }

  private async revalidateInBackground(
    pageModule: PageWithData,
    context: DataContext,
    cacheKey: string,
  ): Promise<void> {
    if (typeof pageModule.getStaticData !== "function") return;

    const pathname = context.url?.pathname ?? "unknown";
    // Use hostname as project identifier for per-project fairness
    const projectId = context.url?.hostname ?? "unknown";

    // Check per-project limit before acquiring global semaphore
    if (!acquireRevalidationSlot(projectId)) {
      serverLogger.debug("DATA_REVALIDATION_SKIPPED per-project limit reached", {
        pathname,
        projectId,
        cacheKey,
        limit: REVALIDATION_PER_PROJECT_LIMIT,
      });
      this.pendingRevalidations.delete(cacheKey);
      return;
    }

    try {
      await revalidationSemaphore.acquire(async () => {
        const start = performance.now();

        try {
          const result = await withTimeoutThrow(
            Promise.resolve(
              pageModule.getStaticData!({ params: context.params, url: context.url }),
            ),
            REVALIDATION_TIMEOUT_MS,
            `getStaticData revalidation for ${pathname}`,
          );

          this.cacheManager.set(cacheKey, {
            data: result,
            timestamp: Date.now(),
            revalidate: result.revalidate,
          });
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);

          if (error instanceof TimeoutError) {
            serverLogger.error("DATA_REVALIDATION_TIMEOUT background revalidation timed out", {
              pathname,
              durationMs,
              timeoutMs: REVALIDATION_TIMEOUT_MS,
              cacheKey,
            });
          } else {
            this.logError("DATA_REVALIDATION_ERROR background revalidation failed", error, {
              pathname,
              durationMs,
              cacheKey,
            });
          }
        }
      });
    } catch {
      // Semaphore timeout - too many concurrent revalidations, skip this one
      serverLogger.warn("DATA_REVALIDATION_SKIPPED semaphore timeout", {
        pathname,
        cacheKey,
        activeRevalidations: revalidationSemaphore.active,
        waitingRevalidations: revalidationSemaphore.waitingCount,
      });
    } finally {
      releaseRevalidationSlot(projectId);
      this.pendingRevalidations.delete(cacheKey);
    }
  }

  /**
   * Log errors unconditionally. Production errors should always be logged
   * for debugging and monitoring purposes.
   *
   * @see plans/architecture-audit/010-error-handling.md
   */
  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    // Always log errors - silent failures hide production bugs
    serverLogger.error(message, context ?? {}, error);
  }
}
