// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import { ServerDataFetcher } from "./server-data-fetcher.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.ts";

export class DataFetcher {
  private cacheManager: CacheManager;
  private serverFetcher: ServerDataFetcher;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;

  constructor(adapter?: RuntimeAdapter) {
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher(adapter);
    this.staticFetcher = new StaticDataFetcher(this.cacheManager, adapter);
    this.pathsFetcher = new StaticPathsFetcher();
  }

  async fetchData(
    pageModule: PageWithData,
    context: DataContext,
    mode: "development" | "production" = "development",
  ): Promise<DataResult> {
    const preferServerData = mode === "development" || !pageModule.getStaticData;
    const fetchType = preferServerData && pageModule.getServerData
      ? "server"
      : pageModule.getStaticData
      ? "static"
      : "none";

    return await withSpan(
      SpanNames.DATA_FETCH,
      async () => {
        if (preferServerData && pageModule.getServerData) {
          return await this.serverFetcher.fetch(pageModule, context);
        }

        if (pageModule.getStaticData) {
          return await this.staticFetcher.fetch(pageModule, context);
        }

        return { props: {} };
      },
      {
        "data.fetch_type": fetchType,
        "data.mode": mode,
        "data.pathname": context.url?.pathname || "unknown",
      },
    );
  }

  getStaticPaths(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    return this.pathsFetcher.fetch(pageModule);
  }

  clearCache(pattern?: string): void {
    if (pattern) {
      this.cacheManager.clearPattern(pattern);
    } else {
      this.cacheManager.clear();
    }
  }
}
