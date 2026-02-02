/**
 * JIT Renderer
 *
 * A production renderer that uses JIT-bundled code instead of on-demand transforms.
 * This eliminates path tokenization issues and ensures consistent rendering across pods.
 *
 * ## Architecture
 *
 * The JIT renderer follows a simplified flow:
 * 1. Compute content hash from project files
 * 2. Check bundle cache (API-backed distributed cache)
 * 3. On cache miss, bundle entire project with esbuild
 * 4. Execute bundle and render page
 * 5. Cache rendered HTML (like existing renderer)
 *
 * ## Benefits
 *
 * - Zero path tokenization (paths resolved at bundle time)
 * - Every pod serves identical content
 * - Automatic cache invalidation (content hash = key)
 * - Simplified caching (no transform cache, no http-cache recovery)
 *
 * @module rendering/jit-renderer
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { getOrBuildBundle, type JitBundleResult } from "#veryfront/bundler/jit-bundler.ts";
import { clearProjectModules, executeBundleForRender } from "#veryfront/bundler/bundle-executor.ts";
import type { RenderContext } from "./context/render-context.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import {
  ContextAwareCacheCoordinator,
  type ContextAwareCacheOptions,
} from "./shared/context-aware-cache.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { createPageResolver } from "./factories/service-factories.ts";
import { DataFetcher } from "#veryfront/data/index.ts";
import type { DataContext, PageWithData } from "#veryfront/data/types.ts";
import { LayoutCollector } from "./layouts/layout-collector.ts";
import type { LayoutCollectionResult } from "./orchestrator/layout.ts";
import { EMPTY_LAYOUT_RESULT, isDotPath } from "./orchestrator/path-helpers.ts";
import {
  createEsmCache,
  createModuleCache,
  loadModule,
  type ModuleLoaderConfig,
} from "./orchestrator/module-loader/index.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import {
  extractRelativePath as extractRelativePathShared,
  extractRouteParams as extractRouteParamsShared,
} from "#veryfront/utils/route-path-utils.ts";
import {
  collectModulesToLoad,
  hasDataFetchingFunction,
  type ModuleToLoad,
} from "./orchestrator/module-collection.ts";
import { withTimeoutThrow } from "./utils/stream-utils.ts";
import { createBuildVersion } from "#veryfront/utils/version.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

/**
 * Options for JIT renderer
 */
export interface JitRendererOptions {
  /** Cache options for rendered HTML */
  cache?: ContextAwareCacheOptions;
}

/**
 * Cached render result for Singleflight deduplication
 */
interface CachedRenderData {
  html: string;
  frontmatter: RenderResult["frontmatter"];
  headings?: RenderResult["headings"];
  ssrHash?: string;
  pageModule?: RenderResult["pageModule"];
}

/**
 * JIT Renderer - Production renderer using pre-built bundles
 *
 * This renderer is designed for production environments where:
 * - Bundles are cached and shared across pods
 * - Content changes trigger automatic cache invalidation
 * - No runtime transforms or path tokenization
 */
export class JitRenderer {
  private cache: ContextAwareCacheCoordinator;
  private renderFlight = new Singleflight<CachedRenderData>();
  private bundleCache = new Map<string, JitBundleResult>();

  constructor(options: JitRendererOptions = {}) {
    this.cache = new ContextAwareCacheCoordinator(options.cache);
  }

  /**
   * Render a page using JIT-bundled code
   */
  async renderPage(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    return withSpan(
      "jit-renderer.renderPage",
      async (span?: Span) => {
        span?.setAttributes({
          "renderer.slug": slug,
          "renderer.projectId": ctx.projectId,
          "renderer.environment": ctx.environment,
        });

        const startTime = performance.now();
        logger.debug("[JitRenderer] Rendering page", {
          slug,
          projectId: ctx.projectId,
          environment: ctx.environment,
        });

        // Check HTML cache first
        const cacheKey = this.buildCacheKey(slug, options);
        if (cacheKey && !options?.skipCacheCheck) {
          const cacheResult = await this.cache.checkCache(
            slug,
            ctx,
            options?.colorScheme,
            cacheKey,
          );
          if (cacheResult.hit && cacheResult.cachedResult) {
            logger.debug("[JitRenderer] HTML cache hit", {
              slug,
              projectId: ctx.projectId,
              duration: `${(performance.now() - startTime).toFixed(2)}ms`,
            });
            span?.setAttribute("cache.hit", "html");
            return cacheResult.cachedResult;
          }
        }

        // Get or build the project bundle
        const bundleResult = await this.getBundle(ctx);
        span?.setAttributes({
          "bundle.fromCache": bundleResult.fromCache,
          "bundle.durationMs": bundleResult.durationMs,
        });

        // Execute bundle and render
        const result = await this.executeRender(slug, bundleResult.code, ctx, options);

        // Cache the rendered HTML
        if (cacheKey && !options?.skipCachePersist) {
          await this.cache.persistResult(result, slug, ctx, options?.colorScheme, cacheKey);
        }

        logger.debug("[JitRenderer] Render complete", {
          slug,
          projectId: ctx.projectId,
          duration: `${(performance.now() - startTime).toFixed(2)}ms`,
          bundleFromCache: bundleResult.fromCache,
          htmlLength: result.html?.length ?? 0,
        });

        return result;
      },
      {
        "renderer.type": "jit",
        "renderer.projectId": ctx.projectId,
      },
    );
  }

  /**
   * Get or build the project bundle
   */
  private async getBundle(ctx: RenderContext): Promise<JitBundleResult> {
    // Check in-memory cache first
    const memoryCacheKey = `${ctx.projectId}:${ctx.contentSourceId}`;
    const cached = this.bundleCache.get(memoryCacheKey);
    if (cached) {
      return cached;
    }

    // Detect actual entry point
    const entryPoint = await this.detectEntryPoint(ctx);

    // Build/fetch bundle
    const result = await getOrBuildBundle({
      projectId: ctx.projectId,
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      reactVersion: ctx.config.react?.version,
      entryPoint,
    });

    // Cache in memory
    this.bundleCache.set(memoryCacheKey, result);

    return result;
  }

  /**
   * Detect the entry point for bundling by scanning for page files.
   *
   * Priority:
   * 1. Layout files (app/layout.tsx, app/layout.ts)
   * 2. Root page files (app/page.tsx, pages/index.tsx)
   * 3. Any page file found recursively
   */
  private async detectEntryPoint(ctx: RenderContext): Promise<string> {
    const router = ctx.config.router ?? "app";
    const fs = ctx.adapter.fs;
    const projectDir = ctx.projectDir;

    // Define candidate entry points in priority order
    const priorityCandidates = router === "app"
      ? [
        "app/layout.tsx",
        "app/layout.ts",
        "app/page.tsx",
        "app/page.ts",
        "app/page.mdx",
        "app/page.md",
      ]
      : [
        "pages/_app.tsx",
        "pages/_app.ts",
        "pages/index.tsx",
        "pages/index.ts",
        "pages/index.mdx",
        "pages/index.md",
      ];

    // Check priority candidates first
    for (const candidate of priorityCandidates) {
      const fullPath = `${projectDir}/${candidate}`;
      try {
        if (await fs.exists(fullPath)) {
          logger.debug("[JitRenderer] Detected entry point", {
            projectId: ctx.projectId,
            entryPoint: candidate,
          });
          return candidate;
        }
      } catch {
        // File doesn't exist, try next candidate
      }
    }

    // No priority candidate found - scan for any page file
    const baseDir = router === "app" ? "app" : "pages";
    const foundPage = await this.findFirstPageFile(fs, projectDir, baseDir);
    if (foundPage) {
      logger.debug("[JitRenderer] Found page file as entry point", {
        projectId: ctx.projectId,
        entryPoint: foundPage,
      });
      return foundPage;
    }

    // Fall back to default (will likely fail, but provides clear error)
    const fallback = router === "app" ? "app/layout.tsx" : "pages/_app.tsx";
    logger.warn("[JitRenderer] No entry point found, using fallback", {
      projectId: ctx.projectId,
      fallback,
    });
    return fallback;
  }

  /**
   * Recursively find the first page file in a directory
   */
  private async findFirstPageFile(
    fs: RenderContext["adapter"]["fs"],
    projectDir: string,
    baseDir: string,
  ): Promise<string | null> {
    const basePath = `${projectDir}/${baseDir}`;
    const pageExtensions = [".tsx", ".ts", ".mdx", ".md", ".jsx", ".js"];

    async function scanDir(dir: string, relativePath: string): Promise<string | null> {
      try {
        for await (const entry of fs.readDir(dir)) {
          const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            // Recursively scan subdirectories
            const found = await scanDir(`${dir}/${entry.name}`, entryRelPath);
            if (found) return found;
          } else if (entry.isFile) {
            // Check if it's a page file
            const isPageFile = entry.name.startsWith("page.") &&
              pageExtensions.some((ext) => entry.name.endsWith(ext));
            if (isPageFile) {
              return `${baseDir}/${entryRelPath}`;
            }
            // Also check for index files in pages router
            const isIndexFile = entry.name.startsWith("index.") &&
              pageExtensions.some((ext) => entry.name.endsWith(ext));
            if (isIndexFile) {
              return `${baseDir}/${entryRelPath}`;
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
      return null;
    }

    return scanDir(basePath, "");
  }

  /**
   * Execute the bundled code to render a page
   */
  private async executeRender(
    slug: string,
    bundleCode: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    return withSpan(
      "jit-renderer.executeRender",
      async (span?: Span) => {
        const cacheKey = `${ctx.projectId}:${ctx.contentSourceId}:bundle`;

        try {
          const { render, Component } = await executeBundleForRender(
            bundleCode,
            cacheKey,
            { projectId: ctx.projectId },
          );

          // If bundle exports a render function, use it directly
          if (render) {
            const html = await render({
              slug,
              projectId: ctx.projectId,
              projectSlug: ctx.projectSlug,
              environment: ctx.environment,
              colorScheme: options?.colorScheme,
              params: options?.params,
            });

            return {
              html: typeof html === "string" ? html : "",
              frontmatter: {},
              stream: null,
            };
          }

          // If bundle exports a Component, we need to render it with React
          if (Component) {
            // For now, return a placeholder - full React SSR integration would go here
            span?.setAttribute("render.type", "component");

            // This is where we'd integrate with ReactDOMServer
            // For MVP, we delegate to the existing SSR infrastructure
            throw new VeryfrontError(
              "Component-based bundles require SSR orchestrator integration",
              ErrorCode.RENDER_ERROR,
              { slug, projectId: ctx.projectId },
            );
          }

          throw new VeryfrontError(
            "Bundle does not export a render function or Component",
            ErrorCode.RENDER_ERROR,
            { slug, projectId: ctx.projectId },
          );
        } catch (error) {
          span?.setAttribute("error", true);
          span?.setAttribute("error.message", String(error));
          throw error;
        }
      },
      { "render.slug": slug },
    );
  }

  /**
   * Build a cache key for rendered HTML
   */
  private buildCacheKey(slug: string, options?: RenderOptions): string | null {
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

    const params = new URLSearchParams(url.searchParams);
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const queryString = sorted.map(([k, v]) => `${k}=${v}`).join("&");
    return queryString ? `${slug}?${queryString}` : slug;
  }

  /**
   * Resolve page data for client-side navigation (SPA transitions)
   * This enables the /_veryfront/page-data/{slug}.json endpoint
   */
  async resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse> {
    return withSpan(
      "jit-renderer.resolvePageData",
      async (span?: Span) => {
        span?.setAttributes({
          "renderer.slug": slug,
          "renderer.projectId": ctx.projectId,
        });

        const pageResolver = createPageResolver(ctx);
        const pageInfo = await pageResolver.resolvePage(slug);

        const skipLayouts = isDotPath(slug, pageInfo.entity.path);

        // Create LayoutCollector with a stub compileMDX since we don't need compiled layouts
        // for page data resolution - we only need the layout paths
        const stubCompileMDX = async (): Promise<MdxBundle> => ({
          compiledCode: "",
          frontmatter: {},
        });
        const layoutCollector = new LayoutCollector({
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          config: ctx.config,
          compileMDX: stubCompileMDX,
        });

        const layoutResult: LayoutCollectionResult = skipLayouts
          ? EMPTY_LAYOUT_RESULT
          : await layoutCollector.collectLayouts(pageInfo);

        const pagePath = extractRelativePathShared(pageInfo.entity.path, ctx.projectDir);
        const fileExtension = getExtensionName(pageInfo.entity.path);
        const pageType = fileExtension as PageDataResponse["pageType"];
        const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
        const isInPagesDir = pageInfo.entity.path.includes("/pages/");
        const isInAppDir = pageInfo.entity.path.includes("/app/");

        let pageProps: Record<string, unknown> = {};
        const layoutProps: Record<string, Record<string, unknown>> = {};
        let params: Record<string, string | string[]> = options?.params || {};

        // Extract route params from URL if not provided
        if (options?.request && options?.url && Object.keys(params).length === 0) {
          const extracted = extractRouteParamsShared(pageInfo.entity.path, slug);
          if (extracted.matched) params = extracted.params;
        }

        // Create ModuleLoaderConfig for loading modules with data fetching functions
        const moduleLoaderConfig: ModuleLoaderConfig = {
          projectDir: ctx.projectDir,
          projectId: ctx.projectId,
          contentSourceId: ctx.contentSourceId,
          adapter: ctx.adapter,
          mode: ctx.mode,
          moduleCache: createModuleCache(),
          esmCache: createEsmCache(),
          reactVersion: ctx.config.react?.version,
        };

        // Fetch data from modules if request context available
        if (options?.request && options?.url) {
          const dataContext: DataContext = {
            params,
            query: options.url.searchParams,
            request: options.request,
            url: options.url,
          };

          const modulesToLoad: ModuleToLoad[] = collectModulesToLoad(
            pageInfo.entity.path,
            isComponentPage,
            isInPagesDir || isInAppDir,
            layoutResult.nestedLayouts,
          );

          if (modulesToLoad.length > 0) {
            const dataFetcher = new DataFetcher(ctx.adapter);

            // Load modules and fetch data
            type LoadedModule = ModuleToLoad & { mod: unknown | null };
            const loadedModules: LoadedModule[] = await withTimeoutThrow(
              Promise.all(
                modulesToLoad.map((m) =>
                  loadModule(m.path, moduleLoaderConfig)
                    .then((mod) => ({ ...m, mod }))
                    .catch(() => ({ ...m, mod: null }))
                ),
              ),
              25000,
              `Module loading for ${slug}`,
            );

            const dataJobs = loadedModules
              .filter((r): r is LoadedModule & { mod: NonNullable<unknown> } =>
                r.mod !== null && hasDataFetchingFunction(r.mod)
              )
              .map((r) => ({
                type: r.type,
                id: r.id,
                promise: dataFetcher.fetchData(
                  r.mod as PageWithData<unknown>,
                  dataContext,
                  ctx.mode,
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

        // Extract frontmatter and headings for MDX pages
        const frontmatter: Record<string, unknown> = pageInfo.entity.frontmatter || {};
        const headings: Array<{ id: string; text: string; level: number }> = [];

        // Build layouts array with proper structure
        const layouts = layoutResult.nestedLayouts
          .filter((l: LayoutItem) => l.componentPath || l.path)
          .map((l: LayoutItem) => ({
            kind: l.kind,
            path: extractRelativePathShared(l.componentPath || l.path || "", ctx.projectDir),
          }));

        logger.debug("[JitRenderer] Resolved page data", {
          slug,
          projectId: ctx.projectId,
          pageType,
          hasPageProps: Object.keys(pageProps).length > 0,
          layoutCount: layouts.length,
        });

        return {
          slug,
          pagePath,
          pageType,
          layouts,
          providers: [],
          frontmatter,
          props: pageProps,
          params,
          layoutProps,
          buildVersion: createBuildVersion(),
          headings,
        };
      },
      { "resolver.type": "jit" },
    );
  }

  /**
   * Get all pages in the project
   */
  async getAllPages(ctx: RenderContext): Promise<string[]> {
    const pageResolver = createPageResolver(ctx);
    return pageResolver.getAllPages();
  }

  /**
   * Clear caches for a context
   */
  async clearCache(ctx: RenderContext, slug?: string): Promise<void> {
    // Clear HTML cache
    if (slug) {
      await this.cache.clearSlug(slug, ctx);
    } else {
      await this.cache.clearForContext(ctx);
    }

    // Clear in-memory bundle cache
    const memoryCacheKey = `${ctx.projectId}:${ctx.contentSourceId}`;
    this.bundleCache.delete(memoryCacheKey);

    // Clear module cache
    clearProjectModules(ctx.projectId);
  }

  /**
   * Clear all caches for a project
   */
  async clearCacheForProject(projectId: string): Promise<void> {
    await this.cache.clearForProject(projectId);

    // Clear all in-memory bundle caches for project
    for (const key of this.bundleCache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.bundleCache.delete(key);
      }
    }

    // Clear module cache
    clearProjectModules(projectId);
  }

  /**
   * Destroy the renderer and release resources
   */
  async destroy(): Promise<void> {
    await this.cache.destroy();
    this.bundleCache.clear();
  }
}

// Singleton instance
let jitRenderer: JitRenderer | null = null;

/**
 * Get or create the JIT renderer singleton
 */
export function getJitRenderer(options?: JitRendererOptions): JitRenderer {
  if (!jitRenderer) {
    jitRenderer = new JitRenderer(options);
  }
  return jitRenderer;
}

/**
 * Check if JIT renderer is initialized
 */
export function isJitRendererInitialized(): boolean {
  return jitRenderer !== null;
}

/**
 * Destroy the JIT renderer singleton
 */
export async function destroyJitRenderer(): Promise<void> {
  if (jitRenderer) {
    await jitRenderer.destroy();
    jitRenderer = null;
  }
}
