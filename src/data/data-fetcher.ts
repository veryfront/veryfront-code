import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import { ServerDataFetcher, type ServerDataFetchOptions } from "./server-data-fetcher.ts";
import { StaticDataFetcher } from "./static-data-fetcher.ts";
import { StaticPathsFetcher } from "./static-paths-fetcher.ts";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { INITIALIZATION_ERROR, INPUT_VALIDATION_FAILED, INVALID_ARGUMENT } from "#veryfront/errors";
import { isAbsolute } from "#veryfront/platform/compat/path/index.ts";
import { parseDataContext } from "./result-validation.ts";

function invalidPageModule(): Error {
  return INPUT_VALIDATION_FAILED.create({
    detail: "DataFetcher received an invalid page module",
  });
}

function assertPageModule(pageModule: PageWithData): void {
  if (
    pageModule === null ||
    (typeof pageModule !== "object" && typeof pageModule !== "function")
  ) {
    throw invalidPageModule();
  }
}

function snapshotPageDataModule<T>(pageModule: PageWithData<T>): PageWithData<T> {
  assertPageModule(pageModule);
  try {
    const getServerData = Reflect.get(pageModule, "getServerData");
    const getStaticData = Reflect.get(pageModule, "getStaticData");
    return Object.freeze({
      default: undefined,
      ...(typeof getServerData === "function" ? { getServerData } : {}),
      ...(typeof getStaticData === "function" ? { getStaticData } : {}),
    });
  } catch {
    throw invalidPageModule();
  }
}

function snapshotStaticPathsModule(pageModule: PageWithData): PageWithData {
  assertPageModule(pageModule);
  try {
    const getStaticPaths = Reflect.get(pageModule, "getStaticPaths");
    return Object.freeze({
      default: undefined,
      ...(typeof getStaticPaths === "function" ? { getStaticPaths } : {}),
    });
  } catch {
    throw invalidPageModule();
  }
}

function snapshotFetchOptions(
  options: FetchDataOptions | undefined,
): Readonly<FetchDataOptions> | undefined {
  if (options === undefined) return undefined;
  if (options === null || typeof options !== "object") {
    throw INVALID_ARGUMENT.create({ detail: "Data fetch options must be an object" });
  }

  let modulePath: unknown;
  let projectDir: unknown;
  try {
    modulePath = Reflect.get(options, "modulePath");
    projectDir = Reflect.get(options, "projectDir");
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "Data fetch options must be readable" });
  }

  if (modulePath === undefined && projectDir === undefined) return undefined;
  if (
    typeof modulePath !== "string" || modulePath.length === 0 || modulePath.length > 4_096 ||
    modulePath.includes("\0") || !isAbsolute(modulePath) ||
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > 4_096 || projectDir.includes("\0") || !isAbsolute(projectDir)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Data fetch isolation requires absolute modulePath and projectDir values",
    });
  }

  return Object.freeze({ modulePath, projectDir });
}

/**
 * Options for isolated data fetching. Passed through to ServerDataFetcher
 * when worker isolation is enabled.
 */
export interface FetchDataOptions {
  /** Absolute path to the module containing `getServerData`. */
  modulePath?: string;
  /** Project directory used to scope the isolated worker. */
  projectDir?: string;
}

/**
 * Execute page data loaders with validation, timeouts, and static-data caching.
 *
 * Call {@link destroy} when the fetcher is no longer needed.
 */
export class DataFetcher {
  private cacheManager: CacheManager;
  private serverFetcher: ServerDataFetcher;
  private staticFetcher: StaticDataFetcher;
  private pathsFetcher: StaticPathsFetcher;
  private readonly anonymousDataSourceIds = new WeakMap<object, string>();
  private nextAnonymousDataSourceId = 0;
  private destroyed = false;

  /**
   * Create a data fetcher.
   *
   * @param _adapter Retained for compatibility. The current implementation does not use it.
   */
  constructor(_adapter?: unknown) {
    this.cacheManager = new CacheManager();
    this.serverFetcher = new ServerDataFetcher();
    this.staticFetcher = new StaticDataFetcher(this.cacheManager);
    this.pathsFetcher = new StaticPathsFetcher();
  }

  /**
   * Execute the loader selected for the runtime mode.
   *
   * Development prefers `getServerData`. Production prefers `getStaticData`.
   * When isolation options are supplied, both paths are required.
   */
  async fetchData<T = unknown>(
    pageModule: PageWithData<T>,
    context: DataContext,
    mode: "development" | "production" = "development",
    options?: FetchDataOptions,
  ): Promise<DataResult<T>> {
    this.assertActive();
    if (mode !== "development" && mode !== "production") {
      throw INVALID_ARGUMENT.create({
        detail: "Data fetch mode must be development or production",
      });
    }
    const moduleSnapshot = snapshotPageDataModule(pageModule);
    const optionSnapshot = snapshotFetchOptions(options);
    const preferServerData = mode === "development" || !moduleSnapshot.getStaticData;
    const useServer = preferServerData && !!moduleSnapshot.getServerData;
    const useStatic = !useServer && !!moduleSnapshot.getStaticData;

    const fetchType: "server" | "static" | "none" = useServer
      ? "server"
      : useStatic
      ? "static"
      : "none";
    const validatedContext = parseDataContext(context, useServer);

    const isolationOptions: ServerDataFetchOptions | undefined = optionSnapshot
      ? { modulePath: optionSnapshot.modulePath, projectDir: optionSnapshot.projectDir }
      : undefined;
    const staticDataSource = useStatic
      ? this.getStaticDataSource(pageModule, optionSnapshot?.modulePath)
      : undefined;

    return await withSpan(
      SpanNames.DATA_FETCH,
      () => {
        if (useServer) {
          return this.serverFetcher.fetch(moduleSnapshot, validatedContext, isolationOptions);
        }
        if (useStatic) {
          return this.staticFetcher.fetch(moduleSnapshot, validatedContext, staticDataSource);
        }
        return Promise.resolve({ props: {} });
      },
      {
        "data.fetch_type": fetchType,
        "data.mode": mode,
        "data.pathname_hash": hashString(validatedContext.url.pathname),
      },
    ) as DataResult<T>;
  }

  /** Execute and validate a module's `getStaticPaths` loader. */
  async getStaticPaths(pageModule: PageWithData): Promise<StaticPathsResult | null> {
    this.assertActive();
    return await this.pathsFetcher.fetch(snapshotStaticPathsModule(pageModule));
  }

  /**
   * Clear cached static data.
   *
   * A non-empty pattern clears matching internal cache keys. An omitted or
   * empty pattern clears every entry owned by this fetcher.
   */
  clearCache(pattern?: string): void {
    this.assertActive();
    if (
      pattern !== undefined &&
      (typeof pattern !== "string" || pattern.length > 4_096 || pattern.includes("\0"))
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Cache clear pattern must be a string of at most 4096 characters",
      });
    }
    this.staticFetcher.invalidate(pattern);
    if (pattern) {
      this.cacheManager.clearPattern(pattern);
      return;
    }

    this.cacheManager.clear();
  }

  /** Release cache resources. A destroyed fetcher cannot be reused. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.staticFetcher.destroy();
    this.cacheManager.destroy();
  }

  /** Resolve a stable cache namespace for one page or layout module. */
  private getStaticDataSource(pageModule: PageWithData, modulePath?: string): string {
    if (modulePath) return `path:${hashString(modulePath)}`;

    const existing = this.anonymousDataSourceIds.get(pageModule);
    if (existing) return existing;

    const created = `module:${++this.nextAnonymousDataSourceId}`;
    this.anonymousDataSourceIds.set(pageModule, created);
    return created;
  }

  /** Reject operations after the fetcher has released its resources. */
  private assertActive(): void {
    if (!this.destroyed) return;
    throw INITIALIZATION_ERROR.create({ detail: "DataFetcher has been destroyed" });
  }
}
