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
import { SSRRenderer } from "./ssr-renderer.ts";
import { setupSSRGlobals } from "./ssr-globals.ts";
import { getProjectReact } from "#veryfront/react";
import {
  type HTMLGenerationContext,
  HTMLGenerator,
  type HTMLGeneratorConfig,
} from "./orchestrator/html.ts";
import { ElementValidator } from "./element-validator/index.ts";
import { computeHash } from "./utils/index.ts";
import type * as React from "react";
// Note: LayoutOrchestrator not used - layouts applied via module loader directly
// import { LayoutOrchestrator } from "./orchestrator/layout.ts";
// import { SSROrchestrator } from "./orchestrator/ssr-orchestrator.ts";
import { generateTailwind4CSS } from "#veryfront/html/styles-builder/index.ts";
import { injectElementSelectors } from "#veryfront/studio/element-selector-injector.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { detectAppRouter } from "./router-detection.ts";

/**
 * Get environment variable (cross-platform: Deno, Node, Bun).
 */
function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

/**
 * Maximum concurrent renders per pod (configurable via RENDER_MAX_CONCURRENT).
 */
const RENDER_MAX_CONCURRENT = parseInt(getEnv("RENDER_MAX_CONCURRENT") ?? "30", 10);

/**
 * Maximum concurrent renders per project (noisy-neighbor protection).
 */
const RENDER_PER_PROJECT_LIMIT = parseInt(
  getEnv("RENDER_PER_PROJECT_LIMIT") ?? String(Math.ceil(RENDER_MAX_CONCURRENT / 3)),
  10,
);

/**
 * Timeout for acquiring render permit (ms).
 */
const RENDER_ACQUIRE_TIMEOUT_MS = 5000;

/**
 * Global render semaphore - limits concurrent renders across all projects per pod.
 */
const renderSemaphore = new Semaphore(RENDER_MAX_CONCURRENT);

/**
 * Per-project active render counter.
 */
const projectRenderCounts = new Map<string, number>();

/**
 * Acquire a project render slot (returns false if limit reached).
 */
function acquireProjectSlot(projectId: string): boolean {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return true;
  const current = projectRenderCounts.get(projectId) ?? 0;
  if (current >= RENDER_PER_PROJECT_LIMIT) return false;
  projectRenderCounts.set(projectId, current + 1);
  return true;
}

/**
 * Release a project render slot.
 */
function releaseProjectSlot(projectId: string): void {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return;
  const current = projectRenderCounts.get(projectId) ?? 0;
  if (current > 0) {
    projectRenderCounts.set(projectId, current - 1);
  }
}

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

        // Concurrency control - per-project limit
        if (!acquireProjectSlot(ctx.projectId)) {
          const activeCount = projectRenderCounts.get(ctx.projectId) ?? 0;
          logger.error("[JitRenderer] Per-project render limit reached", {
            slug,
            projectId: ctx.projectId,
            activeRenders: activeCount,
            limit: RENDER_PER_PROJECT_LIMIT,
          });
          throw new VeryfrontError(
            `Per-project render limit reached (${activeCount}/${RENDER_PER_PROJECT_LIMIT} active)`,
            ErrorCode.SERVICE_OVERLOADED,
            { slug, projectId: ctx.projectId },
          );
        }

        // Global semaphore
        const acquired = await renderSemaphore.tryAcquire(RENDER_ACQUIRE_TIMEOUT_MS);
        if (!acquired) {
          releaseProjectSlot(ctx.projectId);
          throw new VeryfrontError(
            `Render capacity exceeded (${renderSemaphore.waiting} waiting)`,
            ErrorCode.SERVICE_OVERLOADED,
            { slug, projectId: ctx.projectId },
          );
        }

        let result: RenderResult;
        let bundleFromCache = false;
        try {
          // Get or build the project bundle
          const bundleResult = await this.getBundle(ctx);
          bundleFromCache = bundleResult.fromCache;
          span?.setAttributes({
            "bundle.fromCache": bundleResult.fromCache,
            "bundle.durationMs": bundleResult.durationMs,
          });

          // Execute bundle and render
          result = await this.executeRender(slug, bundleResult.code, ctx, options);

          // Cache the rendered HTML
          if (cacheKey && !options?.skipCachePersist) {
            await this.cache.persistResult(result, slug, ctx, options?.colorScheme, cacheKey);
          }

          logger.debug("[JitRenderer] Render complete", {
            slug,
            projectId: ctx.projectId,
            duration: `${(performance.now() - startTime).toFixed(2)}ms`,
            bundleFromCache,
            htmlLength: result.html?.length ?? 0,
          });

          return result;
        } finally {
          renderSemaphore.release();
          releaseProjectSlot(ctx.projectId);
        }
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
    const isAppRouter = await detectAppRouter(ctx.projectDir, ctx.config, ctx.adapter);
    const router = isAppRouter ? "app" : "pages";
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
    const foundPage = await this.findFirstPageFile(fs, projectDir, baseDir, router);
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
   * Recursively find the first page file in a directory.
   * For App Router: looks for page.*, layout.*, etc.
   * For Pages Router: accepts any file with route extension (except special files)
   */
  private async findFirstPageFile(
    fs: RenderContext["adapter"]["fs"],
    projectDir: string,
    baseDir: string,
    router: "app" | "pages",
  ): Promise<string | null> {
    const basePath = `${projectDir}/${baseDir}`;
    const pageExtensions = new Set([".tsx", ".ts", ".mdx", ".md", ".jsx", ".js"]);
    const appRouterPatterns = ["page", "layout", "error", "loading", "not-found"];
    const pagesRouterIgnored = new Set(["_app", "_document", "_error", "api"]);

    const scanDir = async (dir: string, relativePath: string): Promise<string | null> => {
      try {
        for await (const entry of fs.readDir(dir)) {
          const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            // Skip api directories in Pages Router
            if (router === "pages" && entry.name === "api") continue;
            // Recursively scan subdirectories
            const found = await scanDir(`${dir}/${entry.name}`, entryRelPath);
            if (found) return found;
          } else if (entry.isFile) {
            const name = entry.name.toLowerCase();
            const dotIndex = name.lastIndexOf(".");
            const baseName = dotIndex === -1 ? name : name.slice(0, dotIndex);
            const ext = dotIndex === -1 ? "" : name.slice(dotIndex);

            if (!pageExtensions.has(ext)) continue;

            if (router === "app") {
              // App Router: require specific patterns (page.tsx, layout.tsx, etc.)
              if (appRouterPatterns.some((pattern) => name.startsWith(pattern))) {
                return `${baseDir}/${entryRelPath}`;
              }
            } else {
              // Pages Router: any file with route extension counts (except special files)
              if (!pagesRouterIgnored.has(baseName) && !baseName.startsWith("_")) {
                return `${baseDir}/${entryRelPath}`;
              }
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
      return null;
    };

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

          // If bundle exports a Component, render it with SSR
          if (Component) {
            span?.setAttribute("render.type", "component");
            return this.renderComponent(Component, slug, ctx, options);
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
   * Render a React component to HTML using SSR with full feature parity.
   *
   * This method implements the complete rendering pipeline:
   * 1. Page resolution - get actual page info
   * 2. Layout collection - discover nested layouts
   * 3. Data fetching - call getServerData/getStaticData
   * 4. Layout application - wrap component with layouts
   * 5. SSR rendering - render to HTML with head collection
   * 6. CSS generation - JIT Tailwind CSS
   * 7. Studio support - element selector injection
   */
  private async renderComponent(
    Component: unknown,
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult> {
    return withSpan(
      "jit-renderer.renderComponent",
      async (span?: Span) => {
        // Setup SSR globals
        setupSSRGlobals();

        // 1. Resolve the actual page
        const pageResolver = createPageResolver(ctx);
        const pageInfo = await pageResolver.resolvePage(slug);
        span?.setAttribute("page.path", pageInfo.entity.path);

        const fileExtension = getExtensionName(pageInfo.entity.path);
        const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
        const isInPagesDir = pageInfo.entity.path.includes("/pages/");
        const isInAppDir = pageInfo.entity.path.includes("/app/");

        // 2. Collect layouts
        const skipLayouts = isDotPath(slug, pageInfo.entity.path);
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
        span?.setAttribute("layout.count", layoutResult.nestedLayouts.length);

        // 3. Extract route params and fetch data
        let params: Record<string, string | string[]> = options?.params || {};
        if (options?.request && options?.url && Object.keys(params).length === 0) {
          const extracted = extractRouteParamsShared(pageInfo.entity.path, slug);
          if (extracted.matched) params = extracted.params;
        }

        let dataFetchingProps: Record<string, unknown> = {};
        const layoutDataMap = new Map<string, Record<string, unknown>>();

        if (options?.request && options?.url) {
          const dataContext: DataContext = {
            params,
            query: options.url.searchParams,
            request: options.request,
            url: options.url,
          };

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

          const modulesToLoad: ModuleToLoad[] = collectModulesToLoad(
            pageInfo.entity.path,
            isComponentPage,
            isInPagesDir || isInAppDir,
            layoutResult.nestedLayouts,
          );

          if (modulesToLoad.length > 0) {
            const dataFetcher = new DataFetcher(ctx.adapter);

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
                dataFetchingProps = result.props as Record<string, unknown>;
              } else {
                layoutDataMap.set(id, result.props as Record<string, unknown>);
              }
            }
          }
        }

        // 4. Get React and create element with fetched data
        const ReactLib = await getProjectReact();

        const componentProps = {
          slug,
          params,
          searchParams: options?.url?.searchParams
            ? Object.fromEntries(options.url.searchParams.entries())
            : {},
          ...dataFetchingProps,
          ...options?.props,
        };

        let pageElement: React.ReactElement;
        try {
          pageElement = ReactLib.createElement(
            Component as React.ComponentType<typeof componentProps>,
            componentProps,
          );
        } catch (error) {
          throw new VeryfrontError(
            `Failed to create React element: ${
              error instanceof Error ? error.message : String(error)
            }`,
            ErrorCode.RENDER_ERROR,
            { slug, projectId: ctx.projectId },
          );
        }

        // Validate element
        const elementValidator = new ElementValidator({
          debugMode: ctx.mode === "development",
        });
        const validatedElement = elementValidator.ensureValidReactElement(
          pageElement,
          ctx.mode === "development",
        );

        // 5. Apply layouts if any (simplified - layouts loaded via module loader)
        let wrappedElement = validatedElement;
        if (layoutResult.nestedLayouts.length > 0) {
          // For JIT renderer, layouts should be bundled with the component
          // or applied by wrapping with layout components loaded via module loader
          // This is a simplified approach - full layout orchestration would require
          // the complete legacy infrastructure
          logger.debug("[JitRenderer] Layouts discovered", {
            slug,
            layoutCount: layoutResult.nestedLayouts.length,
            layouts: layoutResult.nestedLayouts.map((l) => l.path),
          });

          // Load and apply layout components from innermost to outermost
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

          // Apply layouts in reverse order (innermost first, then wrap outward)
          for (const layout of [...layoutResult.nestedLayouts].reverse()) {
            if (!layout.componentPath && !layout.path) continue;
            const layoutPath = layout.componentPath || layout.path || "";

            try {
              const layoutModule = await loadModule(layoutPath, moduleLoaderConfig);
              const LayoutComponent = (layoutModule as { default?: unknown }).default;

              if (LayoutComponent && typeof LayoutComponent === "function") {
                const layoutProps = layoutDataMap.get(layoutPath) || {};
                wrappedElement = ReactLib.createElement(
                  LayoutComponent as React.ComponentType<Record<string, unknown>>,
                  {
                    ...layoutProps,
                    children: wrappedElement,
                  },
                );
              }
            } catch (error) {
              logger.warn("[JitRenderer] Failed to load layout", {
                layoutPath,
                error: String(error),
              });
              // Continue without this layout
            }
          }
        }

        // 6. Create SSR renderer and render with head collection
        const ssrRenderer = new SSRRenderer(
          ctx.mode,
          ctx.adapter,
          ctx.projectDir,
        );

        const wantsStream = options?.delivery === "stream";

        // Use head collector for metadata
        const { result: renderResult, head: collectedHead } = await runWithHeadCollector(() =>
          ssrRenderer.renderToHTML(wrappedElement, {
            mode: ctx.mode,
            wantsStream,
            debugMode: ctx.mode === "development",
          })
        );

        const { html: ssrHtml, stream } = renderResult;
        span?.setAttribute("ssr.html.length", ssrHtml.length);

        // Compute SSR hash for hydration
        const ssrHash = await computeHash(ssrHtml);

        // 7. Generate Tailwind CSS
        let css: string | undefined;
        try {
          css = await generateTailwind4CSS(ssrHtml);
          span?.setAttribute("css.generated", true);
          span?.setAttribute("css.length", css?.length ?? 0);
        } catch (error) {
          logger.warn("[JitRenderer] Tailwind CSS generation failed", {
            slug,
            error: String(error),
          });
        }

        // Extract frontmatter and headings
        const frontmatter = pageInfo.entity.frontmatter || {};
        const headings: Array<{ id: string; text: string; level: number }> = [];

        // 8. Create HTML generator for full page wrapping
        const htmlGeneratorConfig: HTMLGeneratorConfig = {
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          config: ctx.config,
          mode: ctx.mode === "development" ? "development" : "production",
        };
        const htmlGenerator = new HTMLGenerator(htmlGeneratorConfig);

        // Build generation context with all collected data
        const generationContext: HTMLGenerationContext = {
          html: ssrHtml,
          pageInfo,
          pageBundle: {
            compiledCode: "",
            frontmatter,
            headings,
          },
          layoutBundle: layoutResult.layoutBundle,
          nestedLayouts: layoutResult.nestedLayouts,
          collectedMetadata: {},
          slug,
          ssrHash,
          options,
          collectedHead,
        };

        // Generate full HTML document
        let fullHtml = await htmlGenerator.generateFullHTML(generationContext);

        // 9. Inject element selectors for Studio embed
        if (options?.studioEmbed) {
          fullHtml = injectElementSelectors(fullHtml);
          span?.setAttribute("studio.embed", true);
        }

        span?.setAttribute("html.length", fullHtml.length);

        logger.debug("[JitRenderer] Component rendered with full parity", {
          slug,
          projectId: ctx.projectId,
          ssrHtmlLength: ssrHtml.length,
          fullHtmlLength: fullHtml.length,
          layoutCount: layoutResult.nestedLayouts.length,
          hasDataProps: Object.keys(dataFetchingProps).length > 0,
          hasCss: !!css,
          studioEmbed: !!options?.studioEmbed,
        });

        return {
          html: fullHtml,
          css,
          frontmatter: frontmatter as RenderResult["frontmatter"],
          headings,
          stream: wantsStream ? stream : null,
          ssrHash,
        };
      },
      { "render.component": true },
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
