/**
 * Render Pipeline
 *
 * Orchestrates the complete page rendering process through 10 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Speculative Cache Check (parallel)
 * 4. Route Params - 5. Two-Phase Data Fetching - 6. Await Cache Check
 * 7. Bundle Preparation - 8. Layout Application - 9. SSR Rendering - 10. Result Assembly
 *
 * Performance optimizations:
 * - Speculative cache check runs in parallel with data fetching
 * - Two-phase data fetching: load all modules first, then fetch all data in parallel
 * - Supports both /pages/ and /app/ router directories
 *
 * @module rendering/orchestrator/pipeline
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { createBuildVersion } from "#veryfront/utils/version.ts";
import { profilePhase, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { FILE_NOT_FOUND, RENDER_ERROR, VeryfrontError } from "#veryfront/errors";
import { buildQueryAwareCacheKey } from "#veryfront/cache/keys.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import {
  extractRelativePath as extractRelativePathShared,
  extractRouteParams as extractRouteParamsShared,
  extractRouterBasePath,
  type RouterDirectories,
} from "#veryfront/utils/route-path-utils.ts";
import {
  extractRenderedCssHash,
  hasRenderedReleaseAssetCss,
  serializeLayoutProps,
  serializeLayouts,
} from "./pipeline-helpers.ts";
import { join } from "#veryfront/compat/path";
import type { EntityInfo, MdxBundle, PageBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { CacheLookupResult } from "../cache/cache-coordinator.ts";
import type { PageRenderer } from "../page-renderer.ts";
import type { PageResolver } from "../page-resolution/index.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./types.ts";
import { DataFetcher, type FetchDataOptions } from "#veryfront/data/index.ts";
import type { DataContext, PageWithData } from "#veryfront/data/types.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";
import { LAYOUT_EXTENSIONS } from "../layouts/types.ts";
import type { LayoutItem } from "#veryfront/types";
import { withTimeout, withTimeoutThrow } from "../utils/stream-utils.ts";
import { extractCandidates, generateTailwindCSS } from "#veryfront/html/styles-builder/index.ts";
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { getReadyManifestForRender } from "#veryfront/release-assets/manifest-cache.ts";
import { createEsmCache, createModuleCache, loadModule } from "./module-loader/index.ts";
import type { ModuleLoaderConfig } from "./module-loader/index.ts";
import {
  getCSSImports,
  runWithCSSCollector,
} from "#veryfront/modules/react-loader/css-import-collector.ts";
import { assembleRenderResult } from "./render-result-assembly.ts";
import { isMdxEsmExportMismatchError, recoverStaleMdxEsmPreviewCaches } from "../page-rendering.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import {
  type ClientPageIslandPlan,
  planClientPageIsland,
} from "#veryfront/rendering/rsc/page-island.ts";
import { determineClientModuleStrategy } from "#veryfront/rendering/rsc/client-module-strategy.ts";

// Extracted modules
import { EMPTY_LAYOUT_RESULT, isDotPath } from "./path-helpers.ts";
import {
  __injectCssCacheForTests,
  cachePageCss,
  CSS_SSR_TIMEOUT_MS,
  getCachedPageCss,
  getPageCssCacheKey,
} from "./css-cache.ts";
import {
  collectModulesToLoad,
  DATA_FETCH_TIMEOUT_MS,
  hasDataFetchingFunction,
  type LoadedModule,
  MODULE_LOAD_TIMEOUT_MS,
  type ModuleToLoad,
  SSR_RENDER_TIMEOUT_MS,
} from "./module-collection.ts";
import { mergeFrontmatter, resolveDocumentMetadata } from "./html-head.ts";

const renderPageLog = logger.component("render-page");
const renderPipelineLog = logger.component("render-pipeline");
const resolvePageDataLog = logger.component("resolve-page-data");
const CSS_GENERATION_ERROR_MESSAGE = "CSS generation failed";
// Re-export test helper for backward compatibility
export { __injectCssCacheForTests } from "./css-cache.ts";

/**
 * Minimal cache interface used by RenderPipeline.
 * Decoupled from the concrete CacheCoordinator class so that Renderer
 * can supply a context-aware adapter without an unsafe `as any` cast.
 */
export interface PipelineCacheCoordinator {
  checkCache(slug: string, cacheKey?: string): Promise<CacheLookupResult>;
  persistResult(result: RenderResult, slug: string, cacheKey?: string): Promise<void>;
}

export interface RenderPipelineConfig {
  pageResolver: PageResolver;
  cacheCoordinator: PipelineCacheCoordinator;
  pageRenderer: PageRenderer;
  layoutOrchestrator: LayoutOrchestrator;
  ssrOrchestrator: SSROrchestrator;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  projectDir: string;
  /** Whether browser module URLs may use the local filesystem endpoint. */
  isLocalProject?: boolean;
  /** Stable project identity used to isolate transformed module caches. */
  projectId?: string;
  /** Release or preview source used to isolate transformed module caches. */
  contentSourceId?: string;
  /** Project configuration used to resolve the matching React runtime. */
  config?: VeryfrontConfig;
  /** Configured App and Pages Router roots. */
  directories?: RouterDirectories;
  /** Query parameter handling for cache keys (from config.cache.queryParams) */
  queryParamOptions?: import("#veryfront/cache/keys.ts").QueryParamCacheOptions;
}

interface DataResolutionResult {
  params: Record<string, string | string[]>;
  pageProps: Record<string, unknown>;
  layoutProps: Map<string, Record<string, unknown>>;
}

interface PageMetadataResult {
  frontmatter: Record<string, unknown>;
  headings: Array<{ id: string; text: string; level: number }>;
}

interface PageCssResult {
  css: string | undefined;
  cssAction: PageDataResponse["cssAction"] | undefined;
  cssError: string | undefined;
}

interface FetchedDataResult {
  type: "page" | "layout";
  id: string;
  result: Awaited<ReturnType<RenderPipeline["dataFetcher"]["fetchData"]>> | null;
  error: Error | null;
}

export class RenderPipeline {
  private config: RenderPipelineConfig;
  private dataFetcher: DataFetcher;
  private moduleLoaderConfig: ModuleLoaderConfig;
  private reactVersionPromise: Promise<string> | null = null;

  constructor(config: RenderPipelineConfig) {
    this.config = config;
    this.dataFetcher = new DataFetcher(config.adapter);
    this.moduleLoaderConfig = {
      projectDir: config.projectDir,
      projectId: config.projectId ?? config.projectDir,
      contentSourceId: config.contentSourceId,
      adapter: config.adapter,
      mode: config.mode,
      moduleCache: createModuleCache(),
      esmCache: createEsmCache(),
    };
  }

  /** Release resources owned by this pipeline. */
  destroy(): void {
    this.dataFetcher.destroy();
    this.reactVersionPromise = null;
  }

  private getReactVersion(): Promise<string> {
    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.config.projectDir,
      config: this.config.config,
    });
    return this.reactVersionPromise;
  }

  private planClientPageIsland(
    pageInfo: EntityInfo,
    nestedLayouts: LayoutItem[],
    options?: RenderOptions,
  ): Promise<ClientPageIslandPlan | null> {
    const layouts = nestedLayouts
      .map((layout) => ({
        kind: layout.kind,
        path: layout.componentPath ?? layout.path ?? "",
      }))
      .filter((layout) => Boolean(layout.path));

    return planClientPageIsland({
      pageSource: pageInfo.entity.content ?? "",
      pagePath: pageInfo.entity.path,
      projectDir: this.config.projectDir,
      appDir: this.config.directories?.app ?? this.config.config?.directories?.app ?? "app",
      layouts,
      fs: this.config.adapter.fs,
      strategy: determineClientModuleStrategy({
        isLocalProject: this.config.isLocalProject,
        environment: options?.environment,
      }),
    });
  }

  /**
   * Build an immutable loader configuration for one render request. A pipeline can
   * serve concurrent requests, so request identity must not be written into shared
   * mutable state while module transforms are in flight.
   */
  private async resolveModuleLoaderConfig(
    options?: Pick<RenderOptions, "projectId" | "contentSourceId">,
  ): Promise<ModuleLoaderConfig> {
    return {
      ...this.moduleLoaderConfig,
      projectId: options?.projectId ?? this.config.projectId ?? this.config.projectDir,
      contentSourceId: options?.contentSourceId ?? this.config.contentSourceId,
      reactVersion: await this.getReactVersion(),
    };
  }

  /**
   * Clear the module cache to force re-transformation on next render.
   * Called by poke/invalidation handlers to ensure fresh modules are loaded.
   */
  clearModuleCache(): void {
    this.moduleLoaderConfig.moduleCache.clear();
    this.moduleLoaderConfig.esmCache.clear();
  }

  private loadModule(
    filePath: string,
    moduleLoaderConfig: ModuleLoaderConfig,
  ): Promise<Record<string, unknown>> {
    return loadModule(filePath, moduleLoaderConfig);
  }

  private async resolveCssFromRenderedHtml(
    html: string,
    projectSlug: string | undefined,
  ): Promise<string | undefined> {
    const cssHash = extractRenderedCssHash(html);
    if (!cssHash) return undefined;

    const cachedCss = await getCSSByHashAsync(cssHash);
    if (cachedCss) return cachedCss;

    return await regenerateCSSByHash(cssHash, projectSlug);
  }

  /**
   * Load modules in parallel and return only successfully loaded ones.
   *
   * IMPORTANT: Page modules are considered critical - if a page module fails to load,
   * we throw an error instead of silently continuing with missing props. This prevents
   * users from seeing broken pages with no indication of the problem.
   *
   * Layout modules are considered non-critical - their failures are logged as warnings
   * and the page continues to render (possibly without that layout's data).
   */
  private async loadModulesInParallel(
    modules: ModuleToLoad[],
    options?: Pick<RenderOptions, "projectId" | "contentSourceId">,
  ): Promise<LoadedModule[]> {
    const moduleLoaderConfig = await this.resolveModuleLoaderConfig(options);
    const results = await Promise.all(
      modules.map(async (m) => {
        try {
          const mod = await this.loadModule(m.path, moduleLoaderConfig);
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

  /**
   * Resolve page + layout data props from module data-fetching hooks.
   * Shared by both renderPage() and resolvePageData() to keep behavior aligned.
   */
  private async resolveDataFetching(
    slug: string,
    pagePath: string,
    nestedLayouts: LayoutItem[],
    options?: RenderOptions,
  ): Promise<DataResolutionResult> {
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

      const extracted = extractRouteParamsShared(pagePath, slug, this.config.directories);
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
    const routerPath = extractRouterBasePath(pagePath, this.config.directories);

    const modulesToLoad = collectModulesToLoad(
      pagePath,
      isComponentPage,
      routerPath.type !== null,
      nestedLayouts,
    );

    if (modulesToLoad.length === 0) {
      return { params, pageProps, layoutProps };
    }

    const loadedModules = await profilePhase(
      "render.load_modules",
      () =>
        withSpan(
          SpanNames.RENDER_LOAD_MODULES,
          () =>
            withTimeoutThrow(
              this.loadModulesInParallel(modulesToLoad, options),
              MODULE_LOAD_TIMEOUT_MS,
              `Module loading for ${slug}`,
            ),
          { "render.module_count": modulesToLoad.length },
        ),
    );

    const dataJobs = loadedModules.filter((m) => hasDataFetchingFunction(m.mod));
    if (dataJobs.length === 0) {
      return { params, pageProps, layoutProps };
    }

    const dataResults = await profilePhase(
      "render.fetch_data",
      () =>
        withSpan(
          SpanNames.RENDER_FETCH_DATA,
          () =>
            withTimeoutThrow(
              Promise.all(
                dataJobs.map(async (job) => {
                  try {
                    const jobPath = (job as LoadedModule & { path?: string }).path;
                    const fetchOptions: FetchDataOptions | undefined = jobPath
                      ? {
                        modulePath: jobPath,
                        projectDir: this.config.projectDir,
                      }
                      : undefined;
                    const result = await this.dataFetcher
                      .fetchData(
                        job.mod as PageWithData,
                        dataContext,
                        this.config.mode,
                        fetchOptions,
                      );
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
        ),
    );

    this.applyFetchedDataResults(slug, dataResults, pageProps, layoutProps);

    return { params, pageProps, layoutProps };
  }

  private applyFetchedDataResults(
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

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pipelineStartTime = performance.now();
    const timing: Record<string, number> = {};
    const projectSlug = options?.projectSlug || options?.projectId || "unknown";
    const projectId = options?.projectId ?? this.config.projectId ?? this.config.projectDir;
    const cacheKey = this.buildCacheKey(slug, options);

    let cacheResult: Awaited<ReturnType<typeof this.config.cacheCoordinator.checkCache>> | null =
      null;

    const shouldCache = cacheKey !== null && options?.delivery !== "stream";

    if (shouldCache && !options?.skipCacheCheck) {
      const cacheCheckStart = performance.now();
      cacheResult = await this.config.cacheCoordinator.checkCache(slug, cacheKey);
      timing.cacheCheck = Math.round(performance.now() - cacheCheckStart);

      if (cacheResult?.cachedResult) {
        renderPipelineLog.debug("Cache HIT", { slug, projectSlug, timing });
        return cacheResult.cachedResult;
      }
    }

    setupSSRGlobals();

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    const renderOnce = () =>
      withSpan(
        "render.page",
        async () => {
          const { result } = await runWithCSSCollector(async () => {
            const pageResolveStart = performance.now();
            const pageInfo = await profilePhase(
              "render.resolve_page",
              () =>
                withSpan(
                  "render.resolve_page",
                  () => this.config.pageResolver.resolvePage(slug),
                  { "render.slug": slug },
                ),
            );
            timing.pageResolve = Math.round(performance.now() - pageResolveStart);

            const sourceFile = extractRelativePathShared(
              pageInfo.entity.path,
              this.config.projectDir,
            );

            try {
              const skipLayouts = isDotPath(slug, pageInfo.entity.path);

              const layoutCollectStart = performance.now();
              const layoutResult = skipLayouts ? EMPTY_LAYOUT_RESULT : await profilePhase(
                "render.collect_layouts",
                () =>
                  withSpan(
                    "render.collect_layouts",
                    () => this.config.layoutOrchestrator.collectLayouts(pageInfo),
                    { "render.slug": slug },
                  ),
              );
              timing.layoutCollect = Math.round(performance.now() - layoutCollectStart);

              const layoutPreloadPromise = !skipLayouts && layoutResult.nestedLayouts.length > 0
                ? this.config.layoutOrchestrator.preloadLayoutModules(layoutResult.nestedLayouts)
                : Promise.resolve();

              let dataFetchingProps: Record<string, unknown> | undefined;
              let resolvedParams: Record<string, string | string[]> = options?.params
                ? { ...options.params }
                : {};
              let layoutDataMap = new Map<string, Record<string, unknown>>();

              const dataFetchStart = performance.now();
              if (options?.request && options?.url) {
                await profilePhase(
                  "render.data_fetching",
                  () =>
                    withSpan(
                      "render.data_fetching",
                      async () => {
                        try {
                          const dataResolution = await this.resolveDataFetching(
                            slug,
                            pageInfo.entity.path,
                            layoutResult.nestedLayouts,
                            options,
                          );
                          resolvedParams = dataResolution.params;
                          dataFetchingProps = Object.keys(dataResolution.pageProps).length > 0
                            ? dataResolution.pageProps
                            : undefined;
                          layoutDataMap = dataResolution.layoutProps;
                        } catch (error) {
                          if (error instanceof VeryfrontError) throw error;

                          renderPageLog.error("Data fetching error", {
                            slug,
                            error: error instanceof Error ? error.message : String(error),
                          });
                          throw error;
                        }
                      },
                      { "render.slug": slug },
                    ),
                );
              }
              timing.dataFetch = Math.round(performance.now() - dataFetchStart);

              const hasResolvedParams = Object.keys(resolvedParams).length > 0;
              const mergedOptions = (dataFetchingProps || hasResolvedParams)
                ? {
                  ...options,
                  ...(hasResolvedParams ? { params: resolvedParams } : {}),
                  ...(dataFetchingProps
                    ? { props: { ...options?.props, ...dataFetchingProps } }
                    : {}),
                }
                : options;

              const bundlePrepStart = performance.now();
              const pageBundleResult = await profilePhase(
                "render.prepare_bundles",
                () =>
                  withSpan(
                    "render.prepare_bundles",
                    () =>
                      this.config.pageRenderer.preparePageBundles(
                        pageInfo,
                        slug,
                        cacheResult?.cachedModule,
                        mergedOptions,
                      ),
                    { "render.slug": slug },
                  ),
              );
              timing.bundlePrep = Math.round(performance.now() - bundlePrepStart);

              if (pageBundleResult.scriptResult) return pageBundleResult.scriptResult;

              if (!pageBundleResult.pageElement || !pageBundleResult.pageBundle) {
                throw RENDER_ERROR.create({
                  detail: "Failed to prepare page bundle",
                  context: { slug },
                });
              }

              const { pageElement, pageBundle } = pageBundleResult;
              const pageIslandPlan = await this.planClientPageIsland(
                pageInfo,
                layoutResult.nestedLayouts,
                mergedOptions,
              );
              const clientPageIsland = pageIslandPlan
                ? {
                  clientLayoutPaths: pageIslandPlan.clientLayouts.map((layout) => layout.path),
                  hasServerLayouts: pageIslandPlan.serverLayouts.length > 0,
                }
                : undefined;
              const serializedLayoutProps = serializeLayoutProps(
                layoutDataMap,
                this.config.projectDir,
              );
              const hydrationOptions = layoutDataMap.size > 0
                ? { ...mergedOptions, layoutProps: serializedLayoutProps }
                : mergedOptions;
              const renderOptions = clientPageIsland
                ? { ...hydrationOptions, clientPageIsland }
                : hydrationOptions;

              const mergedFrontmatter = {
                ...pageInfo.entity.frontmatter,
                ...(pageBundle as MdxBundle).frontmatter,
              };

              const headings = (pageBundle as PageBundle).headings || [];

              await layoutPreloadPromise;

              const layoutApplyStart = performance.now();
              const wrappedElement = await profilePhase(
                "render.apply_layouts",
                () =>
                  withSpan(
                    "render.apply_layouts",
                    () =>
                      this.config.layoutOrchestrator.applyLayoutsAndWrappers(
                        pageElement,
                        pageInfo,
                        layoutResult.layoutBundle,
                        layoutResult.nestedLayouts,
                        layoutDataMap,
                        options?.url,
                        resolvedParams,
                        mergedFrontmatter,
                        headings,
                        options?.projectSlug,
                        clientPageIsland,
                      ),
                    {
                      "render.slug": slug,
                      "render.layout_count": layoutResult.nestedLayouts.length,
                    },
                  ),
              );
              timing.layoutApply = Math.round(performance.now() - layoutApplyStart);

              // Snapshot CSS imports collected during module loading (before SSR rendering).
              // These are passed to the HTML generator to be included in the output.
              const collectedCSSImports = getCSSImports();

              const ssrStart = performance.now();
              const ssrResult = await profilePhase(
                "render.ssr",
                () =>
                  withSpan(
                    "render.ssr",
                    () =>
                      withTimeoutThrow(
                        this.config.ssrOrchestrator.performSSRRendering(
                          wrappedElement,
                          {
                            pageInfo,
                            pageBundle,
                            layoutBundle: layoutResult.layoutBundle,
                            nestedLayouts: layoutResult.nestedLayouts,
                            collectedMetadata: pageBundleResult.collectedMetadata,
                            slug,
                            cssImports: collectedCSSImports,
                          },
                          renderOptions,
                        ),
                        SSR_RENDER_TIMEOUT_MS,
                        `SSR rendering for ${slug}`,
                      ),
                    { "render.slug": slug, "render.delivery": mergedOptions?.delivery || "full" },
                  ),
              );
              timing.ssr = Math.round(performance.now() - ssrStart);

              if (collectedCSSImports.length > 0) {
                renderPipelineLog.debug("CSS imports collected for HTML generation", {
                  slug,
                  count: collectedCSSImports.length,
                  paths: collectedCSSImports.map((p) => p.split("/").pop()),
                });
              }

              const result = assembleRenderResult({
                slug,
                cacheKey,
                ssrResult,
                pageBundle: pageBundleResult.pageBundle,
                clientModuleCode: pageBundleResult.clientModuleCode,
                pageModuleType: pageBundleResult.pageModuleType,
                shouldCache,
                skipCachePersist: options?.skipCachePersist,
                cacheCoordinator: this.config.cacheCoordinator,
                logger: renderPipelineLog,
              });

              timing.total = Math.round(performance.now() - pipelineStartTime);
              renderPipelineLog.debug("Complete", { slug, timing });

              return result;
            } catch (error) {
              if (error instanceof Error) {
                (error as Error & { sourceFile?: string }).sourceFile = sourceFile;
              }
              throw error;
            }
          });
          return result;
        },
        {
          "render.slug": slug,
          "render.project_id": options?.projectId || this.config.projectDir,
          "render.mode": this.config.mode,
        },
      );

    try {
      return await renderOnce();
    } catch (error) {
      if (isMdxEsmExportMismatchError(error)) {
        const recovered = await recoverStaleMdxEsmPreviewCaches({
          adapter: this.config.adapter,
          projectId,
          projectSlug,
          contentSourceId: options?.contentSourceId,
          slug,
          pagePath: slug,
        });

        if (recovered) {
          cacheResult = null;
          renderPipelineLog.warn("Retrying page render after stale MDX ESM cache recovery", {
            slug,
            projectId,
            projectSlug,
            contentSourceId: options?.contentSourceId,
          });
          return await renderOnce();
        }
      }

      throw error;
    }
  }

  /** Resolve page data for SPA client-side navigation without rendering HTML. */
  async resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    setupSSRGlobals();

    const projectId = options?.projectId ?? this.config.projectId ?? this.config.projectDir;

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    const pageInfo = await profilePhase(
      "page_data.resolve_page",
      () => this.config.pageResolver.resolvePage(slug),
    );

    const skipLayouts = isDotPath(slug, pageInfo.entity.path);
    const layoutResult = skipLayouts ? EMPTY_LAYOUT_RESULT : await profilePhase(
      "page_data.collect_layouts",
      () => this.config.layoutOrchestrator.collectLayouts(pageInfo),
    );

    const pagePath = extractRelativePathShared(pageInfo.entity.path, this.config.projectDir);
    const fileExtension = getExtensionName(pageInfo.entity.path);
    const pageType = fileExtension as PageDataResponse["pageType"];
    const dataResolution = await profilePhase(
      "page_data.resolve_data",
      () =>
        this.resolveDataFetching(
          slug,
          pageInfo.entity.path,
          layoutResult.nestedLayouts,
          options,
        ),
    );

    const pageProps: Record<string, unknown> = dataResolution.pageProps;
    const params = dataResolution.params;
    const layoutProps = serializeLayoutProps(
      dataResolution.layoutProps,
      this.config.projectDir,
    );

    const { frontmatter, headings } = await profilePhase(
      "page_data.extract_mdx_metadata",
      () =>
        this.extractPageMetadata(
          pageType,
          pageInfo,
          slug,
          options,
          params,
        ),
    );

    const pageIslandPlan = await this.planClientPageIsland(
      pageInfo,
      layoutResult.nestedLayouts,
      options,
    );
    const clientLayoutPaths = new Set(
      pageIslandPlan?.clientLayouts.map((layout) => layout.path) ?? [],
    );
    const hydrationLayouts = pageIslandPlan
      ? layoutResult.nestedLayouts.filter((layout) =>
        clientLayoutPaths.has(layout.componentPath ?? layout.path ?? "")
      )
      : layoutResult.nestedLayouts;
    const layouts = serializeLayouts(hydrationLayouts, this.config.projectDir);

    const providers: string[] = [];

    const projectUpdatedAt = this.resolveProjectUpdatedAt();

    const appPath = pageIslandPlan
      ? undefined
      : await profilePhase("page_data.resolve_app_path", () => this.resolveAppPath());

    const { css, cssAction, cssError } = await profilePhase(
      "page_data.resolve_css",
      () => this.resolvePageDataCss(slug, options, projectUpdatedAt),
    );
    const requiresFullDocumentNavigation = pageType === "ts" || pageType === "js" ||
        (pageIslandPlan?.serverLayouts.length ?? 0) > 0
      ? true
      : undefined;

    resolvePageDataLog.debug("Resolved page data", {
      slug,
      pagePath,
      pageType,
      layoutCount: layouts.length,
      appPath,
      isolatedClientPage: pageIslandPlan ? true : undefined,
      requiresFullDocumentNavigation,
      headingsCount: headings.length,
      hasCss: !!css,
      cssAction,
      hasCssError: !!cssError,
    });

    return {
      slug,
      pagePath,
      pageType,
      layouts,
      providers,
      frontmatter,
      props: pageProps,
      params,
      layoutProps,
      buildVersion: createBuildVersion(projectUpdatedAt),
      appPath,
      isolatedClientPage: pageIslandPlan ? true : undefined,
      requiresFullDocumentNavigation,
      releaseId: options?.releaseId,
      releaseAssetModules: buildReleaseAssetModules(options?.releaseAssetManifest),
      headings,
      css,
      cssAction,
      cssError,
    };
  }

  private async extractPageMetadata(
    pageType: PageDataResponse["pageType"],
    pageInfo: Awaited<ReturnType<PageResolver["resolvePage"]>>,
    slug: string,
    options: RenderOptions | undefined,
    params: Record<string, string | string[]>,
  ): Promise<PageMetadataResult> {
    if (pageType !== "mdx" && pageType !== "md") {
      const mergedFrontmatter = mergeFrontmatter({
        pageInfo,
        pageBundle: {},
      });
      return {
        frontmatter: resolveDocumentMetadata(mergedFrontmatter).frontmatter,
        headings: [],
      };
    }

    const bundleResult = await this.config.pageRenderer.preparePageBundles(
      pageInfo,
      slug,
      undefined,
      {
        ...options,
        ...(Object.keys(params).length > 0 ? { params } : {}),
      },
    );
    const pageBundle = bundleResult.pageBundle;
    const mergedFrontmatter = mergeFrontmatter({
      pageInfo,
      pageBundle: { frontmatter: pageBundle?.frontmatter },
      collectedMetadata: bundleResult.collectedMetadata,
    });

    return {
      frontmatter: resolveDocumentMetadata(mergedFrontmatter).frontmatter,
      headings: pageBundle?.headings ?? [],
    };
  }

  private async resolveAppPath(): Promise<string | undefined> {
    for (const ext of LAYOUT_EXTENSIONS) {
      const candidatePath = join(this.config.projectDir, `components/app.${ext}`);
      if (await this.config.adapter.fs.exists(candidatePath)) {
        return extractRelativePathShared(candidatePath, this.config.projectDir);
      }
    }

    return undefined;
  }

  private resolveProjectUpdatedAt(): string | undefined {
    const fs = this.config.adapter?.fs;
    if (!fs || !isExtendedFSAdapter(fs) || !fs.isVeryfrontAdapter()) {
      return undefined;
    }

    const wrappedAdapter = fs.getUnderlyingAdapter() as {
      getProjectData?: () => { updated_at?: string } | undefined;
    };
    return wrappedAdapter.getProjectData?.()?.updated_at;
  }

  private async resolvePageDataCss(
    slug: string,
    options: RenderOptions | undefined,
    projectUpdatedAt: string | undefined,
  ): Promise<PageCssResult> {
    if (this.hasReadyReleaseCss(options)) {
      return { css: undefined, cssAction: "clear", cssError: undefined };
    }

    const cssCacheKey = getPageCssCacheKey(
      options?.projectId,
      options?.environment,
      slug,
      projectUpdatedAt,
    );

    const cachedCss = getCachedPageCss(cssCacheKey);
    if (cachedCss) {
      resolvePageDataLog.debug("CSS cache hit", { slug, cssLength: cachedCss.length });
      return { css: cachedCss, cssAction: undefined, cssError: undefined };
    }

    try {
      const renderResult = await profilePhase(
        "page_data.css.render_html",
        () =>
          withTimeout(
            this.renderPage(slug, {
              ...options,
              delivery: "string",
              skipCacheCheck: true,
              skipCachePersist: true,
            }),
            CSS_SSR_TIMEOUT_MS,
            `CSS SSR for ${slug}`,
          ),
      );

      if (!renderResult?.html) {
        return { css: undefined, cssAction: undefined, cssError: undefined };
      }

      let cssAction: PageDataResponse["cssAction"] | undefined;
      let css = await profilePhase(
        "page_data.css.extract_from_html",
        () =>
          this.resolveCssFromRenderedHtml(
            renderResult.html,
            options?.projectSlug ?? options?.projectId,
          ),
      );

      if (css) {
        resolvePageDataLog.debug("Reused SSR CSS for page data", {
          slug,
          cssLength: css.length,
          source: "rendered-html-hash",
        });
      } else if (hasRenderedReleaseAssetCss(renderResult.html)) {
        cssAction = "clear";
        resolvePageDataLog.debug("Skipped SPA CSS fallback; rendered HTML uses release CSS asset", {
          slug,
        });
      } else {
        css = await profilePhase(
          "page_data.css.generate_from_html",
          () => this.generatePageCssFromHtml(slug, renderResult.html, options),
        );
      }

      if (css) cachePageCss(cssCacheKey, css);
      return { css, cssAction, cssError: undefined };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Surface CSS generation failures instead of silently swallowing them.
      // This allows clients to show a warning or fall back gracefully.
      resolvePageDataLog.error("CSS generation failed", {
        slug,
        error: errorMessage,
        projectId: options?.projectId,
      });
      return {
        css: undefined,
        cssAction: undefined,
        cssError: CSS_GENERATION_ERROR_MESSAGE,
      };
    }
  }

  private hasReadyReleaseCss(options: RenderOptions | undefined): boolean {
    if (options?.environment !== "production") return false;
    const releaseManifest = options.releaseAssetManifest !== undefined
      ? options.releaseAssetManifest
      : getReadyManifestForRender(options?.releaseId);
    return (releaseManifest?.css?.length ?? 0) > 0;
  }

  private async generatePageCssFromHtml(
    slug: string,
    html: string,
    options: RenderOptions | undefined,
  ): Promise<string | undefined> {
    const candidates = extractCandidates(html);
    const generatedCss = (await generateTailwindCSS(undefined, candidates, {
      projectSlug: options?.projectSlug,
    })).css;

    resolvePageDataLog.debug("Fell back to HTML candidate CSS generation", {
      slug,
      htmlLength: html.length,
      cssLength: generatedCss?.length || 0,
    });

    return generatedCss;
  }

  /**
   * Build a cache key that is safe for multi-tenant + query-param aware caching.
   * Returns null when request contains sensitive headers (Authorization/Cookie) and
   * no explicit cacheKey override was provided, to avoid leaking personalized HTML.
   *
   * Query param handling uses config.queryParamOptions for filtering (utm_*, gclid, etc.).
   */
  private buildCacheKey(slug: string, options?: RenderOptions): string | null {
    if (options?.cacheKey) return options.cacheKey;
    const req = options?.request;
    if (req) {
      if (requestHasCacheSensitiveState(req)) return null;
    }

    return buildQueryAwareCacheKey(slug, options?.url, this.config.queryParamOptions);
  }
}
