/**
 * Render Pipeline
 *
 * Orchestrates the complete page rendering process through 9 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Route Params
 * 4. Data Fetching - 5. Cache Check - 6. Bundle Preparation
 * 7. Layout Application - 8. SSR Rendering - 9. Result Assembly
 *
 * @module rendering/orchestrator/pipeline
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { timeAsync } from "@veryfront/utils";
import { createBuildVersion } from "@veryfront/utils/version.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import {
  extractRelativePath as extractRelativePathShared,
  extractRouteParams as extractRouteParamsShared,
} from "@veryfront/core/utils/route-path-utils.ts";
import { join } from "@veryfront/platform/compat/path-helper.ts";
import type { MdxBundle, PageBundle } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "@veryfront/platform/adapters/fs/wrapper.ts";
import type { CacheCoordinator } from "../cache/cache-coordinator.ts";
import type { PageRenderer } from "../page-renderer.ts";
import type { PageResolver } from "../page-resolution/index.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./types.ts";
import { DataFetcher } from "@veryfront/data/index.ts";
import type { DataContext } from "@veryfront/data/types.ts";
import { clearSSRModuleCache } from "@veryfront/modules/react-loader/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";

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
 * Orchestrates the complete page rendering process through 9 stages:
 * 1. Page Resolution - 2. Layout/Provider Collection - 3. Route Params
 * 4. Data Fetching - 5. Cache Check - 6. Bundle Preparation
 * 7. Layout Application - 8. SSR Rendering - 9. Result Assembly
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
      adapter: config.adapter,
      mode: config.mode,
      moduleCache: createModuleCache(),
      esmCache: createEsmCache(),
    };
  }

  private loadModule(filePath: string): Promise<any> {
    return loadModule(filePath, this.moduleLoaderConfig);
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    // Set up browser globals before any module loading to prevent crashes
    // when third-party libraries check for browser features during SSR
    setupSSRGlobals();

    // In development mode, clear SSR module cache to pick up file changes
    if (this.config.mode === "development") {
      clearSSRModuleCache();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 1: Page Resolution
    // ─────────────────────────────────────────────────────────────────────────
    const pageInfo = await timeAsync(
      "resolve-page",
      () => this.config.pageResolver.resolvePage(slug),
      "render-page",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 2: Layout & Provider Collection (parallel)
    // ─────────────────────────────────────────────────────────────────────────
    const [layoutResult, providerResult] = await Promise.all([
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
    ]);

    let dataFetchingProps: Record<string, unknown> | undefined;
    const layoutDataMap = new Map<string, Record<string, unknown>>();

    const fileExtension = pageInfo.entity.path.split(".").pop()!.toLowerCase();
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.path.includes("/pages/");

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 3: Route Params Extraction
    // Stage 4: Data Fetching (parallel jobs for page + layouts)
    // ─────────────────────────────────────────────────────────────────────────
    if (options?.request && options?.url) {
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

        // Parallel Data Fetching
        const jobs: Array<{ type: "page" | "layout"; id: string; run: () => Promise<any> }> = [];

        const dataContext: DataContext = {
          params: options.params || {},
          query: options.url.searchParams,
          request: options.request,
          url: options.url,
        };

        // Page Job
        if (isComponentPage && isInPagesDir) {
          jobs.push({
            type: "page",
            id: pageInfo.entity.path,
            run: async () => {
              const mod = await this.loadModule(pageInfo.entity.path);
              if (mod && (mod.getServerData || mod.getStaticData)) {
                return this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
              }
              return null;
            },
          });
        }

        // Layout Jobs
        for (const layout of layoutResult.nestedLayouts) {
          if (layout.kind === "tsx" && layout.componentPath) {
            jobs.push({
              type: "layout",
              id: layout.componentPath,
              run: async () => {
                const mod = await this.loadModule(layout.componentPath!);
                if (mod && (mod.getServerData || mod.getStaticData)) {
                  return this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
                }
                return null;
              },
            });
          }
        }

        logger.info("[renderPage] Executing parallel data fetching jobs", { count: jobs.length });
        const results = await timeAsync(
          "data-fetching-jobs",
          () => Promise.all(jobs.map((j) => j.run())),
          "render-page",
        );

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          if (!job) continue;
          const result = results[i];
          if (result) {
            if (result.notFound) {
              throw new VeryfrontError(
                "Page/Layout returned notFound",
                ErrorCode.FILE_NOT_FOUND,
                { slug, component: job.id },
              );
            }

            if (result.redirect) {
              throw new VeryfrontError(
                `Redirect to ${result.redirect.destination}`,
                ErrorCode.RENDER_ERROR,
                {
                  slug,
                  redirect: result.redirect,
                },
              );
            }

            if (result.props) {
              if (job.type === "page") {
                dataFetchingProps = result.props as Record<string, unknown>;
              } else {
                layoutDataMap.set(job.id, result.props as Record<string, unknown>);
              }
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
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 5: Cache Check
    // ─────────────────────────────────────────────────────────────────────────
    const cacheResult = await timeAsync(
      "check-cache",
      () => this.config.cacheCoordinator.checkCache(slug),
      "render-page",
    );

    if (cacheResult?.cachedResult) {
      return cacheResult.cachedResult;
    }

    const mergedOptions = dataFetchingProps
      ? { ...options, props: { ...options?.props, ...dataFetchingProps } }
      : options;

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 6: Page Bundle Preparation
    // ─────────────────────────────────────────────────────────────────────────
    const pageBundleResult = await timeAsync(
      "prepare-page-bundles",
      () =>
        this.config.pageRenderer.preparePageBundles(
          pageInfo,
          slug,
          cacheResult?.cachedModule,
          mergedOptions,
        ),
      "render-page",
    );

    if (pageBundleResult.scriptResult) {
      return pageBundleResult.scriptResult;
    }

    if (!pageBundleResult.pageElement || !pageBundleResult.pageBundle) {
      throw new VeryfrontError("Failed to prepare page bundle", ErrorCode.RENDER_ERROR, { slug });
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
    // Stage 7: Layout Application
    // ─────────────────────────────────────────────────────────────────────────
    const wrappedElement = await timeAsync(
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
        ),
      "render-page",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 8: SSR Rendering
    // ─────────────────────────────────────────────────────────────────────────
    const ssrResult = await timeAsync(
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
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 9: Result Assembly
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

    logger.info("[renderPage] Returning result", {
      hasHtml: !!result.html,
      hasStream: !!result.stream,
      htmlLength: result.html?.length || 0,
    });

    return result;
  }

  /** Resolve page data for SPA client-side navigation without rendering HTML. */
  async resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    // Set up browser globals for any SSR-related checks
    setupSSRGlobals();

    // In development mode, clear SSR module cache
    if (this.config.mode === "development") {
      clearSSRModuleCache();
    }

    // 1. Resolve page info
    const pageInfo = await timeAsync(
      "resolve-page-data",
      () => this.config.pageResolver.resolvePage(slug),
      "resolve-page-data",
    );

    // 2. Collect layouts and providers in parallel
    const [layoutResult, providerResult] = await Promise.all([
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

    // 6. Fetch data if request context is available
    if (options?.request && options?.url) {
      const dataContext: DataContext = {
        params,
        query: options.url.searchParams,
        request: options.request,
        url: options.url,
      };

      // Fetch page data
      if (isComponentPage && isInPagesDir) {
        const mod = await this.loadModule(pageInfo.entity.path);
        if (mod && (mod.getServerData || mod.getStaticData)) {
          const result = await this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
          if (result?.props) {
            pageProps = result.props as Record<string, unknown>;
          }
        }
      }

      // Fetch layout data
      for (const layout of layoutResult.nestedLayouts) {
        if (layout.kind === "tsx" && layout.componentPath) {
          const mod = await this.loadModule(layout.componentPath);
          if (mod && (mod.getServerData || mod.getStaticData)) {
            const result = await this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
            if (result?.props) {
              layoutProps[layout.componentPath] = result.props as Record<string, unknown>;
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
    const appExtensions = ["tsx", "jsx", "ts", "js"];
    for (const ext of appExtensions) {
      const candidatePath = join(this.config.projectDir, `components/app.${ext}`);
      const exists = await this.config.adapter.fs.exists(candidatePath);
      if (exists) {
        appPath = extractRelativePathShared(candidatePath, this.config.projectDir);
        break;
      }
    }

    logger.info("[resolvePageData] Resolved page data", {
      slug,
      pagePath,
      pageType,
      layoutCount: layouts.length,
      providerCount: providers.length,
      appPath,
      headingsCount: headings.length,
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
    };
  }
}
