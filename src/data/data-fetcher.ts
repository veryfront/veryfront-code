import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import type { ServerDataFetcher, ServerDataFetchOptions } from "./server-data-fetcher.ts";
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
  /** Host-owned locality decision for development-only behavior. */
  isLocalProject?: boolean;
  /** Narrow host-owned capability for project-code execution. */
  allowHostProjectCodeExecution?: boolean;
  /** Stable host-owned tenant/project scope for reusable workers. */
  workerScope?: string;
  /** Immutable release or source-snapshot identity for reusable workers. */
  sourceGeneration?: string;
}

export class DataFetcher {
  private cacheManager: CacheManager;
  // Constructed lazily: the server fetcher pulls the sandbox worker pool,
  // which must stay out of browser bundles.
  private serverFetcher: ServerDataFetcher | undefined;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;

  constructor(_adapter?: unknown) {
    this.cacheManager = new CacheManager();

    this.staticFetcher = new StaticDataFetcher(this.cacheManager);
    this.pathsFetcher = new StaticPathsFetcher();
  }

  fetchData(
    pageModule: PageWithData,
    context: DataContext,
    // Defaults to production. In development every page is routed through
    // `getServerData` (sandbox worker execution) even when it exports
    // `getStaticData`, so an omitted mode must not opt a hosted render into
    // that path. The one non-test caller passes `this.config.mode`.
    mode: "development" | "production" = "production",
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
      ? {
        modulePath: options.modulePath,
        projectDir: options.projectDir,
        isLocalProject: options.isLocalProject,
        allowHostProjectCodeExecution: options.allowHostProjectCodeExecution,
        workerScope: options.workerScope,
        sourceGeneration: options.sourceGeneration,
      }
      : undefined;

    return withSpan(
      SpanNames.DATA_FETCH,
      async () => {
        if (useServer) {
          if (this.serverFetcher === undefined) {
            const { ServerDataFetcher } = await import("./server-data-fetcher.ts");
            this.serverFetcher = new ServerDataFetcher();
          }
          return this.serverFetcher.fetch(pageModule, context, isolationOptions);
        }
        if (useStatic) return this.staticFetcher.fetch(pageModule, context, options);
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
