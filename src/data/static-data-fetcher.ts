import type { CacheManager } from "./data-fetching-cache.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

export class StaticDataFetcher {
  private pendingRevalidations = new Map<string, Promise<void>>();

  constructor(private cacheManager: CacheManager) {}

  async fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult> {
    if (!pageModule.getStaticData) {
      return { props: {} };
    }

    const cacheKey = this.cacheManager.createCacheKey(context);
    const cached = this.cacheManager.get(cacheKey);

    if (cached && !this.cacheManager.shouldRevalidate(cached)) {
      return cached.data;
    }

    if (cached && this.cacheManager.shouldRevalidate(cached)) {
      if (!this.pendingRevalidations.has(cacheKey)) {
        this.pendingRevalidations.set(
          cacheKey,
          this.revalidateInBackground(pageModule, context, cacheKey),
        );
      }
      return cached.data;
    }

    return await this.fetchFresh(pageModule, context, cacheKey);
  }

  private async fetchFresh(
    pageModule: PageWithData,
    context: DataContext,
    cacheKey: string,
  ): Promise<DataResult> {
    if (!pageModule.getStaticData) {
      return { props: {} };
    }

    try {
      const result = await pageModule.getStaticData({
        params: context.params,
        url: context.url,
      });

      this.cacheManager.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
        revalidate: result.revalidate,
      });

      return result;
    } catch (error) {
      // Always log errors for static data fetching failures
      serverLogger.error("Error in getStaticData:", error);
      throw error;
    }
  }

  private async revalidateInBackground(
    pageModule: PageWithData,
    context: DataContext,
    cacheKey: string,
  ): Promise<void> {
    try {
      if (!pageModule.getStaticData) {
        return;
      }

      const result = await pageModule.getStaticData({
        params: context.params,
        url: context.url,
      });

      this.cacheManager.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
        revalidate: result.revalidate,
      });
    } catch (error) {
      // Log background revalidation errors but don't throw
      // as we're serving stale data and this is a background operation
      serverLogger.error("Error revalidating data:", error);
    } finally {
      this.pendingRevalidations.delete(cacheKey);
    }
  }
}
