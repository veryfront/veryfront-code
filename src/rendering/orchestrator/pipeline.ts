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

import { DataFetcher } from "#veryfront/data/index.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";
import { RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import {
  getCSSImports,
  runWithCSSCollector,
} from "#veryfront/modules/react-loader/css-import-collector.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { MdxBundle, PageBundle } from "#veryfront/types";
import { rendererLogger as logger } from "#veryfront/utils";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { createBuildVersion } from "#veryfront/utils/version.ts";
import { extractRelativePath as extractRelativePathShared } from "#veryfront/utils/route-path-utils.ts";
import type { CacheLookupResult } from "../cache/cache-coordinator.ts";
import type { PageRenderer } from "../page-renderer.ts";
import type { PageResolver } from "../page-resolution/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";
import { withTimeoutThrow } from "../utils/stream-utils.ts";
import { __injectCssCacheForTests } from "./css-cache.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import { createEsmCache, createModuleCache, loadModule } from "./module-loader/index.ts";
import type { ModuleLoaderConfig } from "./module-loader/index.ts";
import { SSR_RENDER_TIMEOUT_MS } from "./module-collection.ts";
import { EMPTY_LAYOUT_RESULT, isDotPath } from "./path-helpers.ts";
import { buildPipelineCacheKey, resolveDataFetchingStage } from "./pipeline/data-stage.ts";
import { resolveCssFromRenderedHtml, resolvePageDataCssStage } from "./pipeline/css-stage.ts";
import {
  extractMdxMetadataStage,
  resolveAppPathStage,
  resolveProjectUpdatedAtStage,
  serializeLayoutPropsStage,
  serializeLayoutsStage,
} from "./pipeline/page-data-stage.ts";
import type { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./types.ts";

// Extracted modules
const renderPageLog = logger.component("render-page");
const renderPipelineLog = logger.component("render-pipeline");
const resolvePageDataLog = logger.component("resolve-page-data");
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
  /** Query parameter handling for cache keys (from config.cache.queryParams) */
  queryParamOptions?: import("#veryfront/cache/keys.ts").QueryParamCacheOptions;
}

export class RenderPipeline {
  private config: RenderPipelineConfig;
  private dataFetcher: DataFetcher;
  private moduleLoaderConfig: ModuleLoaderConfig;

  constructor(config: RenderPipelineConfig) {
    this.config = config;
    this.dataFetcher = new DataFetcher(config.adapter);
    this.moduleLoaderConfig = {
      projectDir: config.projectDir,
      projectId: config.projectDir,
      adapter: config.adapter,
      mode: config.mode,
      moduleCache: createModuleCache(),
      esmCache: createEsmCache(),
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

  private loadModule(filePath: string): Promise<Record<string, unknown>> {
    return loadModule(filePath, this.moduleLoaderConfig);
  }

  private resolveCssFromRenderedHtml(
    html: string,
    projectSlug: string | undefined,
  ): Promise<string | undefined> {
    return resolveCssFromRenderedHtml(html, projectSlug);
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pipelineStartTime = performance.now();
    const timing: Record<string, number> = {};
    const projectSlug = options?.projectSlug || options?.projectId || "unknown";
    const projectId = options?.projectId ?? this.config.projectDir;
    const cacheKey = this.buildCacheKey(slug, options);

    let cacheResult: Awaited<ReturnType<typeof this.config.cacheCoordinator.checkCache>> | null =
      null;

    const shouldCache = !!cacheKey && options?.delivery !== "stream";

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

    this.moduleLoaderConfig.projectId = projectId;
    this.moduleLoaderConfig.contentSourceId = options?.contentSourceId;

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    return withSpan(
      "render.page",
      async () => {
        const { result } = await runWithCSSCollector(async () => {
          const pageResolveStart = performance.now();
          const pageInfo = await withSpan(
            "render.resolve_page",
            () => this.config.pageResolver.resolvePage(slug),
            { "render.slug": slug },
          );
          timing.pageResolve = Math.round(performance.now() - pageResolveStart);

          const sourceFile = extractRelativePathShared(
            pageInfo.entity.path,
            this.config.projectDir,
          );

          try {
            const skipLayouts = isDotPath(slug, pageInfo.entity.path);

            const layoutCollectStart = performance.now();
            const layoutResult = skipLayouts ? EMPTY_LAYOUT_RESULT : await withSpan(
              "render.collect_layouts",
              () => this.config.layoutOrchestrator.collectLayouts(pageInfo),
              { "render.slug": slug },
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
              await withSpan(
                "render.data_fetching",
                async () => {
                  try {
                    const dataResolution = await resolveDataFetchingStage({
                      slug,
                      pagePath: pageInfo.entity.path,
                      nestedLayouts: layoutResult.nestedLayouts,
                      options,
                      projectDir: this.config.projectDir,
                      mode: this.config.mode,
                      dataFetcher: this.dataFetcher,
                      loadModule: (filePath) => this.loadModule(filePath),
                    });
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
            const pageBundleResult = await withSpan(
              "render.prepare_bundles",
              () =>
                this.config.pageRenderer.preparePageBundles(
                  pageInfo,
                  slug,
                  cacheResult?.cachedModule,
                  mergedOptions,
                ),
              { "render.slug": slug },
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

            const mergedFrontmatter = {
              ...pageInfo.entity.frontmatter,
              ...(pageBundle as MdxBundle).frontmatter,
            };

            const headings = (pageBundle as PageBundle).headings || [];

            await layoutPreloadPromise;

            const layoutApplyStart = performance.now();
            const wrappedElement = await withSpan(
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
                ),
              { "render.slug": slug, "render.layout_count": layoutResult.nestedLayouts.length },
            );
            timing.layoutApply = Math.round(performance.now() - layoutApplyStart);

            // Snapshot CSS imports collected during module loading (before SSR rendering).
            // These are passed to the HTML generator to be included in the output.
            const collectedCSSImports = getCSSImports();

            const ssrStart = performance.now();
            const ssrResult = await withSpan(
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
                    mergedOptions,
                  ),
                  SSR_RENDER_TIMEOUT_MS,
                  `SSR rendering for ${slug}`,
                ),
              { "render.slug": slug, "render.delivery": mergedOptions?.delivery || "full" },
            );
            timing.ssr = Math.round(performance.now() - ssrStart);

            if (collectedCSSImports.length > 0) {
              renderPipelineLog.debug("CSS imports collected for HTML generation", {
                slug,
                count: collectedCSSImports.length,
                paths: collectedCSSImports.map((p) => p.split("/").pop()),
              });
            }

            const pageModule = pageBundleResult.clientModuleCode && pageBundleResult.pageModuleType
              ? {
                slug,
                code: pageBundleResult.clientModuleCode,
                type: pageBundleResult.pageModuleType,
              }
              : undefined;

            const result: RenderResult = {
              html: ssrResult.fullHtml,
              frontmatter: (pageBundleResult.pageBundle as MdxBundle).frontmatter || {},
              headings: pageBundleResult.pageBundle.headings || [],
              nodeMap: pageBundleResult.pageBundle.nodeMap,
              stream: ssrResult.finalStream,
              ssrHash: ssrResult.ssrHash,
              ...(pageModule ? { pageModule } : {}),
            };

            if (shouldCache && !options?.skipCachePersist) {
              void this.config.cacheCoordinator.persistResult(result, slug, cacheKey).catch(
                (error) => {
                  renderPipelineLog.error("Cache persist failed", {
                    slug,
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                  });
                },
              );
            }

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
  }

  /** Resolve page data for SPA client-side navigation without rendering HTML. */
  async resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    setupSSRGlobals();

    const projectId = options?.projectId ?? this.config.projectDir;
    this.moduleLoaderConfig.projectId = projectId;
    this.moduleLoaderConfig.contentSourceId = options?.contentSourceId;

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    const pageInfo = await this.config.pageResolver.resolvePage(slug);

    const skipLayouts = isDotPath(slug, pageInfo.entity.path);
    const layoutResult = skipLayouts
      ? EMPTY_LAYOUT_RESULT
      : await this.config.layoutOrchestrator.collectLayouts(pageInfo);

    const pagePath = extractRelativePathShared(pageInfo.entity.path, this.config.projectDir);
    const fileExtension = getExtensionName(pageInfo.entity.path);
    const pageType = fileExtension as PageDataResponse["pageType"];
    const dataResolution = await resolveDataFetchingStage({
      slug,
      pagePath: pageInfo.entity.path,
      nestedLayouts: layoutResult.nestedLayouts,
      options,
      projectDir: this.config.projectDir,
      mode: this.config.mode,
      dataFetcher: this.dataFetcher,
      loadModule: (filePath) => this.loadModule(filePath),
    });

    const pageProps: Record<string, unknown> = dataResolution.pageProps;
    const params = dataResolution.params;
    const layoutProps = serializeLayoutPropsStage(dataResolution.layoutProps);

    const { frontmatter, headings } = await extractMdxMetadataStage(
      pageType,
      pageInfo,
      slug,
      options,
      params,
      this.config.pageRenderer,
    );

    const layouts = serializeLayoutsStage(layoutResult.nestedLayouts, this.config.projectDir);

    const providers: string[] = [];

    const projectUpdatedAt = resolveProjectUpdatedAtStage(this.config.adapter);

    const appPath = await resolveAppPathStage(this.config.adapter, this.config.projectDir);

    const { css, cssError } = await resolvePageDataCssStage({
      slug,
      options,
      projectUpdatedAt,
      renderPage: (nextSlug, nextOptions) => this.renderPage(nextSlug, nextOptions),
      resolveCssFromRenderedHtml: (html, projectSlug) =>
        this.resolveCssFromRenderedHtml(html, projectSlug),
    });

    resolvePageDataLog.debug("Resolved page data", {
      slug,
      pagePath,
      pageType,
      layoutCount: layouts.length,
      appPath,
      headingsCount: headings.length,
      hasCss: !!css,
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
      headings,
      css,
      cssError,
    };
  }

  /**
   * Build a cache key that is safe for multi-tenant + query-param aware caching.
   * Returns null when request contains sensitive headers (Authorization/Cookie) and
   * no explicit cacheKey override was provided, to avoid leaking personalized HTML.
   *
   * Query param handling uses config.queryParamOptions for filtering (utm_*, gclid, etc.).
   */
  private buildCacheKey(slug: string, options?: RenderOptions): string | null {
    return buildPipelineCacheKey(slug, options, this.config.queryParamOptions);
  }
}
