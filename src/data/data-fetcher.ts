import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  combineAbortSignals,
  getAbortReason,
  isAbortSignalAborted,
  snapshotAbortSignal,
} from "./abort-utils.ts";
import {
  CacheManager,
  type DataCacheScope,
  snapshotDataCachePathname,
  snapshotDataCachePattern,
  snapshotDataCacheScope,
} from "./data-fetching-cache.ts";
import { ServerDataFetcher, type ServerDataFetchOptions } from "./server-data-fetcher.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { StaticPathsFetcher, type StaticPathsFetchOptions } from "./static-paths-fetcher.ts";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.ts";
import { cloneServerDataContext, getDataRequestSignal } from "./helpers.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { DataExecutionAdmission, defaultDataExecutionAdmission } from "./execution-admission.ts";
import { requireDataProjectId } from "./project-identity.ts";
import { snapshotWorkerGenerationIdentity } from "#veryfront/security/sandbox/worker-generation.ts";
import { MAX_DATA_MODULE_PATH_CHARACTERS, MAX_DATA_PROJECT_DIR_CHARACTERS } from "./data-limits.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

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

function snapshotFetchDataOptions(options: unknown): Readonly<FetchDataOptions> {
  if (options === undefined) return Object.freeze({});
  if (
    options === null || typeof options !== "object" || Array.isArray(options) ||
    isProxyWithoutHooks(options)
  ) {
    throw new TypeError("FetchData options must be a plain object");
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("FetchData options must be a plain object");
  }

  const allowed = new Set<PropertyKey>([
    "modulePath",
    "projectDir",
    "projectId",
    "cacheScope",
    "signal",
    "workerScopeId",
    "workerGenerationId",
  ]);
  const values = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new TypeError(`Unknown FetchData option: ${String(key)}`);
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(options, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(
        `FetchData option ${key} must be an own enumerable data property`,
      );
    }
    values.set(key, descriptor.value);
  }

  const optionalBoundedString = (
    key: "modulePath" | "projectDir",
    limit: number,
  ): string | undefined => {
    const value = values.get(key);
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new TypeError(`FetchData option ${key} must be a string`);
    }
    if (value.length > limit) {
      throw new RangeError(
        `FetchData option ${key} must not exceed ${limit} characters`,
      );
    }
    return value;
  };

  const projectIdValue = values.get("projectId");
  const cacheScopeValue = values.get("cacheScope");
  const workerGeneration = snapshotWorkerGenerationIdentity(
    values.get("workerScopeId"),
    values.get("workerGenerationId"),
  );
  return Object.freeze({
    modulePath: optionalBoundedString(
      "modulePath",
      MAX_DATA_MODULE_PATH_CHARACTERS,
    ),
    projectDir: optionalBoundedString(
      "projectDir",
      MAX_DATA_PROJECT_DIR_CHARACTERS,
    ),
    projectId: projectIdValue === undefined ? undefined : requireDataProjectId(projectIdValue),
    cacheScope: cacheScopeValue === undefined || cacheScopeValue === null
      ? cacheScopeValue
      : snapshotDataCacheScope(cacheScopeValue),
    signal: snapshotAbortSignal(values.get("signal")),
    workerScopeId: workerGeneration?.scopeId,
    workerGenerationId: workerGeneration?.generationId,
  });
}

function snapshotDataFetcherOptions(options: unknown): Readonly<DataFetcherOptions> {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxyWithoutHooks(options)
  ) {
    throw new TypeError("DataFetcher options must be a plain object");
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("DataFetcher options must be a plain object");
  }

  const snapshot: DataFetcherOptions = {};
  for (const key of Reflect.ownKeys(options)) {
    if (
      typeof key !== "string" ||
      (key !== "staticPathsTimeoutMs" && key !== "executionAdmission")
    ) {
      throw new TypeError(`Unknown DataFetcher option: ${String(key)}`);
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(options, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`DataFetcher option ${key} must be an enumerable data property`);
    }
    if (key === "staticPathsTimeoutMs") {
      snapshot.staticPathsTimeoutMs = descriptor.value as number | undefined;
    } else {
      if (
        descriptor.value !== undefined &&
        !(descriptor.value instanceof DataExecutionAdmission)
      ) {
        throw new TypeError(
          "DataFetcher executionAdmission must be a DataExecutionAdmission instance",
        );
      }
      snapshot.executionAdmission = descriptor.value as
        | DataExecutionAdmission
        | undefined;
    }
  }
  return Object.freeze(snapshot);
}

export class DataFetcher {
  private cacheManager: CacheManager;
  private serverFetcher: ServerDataFetcher;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;
  private destroyed = false;

  constructor(options: DataFetcherOptions = {}) {
    if (arguments.length > 1) {
      throw new TypeError("DataFetcher accepts at most one options argument");
    }
    const snapshot = snapshotDataFetcherOptions(options);
    const executionAdmission = snapshot.executionAdmission ??
      defaultDataExecutionAdmission;
    // Validate all fallible options before allocating the cache and its cleanup
    // resources. StaticPathsFetcher has no lifecycle resources of its own.
    this.pathsFetcher = new StaticPathsFetcher({
      timeoutMs: snapshot.staticPathsTimeoutMs,
      executionAdmission,
    });
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher(executionAdmission);
    this.staticFetcher = new StaticDataFetcher(this.cacheManager, {
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
    let snapshotOptions: Readonly<FetchDataOptions>;
    try {
      snapshotOptions = snapshotFetchDataOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const {
      modulePath,
      projectDir,
      projectId: suppliedProjectId,
      cacheScope: suppliedScope,
      signal: suppliedSignal,
      workerScopeId,
      workerGenerationId,
    } = snapshotOptions;

    // The renderer owns the ordinary context object, but this remains a public
    // JavaScript boundary. Snapshot every mutable field exactly once before
    // deriving cancellation, cache identity, execution input, or telemetry so a
    // Proxy/accessor cannot make those consumers observe different requests.
    let requestContext: DataContext;
    let callerSignal: AbortSignal | undefined;
    try {
      requestContext = cloneServerDataContext(context);
      callerSignal = combineAbortSignals(
        getDataRequestSignal(requestContext.request),
        suppliedSignal,
      );
    } catch (error) {
      return Promise.reject(error);
    }
    if (callerSignal && isAbortSignalAborted(callerSignal)) {
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
            requestContext,
            isolationOptions,
          ) as Promise<DataResult<TProps>>;
        }
        if (useStatic) {
          return this.staticFetcher.fetch(
            executionPageModule,
            requestContext,
            {
              modulePath,
              projectId: trustedProjectId,
              cacheScope: authoritativeScope,
              signal: callerSignal,
              workerScopeId: workerGeneration?.scopeId,
              workerGenerationId: workerGeneration?.generationId,
            },
          ) as Promise<DataResult<TProps>>;
        }
        return Promise.resolve({ props: {} } as DataResult<TProps>);
      },
      {
        "data.fetch_type": fetchType,
        "data.mode": mode,
        "data.pathname": requestContext.url.pathname,
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
    const snapshot = snapshotDataCachePattern(pattern);
    this.staticFetcher.invalidatePendingCacheWrites({
      pattern: snapshot,
    });

    if (snapshot !== undefined) {
      this.cacheManager.clearPattern(snapshot);
      return;
    }

    this.cacheManager.clear();
  }

  clearCacheForScope(scope: DataCacheScope, pattern?: string): void {
    if (this.destroyed) return;
    const snapshot = snapshotDataCacheScope(scope);
    const patternSnapshot = snapshotDataCachePattern(pattern);
    this.staticFetcher.invalidatePendingCacheWrites({
      pattern: patternSnapshot,
      scope: snapshot,
    });
    this.cacheManager.clearScope(snapshot, patternSnapshot);
  }

  clearCacheForRoute(scope: DataCacheScope, pathname: string): void {
    if (this.destroyed) return;
    const snapshot = snapshotDataCacheScope(scope);
    const pathnameSnapshot = snapshotDataCachePathname(pathname);
    this.staticFetcher.invalidatePendingCacheWrites({
      scope: snapshot,
      pathname: pathnameSnapshot,
    });
    this.cacheManager.clearRoute(snapshot, pathnameSnapshot);
  }

  clearCacheForProject(projectId: string, pattern?: string): void {
    if (this.destroyed) return;
    const projectSnapshot = requireDataProjectId(projectId, "Data cache projectId");
    const patternSnapshot = snapshotDataCachePattern(pattern);
    this.staticFetcher.invalidatePendingCacheWrites({
      projectId: projectSnapshot,
      pattern: patternSnapshot,
    });
    this.cacheManager.clearProject(projectSnapshot, patternSnapshot);
  }

  clearCacheForProjectRoute(projectId: string, pathname: string): void {
    if (this.destroyed) return;
    const projectSnapshot = requireDataProjectId(projectId, "Data cache projectId");
    const pathnameSnapshot = snapshotDataCachePathname(pathname);
    this.staticFetcher.invalidatePendingCacheWrites({
      projectId: projectSnapshot,
      pathname: pathnameSnapshot,
    });
    this.cacheManager.clearProjectRoute(projectSnapshot, pathnameSnapshot);
  }

  clearCacheForRouteAcrossScopes(pathname: string): void {
    if (this.destroyed) return;
    const snapshot = snapshotDataCachePathname(pathname);
    this.staticFetcher.invalidatePendingCacheWrites({ pathname: snapshot });
    this.cacheManager.clearRouteAcrossScopes(snapshot);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staticFetcher.invalidatePendingCacheWrites({});
    this.cacheManager.destroy();
  }
}
