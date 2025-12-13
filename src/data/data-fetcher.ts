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

  constructor() {
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher();
    this.staticFetcher = new StaticDataFetcher(this.cacheManager);
    this.pathsFetcher = new StaticPathsFetcher();
  }

  async fetchData(
    pageModule: PageWithData,
    context: DataContext,
    mode: "development" | "production" = "development",
  ): Promise<DataResult> {
    if (!pageModule.getServerData && !pageModule.getStaticData) {
      return { props: {} };
    }

    if (mode === "development" && pageModule.getServerData) {
      return await this.serverFetcher.fetch(pageModule, context);
    }

    if (pageModule.getStaticData) {
      return await this.staticFetcher.fetch(pageModule, context);
    }

    if (pageModule.getServerData) {
      return await this.serverFetcher.fetch(pageModule, context);
    }

    return { props: {} };
  }

  async getStaticPaths(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    return await this.pathsFetcher.fetch(pageModule);
  }

  clearCache(pattern?: string): void {
    if (pattern) {
      this.cacheManager.clearPattern(pattern);
    } else {
      this.cacheManager.clear();
    }
  }
}
