import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
import type { CacheManager } from "./data-fetching-cache.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError, withTimeoutThrow } from "#veryfront/rendering/utils/stream-utils.ts";
import { getSemaphore } from "#veryfront/utils/semaphore.ts";
import {
  MAX_CONCURRENT_REVALIDATIONS,
  REVALIDATION_TIMEOUT_MS as REVALIDATION_TIMEOUT_CONFIG,
} from "#veryfront/utils/constants/cache.ts";

/** Shorter timeout for background revalidation (non-blocking, fire-and-forget) */
const REVALIDATION_TIMEOUT_MS = REVALIDATION_TIMEOUT_CONFIG;

/** Semaphore to limit concurrent revalidations and prevent resource exhaustion */
const revalidationSemaphore = getSemaphore("revalidation", MAX_CONCURRENT_REVALIDATIONS, {
  acquireTimeoutMs: 5000, // Don't wait more than 5s for a permit
});

export class StaticDataFetcher {
  private pendingRevalidations = new Map<string, Promise<void>>();

  constructor(
    private cacheManager: CacheManager,
    private adapter?: RuntimeAdapter,
  ) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getStaticData || typeof pageModule.getStaticData !== "function") {
      return { props: {} };
    }

    const cacheKey = this.cacheManager.createCacheKey(context);

    // No caching in preview mode (cacheKey is null)
    if (!cacheKey) {
      return await this.fetchFreshNoCache(pageModule, context);
    }

    const cached = this.cacheManager.get(cacheKey);

    if (!cached) {
      return await this.fetchFresh(pageModule, context, cacheKey);
    }

    if (this.cacheManager.shouldRevalidate(cached)) {
      if (!this.pendingRevalidations.has(cacheKey)) {
        this.pendingRevalidations.set(
          cacheKey,
          this.revalidateInBackground(pageModule, context, cacheKey),
        );
      }
    }

    return cached.data;
  }

  private async fetchFreshNoCache(
    pageModule: PageWithData,
    context: DataContext,
  ): Promise<DataResult> {
    const pathname = context.url?.pathname || "unknown";
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
    const pathname = context.url?.pathname || "unknown";
    const start = performance.now();

    try {
      const result = await withTimeoutThrow(
        Promise.resolve(pageModule.getStaticData!({ params: context.params, url: context.url })),
        DATA_FETCH_TIMEOUT_MS,
        `getStaticData for ${pathname}`,
      );

      this.cacheManager.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
        revalidate: result.revalidate,
      });

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
    if (!pageModule.getStaticData) return;

    const pathname = context.url?.pathname || "unknown";

    // Use semaphore to limit concurrent revalidations
    // This prevents resource exhaustion during traffic spikes
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
      this.pendingRevalidations.delete(cacheKey);
    }
  }

  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    const debugEnabled = this.adapter?.env.get("VERYFRONT_DEBUG");
    if (debugEnabled) {
      serverLogger.error(message, context ?? {}, error);
    }
  }
}
