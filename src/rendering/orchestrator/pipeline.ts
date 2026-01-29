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
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import {
  extractRelativePath as extractRelativePathShared,
  extractRouteParams as extractRouteParamsShared,
} from "#veryfront/utils/route-path-utils.ts";
import { join } from "#veryfront/platform/compat/path-helper.ts";
import type { MdxBundle, PageBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { CacheCoordinator } from "../cache/cache-coordinator.ts";
import type { PageRenderer } from "../page-renderer.ts";
import type { PageResolver } from "../page-resolution/index.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./types.ts";
import { DataFetcher } from "#veryfront/data/index.ts";
import type { DataContext, PageWithData } from "#veryfront/data/types.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";
import { LAYOUT_EXTENSIONS } from "../layouts/types.ts";
import type { LayoutItem } from "#veryfront/types";
import { withTimeout, withTimeoutThrow } from "../utils/stream-utils.ts";
import { generateTailwind4CSS } from "#veryfront/html/styles-builder/index.ts";
import { createEsmCache, createModuleCache, loadModule } from "./module-loader/index.ts";
import type { ModuleLoaderConfig } from "./module-loader/index.ts";

/** Timeout for CSS generation SSR (shorter than full SSR since it's optional) */
const CSS_SSR_TIMEOUT_MS = 5000;

/**
 * Per-page CSS cache to avoid redundant SSR for CSS generation.
 * Key: projectId:environment:slug:contentVersion
 * Value: Generated CSS string
 */
const pageCssCache = new Map<string, string>();
const PAGE_CSS_CACHE_MAX_SIZE = 200;

/** Create a cache key for page CSS */
function getPageCssCacheKey(
  projectId: string | undefined,
  environment: string | undefined,
  slug: string,
  projectUpdatedAt: string | undefined,
): string {
  return `${projectId || "default"}:${environment || "preview"}:${slug}:${
    projectUpdatedAt || "draft"
  }`;
}

/** Get cached CSS for a page (if available) */
function getCachedPageCss(cacheKey: string): string | undefined {
  return pageCssCache.get(cacheKey);
}

/** Cache CSS for a page */
function cachePageCss(cacheKey: string, css: string): void {
  if (pageCssCache.size >= PAGE_CSS_CACHE_MAX_SIZE && !pageCssCache.has(cacheKey)) {
    const firstKey = pageCssCache.keys().next().value as string | undefined;
    if (firstKey) pageCssCache.delete(firstKey);
  }
  pageCssCache.set(cacheKey, css);
}

/** Timeout for module loading in resolvePageData (prevents hanging on slow transforms) */
const MODULE_LOAD_TIMEOUT_MS = 10000;

/** Timeout for data fetching (getStaticData, getServerData) */
const DATA_FETCH_TIMEOUT_MS = 15_000;

/** Timeout for SSR rendering stage */
const SSR_RENDER_TIMEOUT_MS = 20_000;

/** Check if a path segment is a hidden dot-directory (not . or ..) */
function isHiddenSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

/** Check if a path contains dot-prefixed segments (e.g., .veryfront, .hidden) */
function isDotPath(slug: string, filePath?: string): boolean {
  const hasDotSegment = (path: string) => path.split("/").some(isHiddenSegment);
  return hasDotSegment(slug) || (filePath ? hasDotSegment(filePath) : false);
}

/** Module to load for data fetching */
interface ModuleToLoad {
  type: "page" | "layout";
  id: string;
  path: string;
}

/** Result of loading a module */
interface LoadedModule {
  type: "page" | "layout";
  id: string;
  // deno-lint-ignore no-explicit-any
  mod: any;
}

/** Empty layout result for dot-prefixed paths */
const EMPTY_LAYOUT_RESULT = { layoutBundle: undefined, nestedLayouts: [] };

export interface RenderPipelineConfig {
  pageResolver: PageResolver;
  cacheCoordinator: CacheCoordinator;
  pageRenderer: PageRenderer;
  layoutOrchestrator: LayoutOrchestrator;
  ssrOrchestrator: SSROrchestrator;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  projectDir: string;
}

/**
 * Orchestrates the complete page rendering process through 10 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Speculative Cache Check
 * 4. Route Params - 5. Two-Phase Data Fetching - 6. Await Cache Check
 * 7. Bundle Preparation - 8. Layout Application - 9. SSR Rendering - 10. Result Assembly
 */
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

  private loadModule(filePath: string): Promise<unknown> {
    return loadModule(filePath, this.moduleLoaderConfig);
  }

  /**
   * Collect modules that need data fetching from page and layouts.
   */
  private collectModulesToLoad(
    pagePath: string,
    isComponentPage: boolean,
    isInPagesOrAppDir: boolean,
    nestedLayouts: Array<{ kind: string; componentPath?: string }>,
  ): ModuleToLoad[] {
    const modules: ModuleToLoad[] = [];

    if (isComponentPage && isInPagesOrAppDir) {
      modules.push({ type: "page", id: pagePath, path: pagePath });
    }

    for (const layout of nestedLayouts) {
      if (layout.kind === "tsx" && layout.componentPath) {
        modules.push({ type: "layout", id: layout.componentPath, path: layout.componentPath });
      }
    }

    return modules;
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
  private async loadModulesInParallel(modules: ModuleToLoad[]): Promise<LoadedModule[]> {
    const results = await Promise.all(
      modules.map((m) =>
        this.loadModule(m.path)
          .then((mod) => ({ ...m, mod, error: null as Error | null }))
          .catch((error: Error) => ({ ...m, mod: null, error }))
      ),
    );

    const loaded: LoadedModule[] = [];
    const criticalFailures: Array<{ path: string; error: string }> = [];

    for (const result of results) {
      if (result.mod && !result.error) {
        loaded.push({ type: result.type, id: result.id, mod: result.mod });
        continue;
      }

      if (result.error) {
        const errorMessage = result.error.message;

        // Page modules are critical - collect failures to throw after processing all
        if (result.type === "page") {
          criticalFailures.push({ path: result.path, error: errorMessage });
          logger.error("[renderPage] Critical page module failed to load", {
            path: result.path,
            error: errorMessage,
          });
        } else {
          // Layout modules are non-critical - warn and continue
          logger.warn("[renderPage] Layout module failed to load (non-critical)", {
            path: result.path,
            error: errorMessage,
          });
        }
      }
    }

    // Fail fast if any critical page modules failed to load
    if (criticalFailures.length > 0) {
      const failedPaths = criticalFailures.map((f) => f.path).join(", ");
      throw new VeryfrontError(
        `Critical page module(s) failed to load: ${failedPaths}. ` +
          `This would result in missing props and a broken page.`,
        ErrorCode.RENDER_ERROR,
        {
          criticalFailures,
          loadedCount: loaded.length,
          totalModules: modules.length,
        },
      );
    }

    return loaded;
  }

  /**
   * Check if module has data fetching function (getServerData or getStaticData).
   */
  private hasDataFetchingFunction(mod: unknown): boolean {
    if (!mod || typeof mod !== "object") return false;
    const m = mod as Record<string, unknown>;
    return typeof m.getServerData === "function" || typeof m.getStaticData === "function";
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pipelineStartTime = performance.now();
    const timing: Record<string, number> = {};
    const projectSlug = options?.projectSlug || options?.projectId || "unknown";
    const projectId = options?.projectId ?? this.config.projectDir;

    let cacheResult: Awaited<ReturnType<typeof this.config.cacheCoordinator.checkCache>> | null =
      null;

    if (!options?.skipCacheCheck) {
      const cacheCheckStart = performance.now();
      cacheResult = await this.config.cacheCoordinator.checkCache(slug);
      timing.cacheCheck = Math.round(performance.now() - cacheCheckStart);

      if (cacheResult?.cachedResult) {
        logger.info("[RenderPipeline] Cache HIT", { slug, projectSlug, timing });
        return cacheResult.cachedResult;
      }
    }

    setupSSRGlobals();

    this.moduleLoaderConfig.projectId = projectId;
    this.moduleLoaderConfig.contentSourceId = options?.contentSourceId;

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    return await withSpan(
      "render.page",
      async () => {
        const pageResolveStart = performance.now();
        const pageInfo = await withSpan(
          "render.resolve_page",
          () => this.config.pageResolver.resolvePage(slug),
          { "render.slug": slug },
        );
        timing.pageResolve = Math.round(performance.now() - pageResolveStart);

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
        const layoutDataMap = new Map<string, Record<string, unknown>>();

        const fileExtension = getExtensionName(pageInfo.entity.path);
        const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
        const isInPagesDir = pageInfo.entity.path.includes("/pages/");
        const isInAppDir = pageInfo.entity.path.includes("/app/");

        const dataFetchStart = performance.now();
        if (options?.request && options?.url) {
          await withSpan(
            "render.data_fetching",
            async () => {
              try {
                if (!options.params || Object.keys(options.params).length === 0) {
                  logger.debug("[renderPage] Extracting route params", {
                    slug,
                    pagePath: pageInfo.entity.path,
                  });

                  const extracted = extractRouteParamsShared(pageInfo.entity.path, slug);
                  if (extracted.matched) {
                    options.params = extracted.params;
                    logger.debug("[renderPage] Extracted route params", {
                      slug,
                      params: extracted.params,
                    });
                  }
                }

                const dataContext: DataContext = {
                  params: options.params || {},
                  query: options.url!.searchParams,
                  request: options.request!,
                  url: options.url!,
                };

                const modulesToLoad = this.collectModulesToLoad(
                  pageInfo.entity.path,
                  isComponentPage,
                  isInPagesDir || isInAppDir,
                  layoutResult.nestedLayouts,
                );

                if (modulesToLoad.length === 0) return;

                const loadedModules = await withSpan(
                  SpanNames.RENDER_LOAD_MODULES,
                  () =>
                    withTimeoutThrow(
                      this.loadModulesInParallel(modulesToLoad),
                      MODULE_LOAD_TIMEOUT_MS,
                      `Module loading for ${slug}`,
                    ),
                  { "render.module_count": modulesToLoad.length },
                );

                const dataJobs = loadedModules.filter((m) => this.hasDataFetchingFunction(m.mod));
                if (dataJobs.length === 0) return;

                const dataResults = await withSpan(
                  SpanNames.RENDER_FETCH_DATA,
                  () =>
                    withTimeoutThrow(
                      Promise.all(
                        dataJobs.map((job) =>
                          this.dataFetcher
                            .fetchData(job.mod, dataContext, this.config.mode)
                            .then((result) => ({ ...job, result, error: null as Error | null }))
                            .catch((error: Error) => ({ ...job, result: null, error }))
                        ),
                      ),
                      DATA_FETCH_TIMEOUT_MS,
                      `Data fetch for ${slug}`,
                    ),
                  { "render.data_job_count": dataJobs.length },
                );

                for (const { type, id, result, error } of dataResults) {
                  if (error) throw error;
                  if (!result) continue;

                  if (result.notFound) {
                    throw new VeryfrontError(
                      "Page/Layout returned notFound",
                      ErrorCode.FILE_NOT_FOUND,
                      { slug, component: id },
                    );
                  }

                  if (result.redirect) {
                    throw new VeryfrontError(
                      `Redirect to ${result.redirect.destination}`,
                      ErrorCode.RENDER_ERROR,
                      { slug, redirect: result.redirect },
                    );
                  }

                  if (!result.props) continue;

                  if (type === "page") {
                    dataFetchingProps = result.props as Record<string, unknown>;
                  } else {
                    layoutDataMap.set(id, result.props as Record<string, unknown>);
                  }
                }
              } catch (error) {
                if (error instanceof VeryfrontError) throw error;

                logger.error("[renderPage] Data fetching error", {
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

        const mergedOptions = dataFetchingProps
          ? { ...options, props: { ...options?.props, ...dataFetchingProps } }
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
          throw new VeryfrontError("Failed to prepare page bundle", ErrorCode.RENDER_ERROR, {
            slug,
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
              mergedFrontmatter,
              headings,
              options?.projectSlug,
            ),
          { "render.slug": slug, "render.layout_count": layoutResult.nestedLayouts.length },
        );
        timing.layoutApply = Math.round(performance.now() - layoutApplyStart);

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
                },
                mergedOptions,
              ),
              SSR_RENDER_TIMEOUT_MS,
              `SSR rendering for ${slug}`,
            ),
          { "render.slug": slug, "render.delivery": mergedOptions?.delivery || "full" },
        );
        timing.ssr = Math.round(performance.now() - ssrStart);

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

        this.config.cacheCoordinator.persistResult(result, slug).catch((error) => {
          logger.warn("[RenderPipeline] Cache persist failed", { slug, error: String(error) });
        });

        timing.total = Math.round(performance.now() - pipelineStartTime);
        logger.debug("[RenderPipeline] Complete", { slug, timing });

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
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.path.includes("/pages/");
    const isInAppDir = pageInfo.entity.path.includes("/app/");

    let pageProps: Record<string, unknown> = {};
    const layoutProps: Record<string, Record<string, unknown>> = {};
    let params: Record<string, string | string[]> = options?.params || {};

    if (options?.request && options?.url && Object.keys(params).length === 0) {
      const extracted = extractRouteParamsShared(pageInfo.entity.path, slug);
      if (extracted.matched) params = extracted.params;
    }

    if (options?.request && options?.url) {
      const dataContext: DataContext = {
        params,
        query: options.url.searchParams,
        request: options.request,
        url: options.url,
      };

      const modulesToLoad = this.collectModulesToLoad(
        pageInfo.entity.path,
        isComponentPage,
        isInPagesDir || isInAppDir,
        layoutResult.nestedLayouts,
      );

      if (modulesToLoad.length > 0) {
        const loadedModules = await withTimeoutThrow(
          Promise.all(
            modulesToLoad.map((m) =>
              this.loadModule(m.path)
                .then((mod) => ({ ...m, mod }))
                .catch(() => ({ ...m, mod: null }))
            ),
          ),
          MODULE_LOAD_TIMEOUT_MS,
          `Module loading for ${slug}`,
        );

        const dataJobs = loadedModules
          .filter((r) => r.mod && this.hasDataFetchingFunction(r.mod))
          .map((r) => ({
            type: r.type,
            id: r.id,
            promise: this.dataFetcher.fetchData(
              r.mod as PageWithData<unknown>,
              dataContext,
              this.config.mode,
            ),
          }));

        const dataResults = await Promise.all(
          dataJobs.map((job) => job.promise.then((result) => ({ ...job, result }))),
        );

        for (const { type, id, result } of dataResults) {
          if (!result?.props) continue;

          if (type === "page") {
            pageProps = result.props as Record<string, unknown>;
          } else {
            layoutProps[id] = result.props as Record<string, unknown>;
          }
        }
      }
    }

    let frontmatter: Record<string, unknown> = {};
    let headings: Array<{ id: string; text: string; level: number }> = [];
    if (pageType === "mdx") {
      try {
        const bundleResult = await this.config.pageRenderer.preparePageBundles(
          pageInfo,
          slug,
          undefined,
          options,
        );

        if (bundleResult.pageBundle && "frontmatter" in bundleResult.pageBundle) {
          frontmatter =
            (bundleResult.pageBundle as { frontmatter?: Record<string, unknown> }).frontmatter ||
            {};
        }

        if (bundleResult.pageBundle && "headings" in bundleResult.pageBundle) {
          headings = (bundleResult.pageBundle as {
            headings?: Array<{ id: string; text: string; level: number }>;
          }).headings || [];
        }
      } catch {
        // Frontmatter/headings extraction failed, use empty defaults
      }
    }

    const layouts = layoutResult.nestedLayouts
      .filter((l: LayoutItem) => l.componentPath || l.path)
      .map((l: LayoutItem) => ({
        kind: l.kind,
        path: extractRelativePathShared(l.componentPath || l.path || "", this.config.projectDir),
      }));

    const providers: string[] = [];

    let projectUpdatedAt: string | undefined;
    const fs = this.config.adapter?.fs;
    if (fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter()) {
      const wrappedAdapter = fs.getUnderlyingAdapter() as {
        getProjectData?: () => { updated_at?: string } | undefined;
      };
      projectUpdatedAt = wrappedAdapter.getProjectData?.()?.updated_at;
    }

    let appPath: string | undefined;
    for (const ext of LAYOUT_EXTENSIONS) {
      const candidatePath = join(this.config.projectDir, `components/app.${ext}`);
      if (await this.config.adapter.fs.exists(candidatePath)) {
        appPath = extractRelativePathShared(candidatePath, this.config.projectDir);
        break;
      }
    }

    let css: string | undefined;
    let cssError: string | undefined;
    const cssCacheKey = getPageCssCacheKey(
      options?.projectId,
      options?.environment,
      slug,
      projectUpdatedAt,
    );

    const cachedCss = getCachedPageCss(cssCacheKey);
    if (cachedCss) {
      css = cachedCss;
      logger.debug("[resolvePageData] CSS cache hit", { slug, cssLength: css.length });
    } else {
      try {
        const renderResult = await withTimeout(
          this.renderPage(slug, {
            ...options,
            delivery: "string",
            skipCacheCheck: true,
          }),
          CSS_SSR_TIMEOUT_MS,
          `CSS SSR for ${slug}`,
        );

        if (renderResult?.html) {
          css = await generateTailwind4CSS(renderResult.html);
          if (css) cachePageCss(cssCacheKey, css);

          logger.debug("[resolvePageData] Generated and cached CSS", {
            slug,
            htmlLength: renderResult.html.length,
            cssLength: css?.length || 0,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Surface CSS generation failures instead of silently swallowing them.
        // This allows clients to show a warning or fall back gracefully.
        cssError = `CSS generation failed: ${errorMessage}`;
        logger.error("[resolvePageData] CSS generation failed", {
          slug,
          error: errorMessage,
          projectId: options?.projectId,
        });
      }
    }

    logger.debug("[resolvePageData] Resolved page data", {
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
}
