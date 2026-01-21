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
import { timeAsync } from "#veryfront/utils";
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
import type { DataContext } from "#veryfront/data/types.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";
import { LAYOUT_EXTENSIONS } from "../layouts/types.ts";
import { withTimeout, withTimeoutThrow } from "../utils/stream-utils.ts";

/** Timeout for CSS generation SSR (shorter than full SSR since it's optional) */
const CSS_SSR_TIMEOUT_MS = 5000;

/** Timeout for module loading in resolvePageData (prevents hanging on slow transforms) */
const MODULE_LOAD_TIMEOUT_MS = 10000;

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

/** Empty layout/provider result for dot-prefixed paths */
const EMPTY_LAYOUT_RESULT = { layoutBundle: undefined, nestedLayouts: [] };
const EMPTY_PROVIDER_RESULT = { providerBundles: [], providerItems: [], providerInfos: [] };

// Import extracted modules
import { createEsmCache, createModuleCache, loadModule } from "./module-loader/index.ts";
import type { ModuleLoaderConfig } from "./module-loader/index.ts";

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
    for (const result of results) {
      if (result.mod && !result.error) {
        loaded.push({ type: result.type, id: result.id, mod: result.mod });
      } else if (result.error) {
        logger.warn("[renderPage] Failed to load module", {
          path: result.path,
          error: result.error.message,
        });
      }
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
    // Set up browser globals before any module loading to prevent crashes
    // when third-party libraries check for browser features during SSR
    setupSSRGlobals();

    const projectId = options?.projectId ?? this.config.projectDir;
    this.moduleLoaderConfig.projectId = projectId;

    // In development mode, clear SSR module cache to pick up file changes
    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    // Wrap entire render in a span for distributed tracing
    return await withSpan(
      "render.page",
      async () => {
        // ─────────────────────────────────────────────────────────────────────────
        // Stage 1: Page Resolution
        // ─────────────────────────────────────────────────────────────────────────
        const pageInfo = await withSpan(
          "render.resolve_page",
          () =>
            timeAsync(
              "resolve-page",
              () => this.config.pageResolver.resolvePage(slug),
              "render-page",
            ),
          { "render.slug": slug },
        );

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 2: Layout & Provider Collection (parallel)
        // Skip for dot-prefixed paths (e.g., .veryfront) - they don't use project layouts/providers
        // ─────────────────────────────────────────────────────────────────────────
        const skipLayouts = isDotPath(slug, pageInfo.entity.path);

        const [layoutResult, providerResult] = skipLayouts
          ? [EMPTY_LAYOUT_RESULT, EMPTY_PROVIDER_RESULT]
          : await withSpan(
            "render.collect_layouts_providers",
            () =>
              Promise.all([
                timeAsync(
                  "collect-layouts",
                  () => this.config.layoutOrchestrator.collectLayouts(pageInfo),
                  "render-page",
                ),
                timeAsync(
                  "collect-providers",
                  () => this.config.layoutOrchestrator.collectProviders(slug),
                  "render-page",
                ),
              ]),
            { "render.slug": slug },
          );

        if (skipLayouts) {
          logger.debug("[renderPage] Skipping layouts/providers for dot-prefixed path", { slug });
        }

        logger.debug("[renderPage] Layout collection result", {
          slug,
          skipLayouts,
          hasLayoutBundle: !!layoutResult.layoutBundle,
          nestedLayoutsCount: layoutResult.nestedLayouts.length,
          nestedLayoutPaths: layoutResult.nestedLayouts.map((l) => l.path || l.componentPath),
          providerCount: providerResult.providerItems.length,
        });

        let dataFetchingProps: Record<string, unknown> | undefined;
        const layoutDataMap = new Map<string, Record<string, unknown>>();

        const fileExtension = pageInfo.entity.path.split(".").pop()!.toLowerCase();
        const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
        const isInPagesDir = pageInfo.entity.path.includes("/pages/");
        const isInAppDir = pageInfo.entity.path.includes("/app/");

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 3: Start Speculative Cache Check (runs in parallel with data fetching)
        // ─────────────────────────────────────────────────────────────────────────
        const cacheCheckPromise = withSpan(
          SpanNames.CACHE_CHECK_SPECULATIVE,
          () => this.config.cacheCoordinator.checkCache(slug),
          { "cache.slug": slug },
        );

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 4: Route Params Extraction
        // Stage 5: Two-Phase Data Fetching (parallel module loads, then parallel data fetches)
        // ─────────────────────────────────────────────────────────────────────────
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

                // Phase 1: Collect and load all modules in parallel
                const modulesToLoad = this.collectModulesToLoad(
                  pageInfo.entity.path,
                  isComponentPage,
                  isInPagesDir || isInAppDir,
                  layoutResult.nestedLayouts,
                );

                if (modulesToLoad.length === 0) {
                  logger.debug("[renderPage] No modules to load for data fetching", { slug });
                  return;
                }

                logger.debug("[renderPage] Phase 1: Loading modules in parallel", {
                  count: modulesToLoad.length,
                });

                const loadedModules = await withSpan(
                  SpanNames.RENDER_LOAD_MODULES,
                  () => this.loadModulesInParallel(modulesToLoad),
                  { "render.module_count": modulesToLoad.length },
                );

                // Phase 2: Fetch data for modules with data fetching functions
                const dataJobs = loadedModules.filter((m) => this.hasDataFetchingFunction(m.mod));

                if (dataJobs.length === 0) {
                  logger.debug("[renderPage] No data fetching functions found", { slug });
                  return;
                }

                logger.debug("[renderPage] Phase 2: Fetching data in parallel", {
                  count: dataJobs.length,
                });

                const dataResults = await withSpan(
                  SpanNames.RENDER_FETCH_DATA,
                  () =>
                    Promise.all(
                      dataJobs.map((job) =>
                        this.dataFetcher
                          .fetchData(job.mod, dataContext, this.config.mode)
                          .then((result) => ({ ...job, result, error: null as Error | null }))
                          .catch((error: Error) => ({ ...job, result: null, error }))
                      ),
                    ),
                  { "render.data_job_count": dataJobs.length },
                );

                // Process results - propagate errors from getServerData/getStaticData
                for (const { type, id, result, error } of dataResults) {
                  if (error) {
                    // Re-throw errors from data fetching functions
                    // These are application errors that should result in error pages
                    throw error;
                  }

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

                  if (result.props) {
                    if (type === "page") {
                      dataFetchingProps = result.props as Record<string, unknown>;
                    } else {
                      layoutDataMap.set(id, result.props as Record<string, unknown>);
                    }
                  }
                }
              } catch (error) {
                if (error instanceof VeryfrontError) {
                  throw error;
                }

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

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 6: Await Speculative Cache Check (started in parallel with data fetching)
        // ─────────────────────────────────────────────────────────────────────────
        const cacheResult = await cacheCheckPromise;

        if (cacheResult?.cachedResult) {
          logger.debug("[renderPage] Cache hit, returning cached result", { slug });
          return cacheResult.cachedResult;
        }

        const mergedOptions = dataFetchingProps
          ? { ...options, props: { ...options?.props, ...dataFetchingProps } }
          : options;

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 7: Page Bundle Preparation
        // ─────────────────────────────────────────────────────────────────────────
        const pageBundleResult = await withSpan(
          "render.prepare_bundles",
          () =>
            timeAsync(
              "prepare-page-bundles",
              () =>
                this.config.pageRenderer.preparePageBundles(
                  pageInfo,
                  slug,
                  cacheResult?.cachedModule,
                  mergedOptions,
                ),
              "render-page",
            ),
          { "render.slug": slug },
        );

        if (pageBundleResult.scriptResult) {
          return pageBundleResult.scriptResult;
        }

        if (!pageBundleResult.pageElement || !pageBundleResult.pageBundle) {
          throw new VeryfrontError("Failed to prepare page bundle", ErrorCode.RENDER_ERROR, {
            slug,
          });
        }

        const { pageElement, pageBundle } = pageBundleResult;

        // Merge frontmatter from entity (API) and pageBundle (MDX compilation)
        // This ensures SSR PageContext has full frontmatter including MDX-parsed fields
        const mergedFrontmatter = {
          ...pageInfo.entity.frontmatter,
          ...(pageBundle as MdxBundle).frontmatter,
        };

        // Extract headings from page bundle for sidebar/TOC navigation
        const headings = (pageBundle as PageBundle).headings || [];

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 8: Layout Application
        // ─────────────────────────────────────────────────────────────────────────
        const wrappedElement = await withSpan(
          "render.apply_layouts",
          () =>
            timeAsync(
              "apply-layouts",
              () =>
                this.config.layoutOrchestrator.applyLayoutsAndWrappers(
                  pageElement,
                  pageInfo,
                  layoutResult.layoutBundle,
                  layoutResult.nestedLayouts,
                  providerResult.providerItems,
                  layoutDataMap,
                  options?.url,
                  mergedFrontmatter,
                  headings,
                  options?.projectSlug,
                ),
              "render-page",
            ),
          { "render.slug": slug, "render.layout_count": layoutResult.nestedLayouts.length },
        );

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 9: SSR Rendering
        // ─────────────────────────────────────────────────────────────────────────
        const ssrResult = await withSpan(
          "render.ssr",
          () =>
            timeAsync(
              "ssr-rendering",
              () =>
                this.config.ssrOrchestrator.performSSRRendering(
                  wrappedElement,
                  {
                    pageInfo,
                    pageBundle,
                    layoutBundle: layoutResult.layoutBundle,
                    nestedLayouts: layoutResult.nestedLayouts,
                    providerInfos: providerResult.providerInfos,
                    collectedMetadata: pageBundleResult.collectedMetadata,
                    slug,
                  },
                  mergedOptions,
                ),
              "render-page",
            ),
          { "render.slug": slug, "render.delivery": mergedOptions?.delivery || "full" },
        );

        // ─────────────────────────────────────────────────────────────────────────
        // Stage 10: Result Assembly
        // ─────────────────────────────────────────────────────────────────────────
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

        if (cacheResult) {
          await this.config.cacheCoordinator.persistResult(result, slug);
        }

        logger.debug("[renderPage] Returning result", {
          hasHtml: !!result.html,
          hasStream: !!result.stream,
          htmlLength: result.html?.length || 0,
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
    // Set up browser globals for any SSR-related checks
    setupSSRGlobals();

    const projectId = options?.projectId ?? this.config.projectDir;
    this.moduleLoaderConfig.projectId = projectId;

    // In development mode, clear SSR module cache
    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId);
    }

    // 1. Resolve page info
    const pageInfo = await timeAsync(
      "resolve-page-data",
      () => this.config.pageResolver.resolvePage(slug),
      "resolve-page-data",
    );

    // 2. Collect layouts and providers in parallel
    // Skip for dot-prefixed paths (e.g., .veryfront) - they don't use project layouts/providers
    const skipLayouts = isDotPath(slug, pageInfo.entity.path);

    const [layoutResult, providerResult] = skipLayouts
      ? [EMPTY_LAYOUT_RESULT, EMPTY_PROVIDER_RESULT]
      : await Promise.all([
        timeAsync(
          "collect-layouts-data",
          () => this.config.layoutOrchestrator.collectLayouts(pageInfo),
          "resolve-page-data",
        ),
        timeAsync(
          "collect-providers-data",
          () => this.config.layoutOrchestrator.collectProviders(slug),
          "resolve-page-data",
        ),
      ]);

    // 3. Extract page path and type
    const pagePath = extractRelativePathShared(pageInfo.entity.path, this.config.projectDir);
    const fileExtension = pageInfo.entity.path.split(".").pop()!.toLowerCase();
    const pageType = fileExtension as PageDataResponse["pageType"];
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.path.includes("/pages/");
    const isInAppDir = pageInfo.entity.path.includes("/app/");

    // 4. Initialize data structures
    let pageProps: Record<string, unknown> = {};
    const layoutProps: Record<string, Record<string, unknown>> = {};
    let params: Record<string, string | string[]> = options?.params || {};

    // 5. Extract route params if not provided
    if (options?.request && options?.url && Object.keys(params).length === 0) {
      const extracted = extractRouteParamsShared(pageInfo.entity.path, slug);
      if (extracted.matched) {
        params = extracted.params;
      }
    }

    // 6. Two-phase data fetching if request context is available
    if (options?.request && options?.url) {
      const dataContext: DataContext = {
        params,
        query: options.url.searchParams,
        request: options.request,
        url: options.url,
      };

      // Phase 1: Collect and load all modules in parallel
      const modulesToLoad = this.collectModulesToLoad(
        pageInfo.entity.path,
        isComponentPage,
        isInPagesDir || isInAppDir,
        layoutResult.nestedLayouts,
      );

      if (modulesToLoad.length > 0) {
        // Load modules with timeout to prevent hanging on slow transforms
        const loadedModules = await withTimeoutThrow(
          Promise.all(
            modulesToLoad.map((m) =>
              this.loadModule(m.path)
                // deno-lint-ignore no-explicit-any
                .then((mod) => ({ ...m, mod: mod as any }))
                .catch(() => ({ ...m, mod: null }))
            ),
          ),
          MODULE_LOAD_TIMEOUT_MS,
          `Module loading for ${slug}`,
        );

        // Phase 2: Fetch data for modules with data fetching functions
        const dataJobs = loadedModules
          .filter((r) => r.mod && this.hasDataFetchingFunction(r.mod))
          .map((r) => ({
            type: r.type,
            id: r.id,
            promise: this.dataFetcher.fetchData(r.mod, dataContext, this.config.mode),
          }));

        const dataResults = await Promise.all(
          dataJobs.map((job) => job.promise.then((result) => ({ ...job, result }))),
        );

        for (const { type, id, result } of dataResults) {
          if (result?.props) {
            if (type === "page") {
              pageProps = result.props as Record<string, unknown>;
            } else {
              layoutProps[id] = result.props as Record<string, unknown>;
            }
          }
        }
      }
    }

    // 7. Extract frontmatter and headings
    let frontmatter: Record<string, unknown> = {};
    let headings: Array<{ id: string; text: string; level: number }> = [];
    if (pageType === "mdx" && pageInfo.entity) {
      // For MDX pages, try to get frontmatter and headings from the bundle
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
          }).headings ||
            [];
        }
      } catch {
        // Frontmatter/headings extraction failed, use empty defaults
      }
    }

    // 8. Build layout info array
    const layouts = layoutResult.nestedLayouts
      .filter((l) => l.componentPath || l.path)
      .map((l) => ({
        kind: l.kind,
        path: extractRelativePathShared(l.componentPath || l.path || "", this.config.projectDir),
      }));

    // 9. Build provider paths array
    const providers = providerResult.providerInfos
      .filter((p) => p.bundle?.path)
      .map((p) => extractRelativePathShared(p.bundle?.path || "", this.config.projectDir));

    // 10. Get project updatedAt if available from Veryfront API adapter
    let projectUpdatedAt: string | undefined;
    const fs = this.config.adapter?.fs;
    if (fs && isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter()) {
      const wrappedAdapter = fs.getUnderlyingAdapter() as {
        getProjectData?: () => { updated_at?: string } | undefined;
      };
      projectUpdatedAt = wrappedAdapter.getProjectData?.()?.updated_at;
    }

    // 11. Resolve app component path (contains QueryClientProvider, etc.)
    let appPath: string | undefined;
    // Uses LAYOUT_EXTENSIONS for consistency with html.ts resolveAppComponentPath()
    for (const ext of LAYOUT_EXTENSIONS) {
      const candidatePath = join(this.config.projectDir, `components/app.${ext}`);
      const exists = await this.config.adapter.fs.exists(candidatePath);
      if (exists) {
        appPath = extractRelativePathShared(candidatePath, this.config.projectDir);
        break;
      }
    }

    // 12. Generate CSS for SPA navigation via lightweight SSR render
    // This ensures client-side navigation has all required styles (from actual rendered HTML)
    // Uses timeout to prevent blocking other requests if SSR hangs
    let css: string | undefined;
    try {
      // Do a lightweight SSR render with timeout protection
      const renderResult = await withTimeout(
        this.renderPage(slug, {
          ...options,
          delivery: "string", // Full HTML string, not stream
        }),
        CSS_SSR_TIMEOUT_MS,
        `CSS SSR for ${slug}`,
      );

      // Generate CSS from rendered HTML (if render completed in time)
      if (renderResult?.html) {
        const { generateTailwind4CSS } = await import("#veryfront/html/styles-builder/index.ts");
        css = await generateTailwind4CSS(renderResult.html);
        logger.debug("[resolvePageData] Generated CSS from SSR HTML", {
          slug,
          htmlLength: renderResult.html.length,
          cssLength: css?.length || 0,
        });
      }
    } catch (error) {
      logger.warn("[resolvePageData] Failed to generate CSS via SSR", {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.debug("[resolvePageData] Resolved page data", {
      slug,
      pagePath,
      pageType,
      layoutCount: layouts.length,
      providerCount: providers.length,
      appPath,
      headingsCount: headings.length,
      hasCss: !!css,
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
    };
  }
}
