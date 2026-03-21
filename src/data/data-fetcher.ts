import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import { ServerDataFetcher, type ServerDataFetchOptions } from "./server-data-fetcher.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.ts";

/**
 * Options for isolated data fetching. Passed through to ServerDataFetcher
 * when worker isolation is enabled.
 */
export interface FetchDataOptions {
  /** Absolute path to the module containing getServerData */
  modulePath?: string;
  /** Project directory for worker scoping */
  projectDir?: string;
}

export class DataFetcher {
  private cacheManager: CacheManager;
  private serverFetcher: ServerDataFetcher;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;

  constructor(_adapter?: unknown) {
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher();
    this.staticFetcher = new StaticDataFetcher(this.cacheManager);
    this.pathsFetcher = new StaticPathsFetcher();
  }

  fetchData(
    pageModule: PageWithData,
    context: DataContext,
    mode: "development" | "production" = "development",
    options?: FetchDataOptions,
  ): Promise<DataResult> {
    const preferServerData = mode === "development" || !pageModule.getStaticData;
    const useServer = preferServerData && !!pageModule.getServerData;
    const useStatic = !useServer && !!pageModule.getStaticData;

    const fetchType: "server" | "static" | "none" = useServer
      ? "server"
      : useStatic
      ? "static"
      : "none";

    const isolationOptions: ServerDataFetchOptions | undefined = options
      ? { modulePath: options.modulePath, projectDir: options.projectDir }
      : undefined;

    return withSpan(
      SpanNames.DATA_FETCH,
      () => {
        if (useServer) return this.serverFetcher.fetch(pageModule, context, isolationOptions);
        if (useStatic) return this.staticFetcher.fetch(pageModule, context);
        return Promise.resolve({ props: {} });
      },
      {
        "data.fetch_type": fetchType,
        "data.mode": mode,
        "data.pathname": context.url?.pathname ?? "unknown",
      },
    );
  }

  getStaticPaths(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    return this.pathsFetcher.fetch(pageModule);
  }

  clearCache(pattern?: string): void {
    if (pattern) {
      this.cacheManager.clearPattern(pattern);
      return;
    }

    this.cacheManager.clear();
  }
}
