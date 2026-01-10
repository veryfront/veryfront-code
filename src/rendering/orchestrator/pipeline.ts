import { rendererLogger as logger } from "@veryfront/utils";
import { timeAsync } from "@veryfront/utils";
import { createBuildVersion } from "@veryfront/utils/version.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import {
  extractRelativePath as extractRelativePathShared,
  extractRouteParams as extractRouteParamsShared,
} from "@veryfront/core/utils/route-path-utils.ts";
import { join } from "../../platform/compat/path-helper.ts";
import type { MdxBundle } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
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

  constructor(config: RenderPipelineConfig) {
    this.config = config;
    this.dataFetcher = new DataFetcher(config.adapter);
  }

  private async generateHash(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  // Cache of transformed modules to avoid reprocessing
  private moduleCache = new Map<string, string>();
  // Cache of fetched esm.sh modules
  private esmCache = new Map<string, string>();

  /**
   * Rewrite import/export paths in esm.sh code.
   * Transforms absolute paths to https://esm.sh URLs and relative paths to resolved URLs.
   */
  private rewriteEsmPaths(code: string, urlBase: string): string {
    const resolveAbsolute = (path: string): string => `https://esm.sh${path}`;
    const resolveRelative = (path: string): string => new URL(path, urlBase).href;

    // Pattern configs: [pathPattern, pathGroupIndex, resolver]
    type PathResolver = (path: string) => string;
    const patterns: Array<[RegExp, number, PathResolver]> = [
      // Absolute paths (like "/@radix-ui/..." or "/react@...")
      [/import\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
      [/from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
      [/export\s*\*\s*from\s*(["'])(\/[^"']+)\1/g, 2, resolveAbsolute],
      [/export\s*\{([^}]+)\}\s*from\s*(["'])(\/[^"']+)\2/g, 3, resolveAbsolute],
      // Relative paths (like "./dist/..." or "../utils/...")
      [/import\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
      [/from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
      [/export\s*\*\s*from\s*(["'])(\.\.?\/[^"']+)\1/g, 2, resolveRelative],
      [/export\s*\{([^}]+)\}\s*from\s*(["'])(\.\.?\/[^"']+)\2/g, 3, resolveRelative],
    ];

    let result = code;
    for (const [pattern, pathIndex, resolver] of patterns) {
      result = result.replace(pattern, (...args) => {
        const match = args[0] as string;
        const path = args[pathIndex - 1] as string;
        const resolved = resolver(path);
        // Replace the path portion while preserving the rest of the match structure
        const quote = pathIndex === 3 ? args[2] : args[1];
        return match.replace(new RegExp(`${quote}${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${quote}`), `${quote}${resolved}${quote}`);
      });
    }

    return result;
  }

  // Fetch and cache an esm.sh module
  private async fetchEsmModule(
    url: string,
    tmpDir: string,
    localAdapter: RuntimeAdapter,
  ): Promise<string> {
    if (this.esmCache.has(url)) {
      return this.esmCache.get(url)!;
    }

    logger.debug("[RenderPipeline] Fetching esm.sh module:", url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    let code = await response.text();

    // Transform relative esm.sh paths to absolute URLs
    // esm.sh code is often minified with no spaces (e.g., from"/@pkg/...")
    const urlBase = url.substring(0, url.lastIndexOf("/") + 1);
    code = this.rewriteEsmPaths(code, urlBase);

    // Find ALL esm.sh URLs in the code and fetch/replace them
    // Use a simple pattern to find all https://esm.sh URLs
    const allEsmUrls = new Set<string>();
    const urlPattern = /["'](https:\/\/esm\.sh\/[^"']+)["']/g;
    let match;
    while ((match = urlPattern.exec(code)) !== null) {
      allEsmUrls.add(match[1]!);
    }

    // Fetch and cache all URLs in parallel for better performance
    const urlArray = Array.from(allEsmUrls);
    const cachedPaths = await Promise.all(
      urlArray.map((esmUrl) => this.fetchEsmModule(esmUrl, tmpDir, localAdapter)),
    );

    // Replace all occurrences with cached paths
    for (let i = 0; i < urlArray.length; i++) {
      code = code.split(urlArray[i]!).join(`file://${cachedPaths[i]}`);
    }

    // Generate hash for the URL to create unique filename
    const hash = await this.generateHash(url);
    const tempFilePath = `${tmpDir}/esm-${hash}.js`;
    await localAdapter.fs.writeFile(tempFilePath, code);

    this.esmCache.set(url, tempFilePath);
    return tempFilePath;
  }

  private async loadModule(filePath: string): Promise<any> {
    const { getGlobalTmpDir } = await import(
      "@veryfront/modules/react-loader/index.ts"
    );
    const tmpDir = await getGlobalTmpDir();
    const localAdapter = await getLocalAdapter();

    // Transform the module and all its @/ dependencies
    const tempFilePath = await this.transformModuleWithDeps(filePath, tmpDir, localAdapter);

    // Import using the original temp file path
    // Use dynamic import with proper base URL resolution
    const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;

    try {
      return await import(moduleUrl);
    } catch (importError) {
      // If file:// import fails, log the error for debugging
      logger.error("[RenderPipeline] Failed to import module:", {
        filePath,
        tempFilePath,
        error: importError instanceof Error ? importError.message : String(importError),
      });
      throw importError;
    }
  }

  // Get the local lib directory path (veryfront-private/lib)
  private getLocalLibDir(): string {
    // This file is at src/rendering/orchestrator/pipeline.ts
    // lib/ is at the root of veryfront-private
    const currentFile = new URL(import.meta.url).pathname;
    const srcIndex = currentFile.indexOf("/src/");
    if (srcIndex !== -1) {
      return currentFile.substring(0, srcIndex) + "/lib";
    }
    // Fallback: navigate up from current file location
    return currentFile.replace(/\/src\/rendering\/orchestrator\/pipeline\.ts$/, "/lib");
  }

  private async transformModuleWithDeps(
    filePath: string,
    tmpDir: string,
    localAdapter: RuntimeAdapter,
    useLocalAdapter = false,
  ): Promise<string> {
    // Check if already transformed
    if (this.moduleCache.has(filePath)) {
      return this.moduleCache.get(filePath)!;
    }

    // Use local adapter for local lib files, project adapter for user project files
    const adapter = useLocalAdapter ? localAdapter : this.config.adapter;
    const fileContent = await adapter.fs.readFile(filePath);
    const { transformToESM } = await import("@veryfront/transforms/esm-transform.ts");

    let transformedCode = await transformToESM(
      fileContent,
      filePath,
      this.config.projectDir,
      this.config.adapter,
      {
        projectId: this.config.projectDir,
        dev: this.config.mode === "development",
        ssr: true,
      },
    );

    // Find all @/ imports and transform them recursively
    const aliasImportPattern = /from\s+["'](@\/[^"']+)["']/g;
    const aliasImports: Array<{ full: string; path: string }> = [];
    let match;
    while ((match = aliasImportPattern.exec(transformedCode)) !== null) {
      aliasImports.push({ full: match[0], path: match[1]! });
    }

    // Find and transform esm.sh URLs - fetch them and cache locally
    // Dynamic import from file:// URLs doesn't support https:// imports
    const esmImportPattern = /from\s+(["'])(https:\/\/esm\.sh\/[^"']+)\1/g;
    const esmImports: Array<{ full: string; url: string }> = [];
    let esmMatch;
    while ((esmMatch = esmImportPattern.exec(transformedCode)) !== null) {
      esmImports.push({ full: esmMatch[0], url: esmMatch[2]! });
    }

    // Fetch and cache all esm.sh dependencies in parallel
    if (esmImports.length > 0) {
      const cachedPaths = await Promise.all(
        esmImports.map(({ url }) => this.fetchEsmModule(url, tmpDir, localAdapter)),
      );
      for (let i = 0; i < esmImports.length; i++) {
        transformedCode = transformedCode.replace(
          esmImports[i]!.full,
          `from "file://${cachedPaths[i]}"`,
        );
      }
    }

    // Transform each @/ dependency
    for (const { full, path } of aliasImports) {
      const relativePath = path.substring(2); // Remove @/ prefix

      let depFilePath: string | null = null;

      // Check if this is a @/lib/... import (framework utilities)
      // These are LOCAL to veryfront-private, not in the user's project
      let isLocalLib = false;
      if (relativePath.startsWith("lib/")) {
        depFilePath = await this.findLocalLibFile(relativePath, localAdapter);
        isLocalLib = true;
      } else {
        // For other @/ imports (shared/, etc.), look in user's project
        depFilePath = await this.findSourceFile(`components/${relativePath}`);
      }

      if (depFilePath) {
        const depTempPath = await this.transformModuleWithDeps(
          depFilePath,
          tmpDir,
          localAdapter,
          isLocalLib,
        );
        transformedCode = transformedCode.replace(full, `from "file://${depTempPath}"`);
      } else {
        logger.warn("[RenderPipeline] Could not find dependency:", path);
      }
    }

    // Write transformed code to temp file
    const hash = await this.generateHash(filePath);
    const tempFilePath = `${tmpDir}/mod-${hash}.js`;
    await localAdapter.fs.writeFile(tempFilePath, transformedCode);

    this.moduleCache.set(filePath, tempFilePath);
    return tempFilePath;
  }

  // Find local lib files (framework utilities in veryfront-private/lib)
  private async findLocalLibFile(
    relativePath: string,
    localAdapter: RuntimeAdapter,
  ): Promise<string | null> {
    const extensions = [".tsx", ".ts", ".jsx", ".js"];
    const libDir = this.getLocalLibDir();
    // relativePath is "lib/Router" or "lib/usePageContext" - strip "lib/" since we already have libDir
    const fileName = relativePath.replace(/^lib\//, "");

    // Build all candidate paths to check in parallel
    const candidates: string[] = [];
    for (const ext of extensions) {
      candidates.push(`${libDir}/${fileName}${ext}`);
    }
    for (const ext of extensions) {
      candidates.push(`${libDir}/${fileName}/index${ext}`);
    }

    // Check all paths in parallel
    const results = await Promise.all(
      candidates.map(async (fullPath) => {
        try {
          await localAdapter.fs.stat(fullPath);
          return fullPath;
        } catch {
          return null;
        }
      }),
    );

    // Return the first existing path (maintains priority order)
    for (const result of results) {
      if (result) {
        logger.debug("[RenderPipeline] Found local lib file:", result);
        return result;
      }
    }

    logger.debug("[RenderPipeline] Local lib file not found:", relativePath);
    return null;
  }

  private async findSourceFile(basePath: string): Promise<string | null> {
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
    const projectDir = this.config.projectDir;

    // Build all candidate paths to check in parallel
    // Priority order: direct with ext > direct index > without components prefix > without components index
    const candidates: string[] = [];

    // Priority 1: With components/ prefix (for @/ aliased imports)
    for (const ext of extensions) {
      candidates.push(`${projectDir}/${basePath}${ext}`);
    }
    // Priority 2: Index file with components/ prefix
    for (const ext of extensions) {
      candidates.push(`${projectDir}/${basePath}/index${ext}`);
    }

    // Priority 3 & 4: Without components/ prefix
    const withoutComponents = basePath.replace(/^components\//, "");
    if (withoutComponents !== basePath) {
      for (const ext of extensions) {
        candidates.push(`${projectDir}/${withoutComponents}${ext}`);
      }
      for (const ext of extensions) {
        candidates.push(`${projectDir}/${withoutComponents}/index${ext}`);
      }
    }

    // Check all paths in parallel
    const results = await Promise.all(
      candidates.map(async (fullPath) => {
        try {
          await this.config.adapter.fs.stat(fullPath);
          return fullPath;
        } catch {
          return null;
        }
      }),
    );

    // Return the first existing path (maintains priority order)
    for (const result of results) {
      if (result) {
        logger.debug("[RenderPipeline] Found file:", result);
        return result;
      }
    }

    logger.debug("[RenderPipeline] File not found:", basePath);
    return null;
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

    const fileExtension = pageInfo.entity.id.split(".").pop()?.toLowerCase() || "";
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.id.includes("/pages/");

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 3: Route Params Extraction
    // Stage 4: Data Fetching (parallel jobs for page + layouts)
    // ─────────────────────────────────────────────────────────────────────────
    if (options?.request && options?.url) {
      try {
        if (!options.params || Object.keys(options.params).length === 0) {
          logger.debug("[renderPage] Extracting route params", {
            slug,
            pageId: pageInfo.entity.id,
          });

          const extracted = extractRouteParamsShared(pageInfo.entity.id, slug);
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
            id: pageInfo.entity.id,
            run: async () => {
              const mod = await this.loadModule(pageInfo.entity.id);
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
    const pagePath = extractRelativePathShared(pageInfo.entity.id, this.config.projectDir);
    const fileExtension = pageInfo.entity.id.split(".").pop()?.toLowerCase() || "tsx";
    const pageType = fileExtension as PageDataResponse["pageType"];
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.id.includes("/pages/");

    // 4. Initialize data structures
    let pageProps: Record<string, unknown> = {};
    const layoutProps: Record<string, Record<string, unknown>> = {};
    let params: Record<string, string | string[]> = options?.params || {};

    // 5. Extract route params if not provided
    if (options?.request && options?.url && Object.keys(params).length === 0) {
      const extracted = extractRouteParamsShared(pageInfo.entity.id, slug);
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
        const mod = await this.loadModule(pageInfo.entity.id);
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

    // 7. Extract frontmatter
    let frontmatter: Record<string, unknown> = {};
    if (pageType === "mdx" && pageInfo.entity) {
      // For MDX pages, try to get frontmatter from the bundle
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
      } catch {
        // Frontmatter extraction failed, use empty object
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
    const wrappedAdapter = (this.config.adapter?.fs as { fsAdapter?: unknown })?.fsAdapter;
    if (
      (wrappedAdapter as { constructor?: { name?: string } })?.constructor?.name ===
        "VeryfrontFSAdapter"
    ) {
      const projectData =
        (wrappedAdapter as { getProjectData?: () => { updatedAt?: string } | undefined })
          ?.getProjectData?.();
      projectUpdatedAt = projectData?.updatedAt;
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
    };
  }
}
