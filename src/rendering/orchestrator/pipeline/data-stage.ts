import { buildQueryAwareCacheKey } from "#veryfront/cache/keys.ts";
import { DataFetcher, type FetchDataOptions } from "#veryfront/data/index.ts";
import type { DataContext, PageWithData } from "#veryfront/data/types.ts";
import { FILE_NOT_FOUND, RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { LayoutItem } from "#veryfront/types";
import { rendererLogger as logger } from "#veryfront/utils";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { extractRouteParams as extractRouteParamsShared } from "#veryfront/utils/route-path-utils.ts";
import { withTimeoutThrow } from "../../utils/stream-utils.ts";
import {
  collectModulesToLoad,
  DATA_FETCH_TIMEOUT_MS,
  hasDataFetchingFunction,
  type LoadedModule,
  MODULE_LOAD_TIMEOUT_MS,
  type ModuleToLoad,
} from "../module-collection.ts";
import type { RenderOptions } from "../types.ts";

const renderPageLog = logger.component("render-page");

export interface DataResolutionResult {
  params: Record<string, string | string[]>;
  pageProps: Record<string, unknown>;
  layoutProps: Map<string, Record<string, unknown>>;
}

interface FetchedDataResult {
  type: "page" | "layout";
  id: string;
  result: Awaited<ReturnType<DataFetcher["fetchData"]>> | null;
  error: Error | null;
}

export interface ResolveDataFetchingStageOptions {
  slug: string;
  pagePath: string;
  nestedLayouts: LayoutItem[];
  options?: RenderOptions;
  projectDir: string;
  mode: "development" | "production";
  dataFetcher: DataFetcher;
  loadModule: (filePath: string) => Promise<Record<string, unknown>>;
}

/**
 * Load modules in parallel and return only successfully loaded ones.
 *
 * Page modules are critical and fail the render when they cannot load. Layout
 * modules are non-critical and only emit a warning so the page can continue.
 */
export async function loadModulesInParallelStage(
  modules: ModuleToLoad[],
  loadModule: (filePath: string) => Promise<Record<string, unknown>>,
): Promise<LoadedModule[]> {
  const results = await Promise.all(
    modules.map(async (m) => {
      try {
        const mod = await loadModule(m.path);
        return { ...m, mod, error: null as Error | null };
      } catch (error) {
        return { ...m, mod: null, error: error as Error };
      }
    }),
  );

  const loaded: LoadedModule[] = [];
  const criticalFailures: Array<{ path: string; error: string }> = [];

  for (const result of results) {
    if (result.mod && !result.error) {
      loaded.push({ type: result.type, id: result.id, mod: result.mod });
      continue;
    }

    if (!result.error) continue;

    const errorMessage = result.error.message;

    if (result.type === "page") {
      criticalFailures.push({ path: result.path, error: errorMessage });
      renderPageLog.error("Critical page module failed to load", {
        path: result.path,
        error: errorMessage,
      });
      continue;
    }

    renderPageLog.warn("Layout module failed to load (non-critical)", {
      path: result.path,
      error: errorMessage,
    });
  }

  if (criticalFailures.length > 0) {
    const failedDetails = criticalFailures
      .map((f) => `${f.path}: ${f.error}`)
      .join("\n");
    throw RENDER_ERROR.create({
      detail: `Critical page module(s) failed to load:\n${failedDetails}`,
      context: {
        criticalFailures,
        loadedCount: loaded.length,
        totalModules: modules.length,
      },
    });
  }

  return loaded;
}

/** Resolve page + layout data props from module data-fetching hooks. */
export async function resolveDataFetchingStage({
  slug,
  pagePath,
  nestedLayouts,
  options,
  projectDir,
  mode,
  dataFetcher,
  loadModule,
}: ResolveDataFetchingStageOptions): Promise<DataResolutionResult> {
  let params: Record<string, string | string[]> = options?.params ? { ...options.params } : {};
  const pageProps: Record<string, unknown> = {};
  const layoutProps = new Map<string, Record<string, unknown>>();

  if (!options?.request || !options?.url) {
    return { params, pageProps, layoutProps };
  }

  if (Object.keys(params).length === 0) {
    renderPageLog.debug("Extracting route params", {
      slug,
      pagePath,
    });

    const extracted = extractRouteParamsShared(pagePath, slug);
    if (extracted.matched) {
      params = extracted.params;
      renderPageLog.debug("Extracted route params", { slug, params });
    }
  }

  const dataContext: DataContext = {
    params,
    query: options.url.searchParams,
    request: options.request,
    url: options.url,
  };

  const fileExtension = getExtensionName(pagePath);
  const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
  const isInPagesDir = pagePath.includes("/pages/");
  const isInAppDir = pagePath.includes("/app/");

  const modulesToLoad = collectModulesToLoad(
    pagePath,
    isComponentPage,
    isInPagesDir || isInAppDir,
    nestedLayouts,
  );

  if (modulesToLoad.length === 0) {
    return { params, pageProps, layoutProps };
  }

  const loadedModules = await withSpan(
    SpanNames.RENDER_LOAD_MODULES,
    () =>
      withTimeoutThrow(
        loadModulesInParallelStage(modulesToLoad, loadModule),
        MODULE_LOAD_TIMEOUT_MS,
        `Module loading for ${slug}`,
      ),
    { "render.module_count": modulesToLoad.length },
  );

  const dataJobs = loadedModules.filter((m) => hasDataFetchingFunction(m.mod));
  if (dataJobs.length === 0) {
    return { params, pageProps, layoutProps };
  }

  const dataResults = await withSpan(
    SpanNames.RENDER_FETCH_DATA,
    () =>
      withTimeoutThrow(
        Promise.all(
          dataJobs.map(async (job) => {
            try {
              const jobPath = (job as LoadedModule & { path?: string }).path;
              const fetchOptions: FetchDataOptions = {
                modulePath: jobPath,
                projectDir,
              };
              const result = await dataFetcher
                .fetchData(job.mod as PageWithData, dataContext, mode, fetchOptions);
              return { ...job, result, error: null as Error | null };
            } catch (error) {
              return { ...job, result: null, error: error as Error };
            }
          }),
        ),
        DATA_FETCH_TIMEOUT_MS,
        `Data fetch for ${slug}`,
      ),
    { "render.data_job_count": dataJobs.length },
  );

  applyFetchedDataResults(slug, dataResults, pageProps, layoutProps);

  return { params, pageProps, layoutProps };
}

function applyFetchedDataResults(
  slug: string,
  dataResults: FetchedDataResult[],
  pageProps: Record<string, unknown>,
  layoutProps: Map<string, Record<string, unknown>>,
): void {
  for (const { type, id, result, error } of dataResults) {
    if (error) throw error;
    if (!result) continue;

    if (result.notFound) {
      throw FILE_NOT_FOUND.create({
        detail: "Page/Layout returned notFound",
        context: { slug, component: id },
      });
    }

    if (result.redirect) {
      throw RENDER_ERROR.create({
        detail: `Redirect to ${result.redirect.destination}`,
        context: { slug, redirect: result.redirect },
      });
    }

    if (!result.props) continue;

    if (type === "page") {
      Object.assign(pageProps, result.props as Record<string, unknown>);
    } else {
      layoutProps.set(id, result.props as Record<string, unknown>);
    }
  }
}

export function buildPipelineCacheKey(
  slug: string,
  options: RenderOptions | undefined,
  queryParamOptions: import("#veryfront/cache/keys.ts").QueryParamCacheOptions | undefined,
): string | null {
  if (options?.cacheKey) return options.cacheKey;
  const req = options?.request;
  if (req) {
    const hasAuth = req.headers.has("authorization") ||
      req.headers.has("cookie") ||
      req.headers.has("x-api-key");
    if (hasAuth) return null;
  }

  const url = options?.url;
  if (!url) return slug;

  return buildQueryAwareCacheKey(slug, url, queryParamOptions);
}
