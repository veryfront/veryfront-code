import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { combineAbortSignals, getAbortReason, raceWithCallerAbort } from "./abort-utils.ts";
import {
  CacheManager,
  type DataCacheScope,
  snapshotDataCacheScope,
} from "./data-fetching-cache.ts";
import { ServerDataFetcher, type ServerDataFetchOptions } from "./server-data-fetcher.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { StaticPathsFetcher, type StaticPathsFetchOptions } from "./static-paths-fetcher.ts";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import {
  type DataExecutionAdmission,
  defaultDataExecutionAdmission,
} from "./execution-admission.ts";
import { requireDataProjectId } from "./project-identity.ts";
import { snapshotWorkerGenerationIdentity } from "#veryfront/security/sandbox/worker-generation.ts";

/**
 * Options for isolated data fetching. Passed through to ServerDataFetcher
 * when worker isolation is enabled.
 */
export interface FetchDataOptions {
  /** Absolute data-module path. Production static caching is skipped when absent or empty. */
  modulePath?: string;
  /** Project directory for worker scoping */
  projectDir?: string;
  /** Trusted project identity for breaker and revalidation isolation */
  projectId?: string;
  /** Explicit immutable cache scope; null deliberately disables caching. */
  cacheScope?: DataCacheScope | null;
  /** Caller cancellation. Shared static work continues for other callers. */
  signal?: AbortSignal;
  /** @internal Host-owned worker lifetime scope; paired with workerGenerationId. */
  workerScopeId?: string;
  /** @internal Immutable source identity; paired with workerScopeId. */
  workerGenerationId?: string;
}

export interface DataFetcherOptions {
  /**
   * Optional local deadline for getStaticPaths. Omitted or zero preserves the
   * historical unbounded behavior.
   */
  staticPathsTimeoutMs?: number;
  /** @internal Shared process admission; injectable for embedded runtimes and tests. */
  executionAdmission?: DataExecutionAdmission;
}

export class DataFetcher {
  private cacheManager: CacheManager;
  private serverFetcher: ServerDataFetcher;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;
  private destroyed = false;

  constructor(
    _adapter?: unknown,
    options: DataFetcherOptions = {},
  ) {
    const executionAdmission = options.executionAdmission ??
      defaultDataExecutionAdmission;
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher(executionAdmission);
    this.staticFetcher = new StaticDataFetcher(this.cacheManager, {
      executionAdmission,
    });
    this.pathsFetcher = new StaticPathsFetcher({
      timeoutMs: options.staticPathsTimeoutMs,
      executionAdmission,
    });
  }

  fetchData<TProps = unknown>(
    pageModule: PageWithData<TProps>,
    context: DataContext,
    mode: "development" | "production" = "development",
    options?: FetchDataOptions,
  ): Promise<DataResult<TProps>> {
    if (this.destroyed) {
      return Promise.reject(new Error("DataFetcher has been destroyed"));
    }
    if (mode !== "development" && mode !== "production") {
      return Promise.reject(
        new TypeError(`Unsupported data fetching mode: ${String(mode)}`),
      );
    }
    // Options are a public JavaScript boundary. Snapshot every identity field
    // once so accessors or proxies cannot assign admission, cache publication,
    // and isolated execution to different projects.
    let modulePath: string | undefined;
    let projectDir: string | undefined;
    let suppliedProjectId: string | undefined;
    let suppliedScope: DataCacheScope | null | undefined;
    let suppliedSignal: AbortSignal | undefined;
    let workerScopeId: string | undefined;
    let workerGenerationId: string | undefined;
    try {
      modulePath = options?.modulePath;
      projectDir = options?.projectDir;
      suppliedProjectId = options?.projectId;
      suppliedScope = options?.cacheScope;
      suppliedSignal = options?.signal;
      workerScopeId = options?.workerScopeId;
      workerGenerationId = options?.workerGenerationId;
    } catch (error) {
      return Promise.reject(error);
    }

    const callerSignal = combineAbortSignals(
      context.request?.signal,
      suppliedSignal,
    );
    if (callerSignal?.aborted) {
      return Promise.reject(getAbortReason(callerSignal));
    }
    let authoritativeScope: Readonly<DataCacheScope> | null;
    let ambientScope: Readonly<DataCacheScope> | null;
    let trustedSuppliedProjectId: string | undefined;
    let workerGeneration:
      | ReturnType<typeof snapshotWorkerGenerationIdentity>
      | undefined;
    try {
      const rawAmbientScope = tryGetCacheKeyContext();
      ambientScope = rawAmbientScope === null ? null : snapshotDataCacheScope(rawAmbientScope);
      const rawScope = suppliedScope === undefined ? ambientScope : suppliedScope;
      authoritativeScope = rawScope === null ? null : snapshotDataCacheScope(rawScope);
      trustedSuppliedProjectId = suppliedProjectId === undefined
        ? undefined
        : requireDataProjectId(suppliedProjectId);
      workerGeneration = snapshotWorkerGenerationIdentity(
        workerScopeId,
        workerGenerationId,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    if (
      authoritativeScope &&
      trustedSuppliedProjectId !== undefined &&
      trustedSuppliedProjectId !== authoritativeScope.projectId
    ) {
      return Promise.reject(
        new TypeError(
          "Data fetch projectId must match the authoritative cache scope projectId",
        ),
      );
    }
    const trustedProjectId = trustedSuppliedProjectId ??
      authoritativeScope?.projectId ??
      ambientScope?.projectId;

    let serverDataExport: PageWithData<TProps>["getServerData"];
    let staticDataExport: PageWithData<TProps>["getStaticData"];
    try {
      serverDataExport = pageModule.getServerData;
      staticDataExport = pageModule.getStaticData;
    } catch (error) {
      return Promise.reject(error);
    }
    const hasServerData = typeof serverDataExport === "function";
    const hasStaticData = typeof staticDataExport === "function";
    const preferServerData = mode === "development" || !hasStaticData;
    const useServer = preferServerData && hasServerData;
    const useStatic = !useServer && hasStaticData;

    const fetchType: "server" | "static" | "none" = useServer
      ? "server"
      : useStatic
      ? "static"
      : "none";

    const isolationOptions: ServerDataFetchOptions = {
      modulePath,
      projectDir,
      projectId: trustedProjectId,
      cacheScope: authoritativeScope,
      signal: callerSignal,
      workerScopeId: workerGeneration?.scopeId,
      workerGenerationId: workerGeneration?.generationId,
    };
    // Pass a plain, request-local module view so a mutable export accessor
    // cannot change between loader selection and deferred execution.
    const executionPageModule: PageWithData<TProps> = {
      default: null,
      ...(hasServerData ? { getServerData: serverDataExport } : {}),
      ...(hasStaticData ? { getStaticData: staticDataExport } : {}),
    };

    return withSpan(
      SpanNames.DATA_FETCH,
      () => {
        if (useServer) {
          return this.serverFetcher.fetch(
            executionPageModule,
            context,
            isolationOptions,
          ) as Promise<DataResult<TProps>>;
        }
        if (useStatic) {
          const pending = this.staticFetcher.fetch(
            executionPageModule,
            context,
            {
              modulePath,
              projectId: trustedProjectId,
              cacheScope: authoritativeScope,
              workerScopeId: workerGeneration?.scopeId,
              workerGenerationId: workerGeneration?.generationId,
            },
          ) as Promise<DataResult<TProps>>;
          return raceWithCallerAbort(pending, callerSignal);
        }
        return Promise.resolve({ props: {} } as DataResult<TProps>);
      },
      {
        "data.fetch_type": fetchType,
        "data.mode": mode,
        "data.pathname": context.url?.pathname ?? "unknown",
      },
    );
  }

  getStaticPaths(
    pageModule: PageWithData,
    options?: StaticPathsFetchOptions,
  ): Promise<StaticPathsResult | null> {
    if (this.destroyed) {
      return Promise.reject(new Error("DataFetcher has been destroyed"));
    }
    return this.pathsFetcher.fetch(pageModule, options);
  }

  clearCache(pattern?: string): void {
    if (this.destroyed) return;
    this.staticFetcher.invalidatePendingCacheWrites({
      pattern: pattern || undefined,
    });

    if (pattern) {
      this.cacheManager.clearPattern(pattern);
      return;
    }

    this.cacheManager.clear();
  }

  clearCacheForScope(scope: DataCacheScope, pattern?: string): void {
    if (this.destroyed) return;
    const snapshot = snapshotDataCacheScope(scope);
    this.staticFetcher.invalidatePendingCacheWrites({ pattern, scope: snapshot });
    this.cacheManager.clearScope(snapshot, pattern);
  }

  clearCacheForRoute(scope: DataCacheScope, pathname: string): void {
    if (this.destroyed) return;
    const snapshot = snapshotDataCacheScope(scope);
    this.staticFetcher.invalidatePendingCacheWrites({ scope: snapshot, pathname });
    this.cacheManager.clearRoute(snapshot, pathname);
  }

  clearCacheForProject(projectId: string, pattern?: string): void {
    if (this.destroyed) return;
    this.staticFetcher.invalidatePendingCacheWrites({ projectId, pattern });
    this.cacheManager.clearProject(projectId, pattern);
  }

  clearCacheForProjectRoute(projectId: string, pathname: string): void {
    if (this.destroyed) return;
    this.staticFetcher.invalidatePendingCacheWrites({ projectId, pathname });
    this.cacheManager.clearProjectRoute(projectId, pathname);
  }

  clearCacheForRouteAcrossScopes(pathname: string): void {
    if (this.destroyed) return;
    this.staticFetcher.invalidatePendingCacheWrites({ pathname });
    this.cacheManager.clearRouteAcrossScopes(pathname);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staticFetcher.invalidatePendingCacheWrites({});
    this.cacheManager.destroy();
  }
}
