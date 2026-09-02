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
import { isMissingProjectSourceError } from "../ssr-outcome.ts";
import { buildQueryAwareCacheKey } from "#veryfront/cache/keys.ts";
import {
  buildDependencyPinnedRenderCacheKey,
  type RenderCacheKeyComposition,
} from "#veryfront/cache/keys/dependency-pinning.ts";
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
import type {
  DataContext,
  DataResponseMetadata,
  PageWithData,
  ResponseCookie,
} from "#veryfront/data/types.ts";
import {
  attachDataResponseMetadata,
  mergeDataResponseMetadata,
  unwrapDataResponseMetadataError,
  wrapDataResponseMetadataError,
} from "#veryfront/data/response-metadata.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { setupSSRGlobals } from "../ssr-globals.ts";
import { LAYOUT_EXTENSIONS } from "../layouts/types.ts";
import type { LayoutItem } from "#veryfront/types";
import {
  type ProgressTimeoutControl,
  withProgressTimeoutThrow,
  withTimeout,
  withTimeoutThrow,
} from "../utils/stream-utils.ts";
import { extractCandidates, generateTailwindCSS } from "#veryfront/html/styles-builder/index.ts";
import { buildReleaseAssetModules } from "#veryfront/release-assets/client-module-map.ts";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { getReadyManifestForRender } from "#veryfront/release-assets/manifest-cache.ts";
import { createEsmCache, createModuleCache, loadModule } from "./module-loader/index.ts";
import { isBuildFailure, isTenantBuildFailure } from "./module-loader/build-failure.ts";
import type { ModuleLoaderConfig } from "./module-loader/index.ts";
import {
  getCSSImportReferences,
  runWithCSSCollector,
} from "#veryfront/modules/react-loader/css-import-collector.ts";
import { assembleRenderResult } from "./render-result-assembly.ts";
import { isMdxEsmExportMismatchError, recoverStaleMdxEsmPreviewCaches } from "../page-rendering.ts";
import {
  createDependencyPinningSource,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
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
  MODULE_LOAD_HARD_TIMEOUT_MS,
  MODULE_LOAD_TIMEOUT_MS,
  moduleLoadLabel,
  type ModuleToLoad,
  SSR_RENDER_TIMEOUT_MS,
} from "./module-collection.ts";

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
  checkCache(slug: string, cacheKey?: string, nonce?: string): Promise<CacheLookupResult>;
  persistResult(
    result: RenderResult,
    slug: string,
    cacheKey?: string,
    nonce?: string,
  ): Promise<void>;
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
  isLocalProject: boolean;
  /** Narrow host-owned capability for project-code execution. */
  allowHostProjectCodeExecution?: boolean;
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
  /** Prefixes applied after the pipeline returns a render cache override. */
  renderCacheKeyComposition?: Omit<RenderCacheKeyComposition, "colorScheme">;
}

interface DataResolutionResult {
  params: Record<string, string | string[]>;
  pageProps: Record<string, unknown>;
  layoutProps: Map<string, Record<string, unknown>>;
  headers?: Record<string, string>;
  cookies?: ResponseCookie[];
}

interface MdxMetadataResult {
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

interface DataWorkerIdentity {
  readonly isLocalProject: boolean;
  readonly allowHostProjectCodeExecution: boolean;
  readonly workerScope?: string;
  readonly sourceGeneration?: string;
}

const PRE_RESOLVED_DATA = Symbol("veryfront.preResolvedData");

type InternalRenderOptions = RenderOptions & {
  [PRE_RESOLVED_DATA]?: DataResolutionResult;
};

function stripInternalRenderOptions(options: InternalRenderOptions): RenderOptions {
  const { [PRE_RESOLVED_DATA]: _preResolvedData, ...publicOptions } = options;
  return publicOptions;
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

  private getDependencyPinningSource() {
    return createDependencyPinningSource({
      projectDir: this.config.projectDir,
      adapter: this.config.adapter,
      isLocalProject: this.config.isLocalProject,
      projectId: this.config.projectId,
      contentSourceId: this.config.contentSourceId,
      config: this.config.config,
    });
  }

  private getReactVersion(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
  ): Promise<string> {
    if (
      dependencyPinningDependencies !== undefined ||
      dependencyPinningCacheKey?.startsWith("on:")
    ) {
      return resolveProjectReactVersion({
        projectDir: this.config.projectDir,
        config: this.config.config,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
      });
    }

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
    options?: Pick<
      RenderOptions,
      | "projectId"
      | "contentSourceId"
      | "url"
      | "dependencyPinningCacheKey"
      | "dependencyPinningDependencies"
      | "dependencyPinningSource"
    >,
  ): Promise<ModuleLoaderConfig> {
    const dependencyPinningSource = options?.dependencyPinningSource ??
      this.getDependencyPinningSource();
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      dependencyPinningSource,
      options?.dependencyPinningCacheKey,
      options?.dependencyPinningDependencies,
    );
    const reactVersion = await this.getReactVersion(
      dependencySnapshot.cacheKey,
      dependencySnapshot.dependencies,
    );
    return {
      ...this.moduleLoaderConfig,
      projectId: options?.projectId ?? this.config.projectId ?? this.config.projectDir,
      contentSourceId: options?.contentSourceId ?? this.config.contentSourceId,
      reactVersion,
      moduleServerOrigin: dependencySnapshot.cacheKey.startsWith("on:")
        ? options?.url?.origin
        : undefined,
      serverExternalPackages: this.config.config?.build?.serverExternalPackages,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
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
   * A layout module that fails to load does not stop this phase: the page
   * continues without that layout's data, and the apply phase loads the layout
   * again. That second attempt is what decides the render, so a failure here is
   * only provisional - unless the project's source is gone, in which case the
   * reload fails identically and the render is already over.
   */
  private async loadModulesInParallel(
    modules: ModuleToLoad[],
    options?: Pick<
      RenderOptions,
      | "projectId"
      | "contentSourceId"
      | "url"
      | "dependencyPinningCacheKey"
      | "dependencyPinningDependencies"
      | "dependencyPinningSource"
    >,
    timeoutControl?: ProgressTimeoutControl,
  ): Promise<LoadedModule[]> {
    const moduleLoaderConfig = await this.resolveModuleLoaderConfig(options);
    if (timeoutControl) {
      const completedMilestones = new Set<string>();
      moduleLoaderConfig.signal = timeoutControl.signal;
      moduleLoaderConfig.onProgress = ({ phase, filePath }) => {
        const milestone = `${phase}:${filePath ?? ""}`;
        if (completedMilestones.has(milestone)) return;
        completedMilestones.add(milestone);
        const fileName = filePath?.split("/").pop();
        timeoutControl.mark(fileName ? `${phase}:${fileName}` : phase);
      };
    }
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
    const criticalFailures: Array<{
      path: string;
      error: string;
      buildFailure: boolean;
      tenantBuildFailure: boolean;
      missingSource: boolean;
    }> = [];

    for (const result of results) {
      if (result.mod && !result.error) {
        loaded.push({ type: result.type, id: result.id, path: result.path, mod: result.mod });
        continue;
      }

      if (!result.error) continue;

      const errorMessage = result.error.message;

      if (result.type === "page") {
        criticalFailures.push({
          path: result.path,
          error: errorMessage,
          buildFailure: isBuildFailure(result.error),
          tenantBuildFailure: isTenantBuildFailure(result.error),
          missingSource: isMissingProjectSourceError(result.error),
        });
        renderPageLog.error("Critical page module failed to load", {
          path: result.path,
          error: errorMessage,
        });
        continue;
      }

      if (isMissingProjectSourceError(result.error)) {
        // The apply phase reloads this layout from the same unreachable source,
        // so the render is already lost. Logging it as a recoverable warning
        // misleads anyone triaging by severity.
        renderPageLog.error("Layout module source is unavailable; render will fail", {
          path: result.path,
          error: errorMessage,
        });
        continue;
      }

      renderPageLog.warn("Layout module failed to load; apply phase will retry it", {
        path: result.path,
        error: errorMessage,
      });
    }

    if (criticalFailures.length > 0) {
      const failedDetails = criticalFailures
        .map((f) => `${f.path}: ${f.error}`)
        .join("\n");
      // A page module the adapter could not retrieve is the same condition the
      // layout path already answers 404 for, so it is re-raised with the same
      // identity the adapter used. Wrapping it in a `render-error` would answer
      // 500 for a deleted project on the page path while answering 404 on the
      // layout path.
      //
      // `every`, matching `tenantBuildFailure` below: one module that loaded and
      // threw, or an infrastructure `file-not-found` such as http-cache's write
      // verification, must not be reported as an absent release.
      const missingSource = criticalFailures.every((f) => f.missingSource);
      const failure = (missingSource ? FILE_NOT_FOUND : RENDER_ERROR).create({
        detail: `Critical page module(s) failed to load:\n${failedDetails}`,
        context: {
          criticalFailures,
          // A module that never compiled is a developer-facing build failure;
          // one that compiled and threw at module scope is an application
          // error the project's own error page should present.
          buildFailure: criticalFailures.some((f) => f.buildFailure),
          // Only explicit compiler/source classifications may affect
          // observability severity. Infrastructure can fail in the same phase.
          //
          // `every` rather than `some`: today `criticalFailures` holds at most
          // one entry (collectModulesToLoad pushes exactly one `type: "page"`,
          // and only pages reach here), so the two are equivalent. If that ever
          // changes, one tenant mistake must not downgrade a framework fault
          // that failed alongside it. The array is non-empty inside this branch,
          // so `every` cannot vacuously return true.
          tenantBuildFailure: criticalFailures.every((f) => f.tenantBuildFailure),
          loadedCount: loaded.length,
          totalModules: modules.length,
        },
      });

      // Carry the adapter's own marker across the re-raise so that one notion of
      // "absent project source" holds on both sides of this boundary, rather
      // than the slug alone standing in for it here.
      throw missingSource ? Object.assign(failure, { code: "ENOENT" }) : failure;
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

    if (!options?.url || (!options.staticDataOnly && !options.request)) {
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
      query: options.staticDataOnly ? new URLSearchParams() : options.url.searchParams,
      request: options.request ?? new Request(options.url, { method: "GET" }),
      url: options.url,
      identity: options.applicationIdentity ?? null,
      applicationIdentity: options.applicationIdentity ?? null,
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
            withProgressTimeoutThrow(
              (control) => this.loadModulesInParallel(modulesToLoad, options, control),
              {
                idleTimeoutMs: MODULE_LOAD_TIMEOUT_MS,
                hardTimeoutMs: options.abortSignal ? undefined : MODULE_LOAD_HARD_TIMEOUT_MS,
                label: moduleLoadLabel(slug, options.url?.pathname ?? ""),
                signal: options.abortSignal,
              },
            ),
          { "render.module_count": modulesToLoad.length },
        ),
    );

    const dataJobs = loadedModules.filter((m) =>
      options?.staticDataOnly
        ? typeof (m.mod as PageWithData).getStaticData === "function"
        : hasDataFetchingFunction(m.mod)
    );
    if (dataJobs.length === 0) {
      return { params, pageProps, layoutProps };
    }

    const dataWorkerIdentity = await this.resolveDataWorkerIdentity(options);

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
                    const fetchOptions: FetchDataOptions = {
                      modulePath: jobPath,
                      projectDir: this.config.projectDir,
                      ...dataWorkerIdentity,
                    };
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

    const responseMetadata = this.applyFetchedDataResults(
      slug,
      dataResults,
      pageProps,
      layoutProps,
    );

    return { params, pageProps, layoutProps, ...responseMetadata };
  }

  /**
   * Build a host-owned worker generation for raw local data modules.
   *
   * A mutable source may only reuse a Worker when its filesystem adapter
   * supplies an exact snapshot generation. Otherwise the data fetcher selects
   * a single-use Worker so an imported module graph cannot survive a source
   * change. Production releases are immutable and may use the release id.
   */
  private async resolveDataWorkerIdentity(
    options: RenderOptions | undefined,
  ): Promise<DataWorkerIdentity> {
    const isLocalProject = this.config.isLocalProject === true;
    const allowHostProjectCodeExecution = isLocalProject ||
      this.config.allowHostProjectCodeExecution === true;
    if (!isLocalProject) {
      return { isLocalProject, allowHostProjectCodeExecution };
    }

    const sourceSnapshotVersion = await this.config.adapter.fs
      .getSourceSnapshotVersion?.();
    const releaseId = options?.releaseId;
    if (!releaseId && sourceSnapshotVersion === undefined) {
      return { isLocalProject, allowHostProjectCodeExecution };
    }

    const workerScope = this.config.projectId ?? this.config.projectDir;
    const sourceGeneration = JSON.stringify({
      releaseId: releaseId ?? null,
      sourceSnapshotVersion: sourceSnapshotVersion ?? null,
      contentSourceId: options?.contentSourceId ?? this.config.contentSourceId ?? null,
      environment: options?.environment ?? null,
      dependencyPinningCacheKey: options?.dependencyPinningCacheKey ?? null,
    });
    return {
      isLocalProject,
      allowHostProjectCodeExecution,
      workerScope,
      sourceGeneration,
    };
  }

  private applyFetchedDataResults(
    slug: string,
    dataResults: FetchedDataResult[],
    pageProps: Record<string, unknown>,
    layoutProps: Map<string, Record<string, unknown>>,
  ): DataResponseMetadata {
    // Layouts are collected outermost to innermost. Apply them in that order,
    // then the page, so the closest owner wins a duplicate custom header.
    // Cookies remain distinct and preserve the same outer-to-inner-to-page order.
    const responseMetadata = mergeDataResponseMetadata(
      [
        ...dataResults.filter(({ type }) => type === "layout"),
        ...dataResults.filter(({ type }) => type === "page"),
      ]
        .flatMap(({ result }) => result ? [result] : []),
    );

    for (const { type, id, result, error } of dataResults) {
      if (error) {
        if (responseMetadata.headers || responseMetadata.cookies) {
          throw wrapDataResponseMetadataError(error, responseMetadata);
        }
        throw error;
      }
      if (!result) continue;

      if (result.notFound) {
        throw attachDataResponseMetadata(
          FILE_NOT_FOUND.create({
            detail: "Page/Layout returned notFound",
            context: { slug, component: id },
          }),
          responseMetadata,
        );
      }

      if (result.redirect) {
        throw attachDataResponseMetadata(
          RENDER_ERROR.create({
            detail: `Redirect to ${result.redirect.destination}`,
            context: { slug, redirect: result.redirect },
          }),
          responseMetadata,
        );
      }

      if (!result.props) continue;

      if (type === "page") {
        Object.assign(pageProps, result.props as Record<string, unknown>);
      } else {
        layoutProps.set(id, result.props as Record<string, unknown>);
      }
    }

    return responseMetadata;
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pipelineStartTime = performance.now();
    const timing: Record<string, number> = {};
    const dependencyPinningSource = options?.dependencyPinningSource ??
      this.getDependencyPinningSource();
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      dependencyPinningSource,
      options?.dependencyPinningCacheKey,
      options?.dependencyPinningDependencies,
    );
    const dependencyPinningCacheKey = dependencySnapshot.cacheKey;
    options = {
      ...options,
      dependencyPinningCacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
    };
    const projectSlug = options?.projectSlug || options?.projectId || "unknown";
    const projectId = options?.projectId ?? this.config.projectId ?? this.config.projectDir;
    const cacheKey = this.buildCacheKey(slug, options, dependencyPinningCacheKey);

    let cacheResult: Awaited<ReturnType<typeof this.config.cacheCoordinator.checkCache>> | null =
      null;

    const shouldCache = cacheKey !== null && options?.delivery !== "stream";

    if (shouldCache && !options?.skipCacheCheck) {
      const cacheCheckStart = performance.now();
      cacheResult = await this.config.cacheCoordinator.checkCache(slug, cacheKey, options?.nonce);
      timing.cacheCheck = Math.round(performance.now() - cacheCheckStart);

      if (cacheResult?.cachedResult) {
        renderPipelineLog.debug("Cache HIT", { slug, projectSlug, timing });
        return cacheResult.cachedResult;
      }
    }

    setupSSRGlobals();

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId, { preserveActiveTransforms: true });
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
                  () =>
                    this.config.pageResolver.resolvePage(slug, {
                      signal: options?.abortSignal,
                    }),
                  { "render.slug": slug },
                ),
            );
            timing.pageResolve = Math.round(performance.now() - pageResolveStart);

            const sourceFile = extractRelativePathShared(
              pageInfo.entity.path,
              this.config.projectDir,
            );
            let responseHeaders: Record<string, string> | undefined;
            let responseCookies: ResponseCookie[] | undefined;

            try {
              const skipLayouts = isDotPath({
                slug,
                filePath: pageInfo.entity.path,
                projectDir: this.config.projectDir,
              });

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
                ? this.config.layoutOrchestrator.preloadLayoutModules(
                  layoutResult.nestedLayouts,
                  options?.dependencyPinningCacheKey,
                  options?.dependencyPinningDependencies,
                  options?.dependencyPinningSource,
                  options?.url?.origin,
                  options?.abortSignal,
                  options?.environment,
                )
                : Promise.resolve();

              let dataFetchingProps: Record<string, unknown> | undefined;
              let resolvedParams: Record<string, string | string[]> = options?.params
                ? { ...options.params }
                : {};
              let layoutDataMap = new Map<string, Record<string, unknown>>();

              const dataFetchStart = performance.now();
              const internalPreResolvedData = (options as InternalRenderOptions | undefined)?.[
                PRE_RESOLVED_DATA
              ];
              const renderInputOptions = internalPreResolvedData && options
                ? stripInternalRenderOptions(options as InternalRenderOptions)
                : options;
              if (internalPreResolvedData) {
                resolvedParams = internalPreResolvedData.params;
                dataFetchingProps = Object.keys(internalPreResolvedData.pageProps).length > 0
                  ? internalPreResolvedData.pageProps
                  : undefined;
                layoutDataMap = internalPreResolvedData.layoutProps;
                responseHeaders = internalPreResolvedData.headers;
                responseCookies = internalPreResolvedData.cookies;
              } else if (options?.url && (options.request || options.staticDataOnly)) {
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
                          responseHeaders = dataResolution.headers;
                          responseCookies = dataResolution.cookies;
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
                  ...renderInputOptions,
                  ...(hasResolvedParams ? { params: resolvedParams } : {}),
                  ...(dataFetchingProps
                    ? { props: { ...renderInputOptions?.props, ...dataFetchingProps } }
                    : {}),
                }
                : renderInputOptions;

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

              if (pageBundleResult.scriptResult) {
                const scriptResponseMetadata = mergeDataResponseMetadata([
                  {
                    ...(pageBundleResult.scriptResult.headers
                      ? { headers: pageBundleResult.scriptResult.headers }
                      : {}),
                    ...(pageBundleResult.scriptResult.cookies
                      ? { cookies: pageBundleResult.scriptResult.cookies }
                      : {}),
                  },
                  {
                    ...(responseHeaders ? { headers: responseHeaders } : {}),
                    ...(responseCookies ? { cookies: responseCookies } : {}),
                  },
                ]);
                return { ...pageBundleResult.scriptResult, ...scriptResponseMetadata };
              }

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
                        dataFetchingProps,
                        options?.dependencyPinningCacheKey,
                        options?.dependencyPinningDependencies,
                        options?.dependencyPinningSource,
                        options?.abortSignal,
                        options?.environment,
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
              const collectedCSSImports = getCSSImportReferences();

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
                            options: renderOptions,
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
                  paths: collectedCSSImports.map((entry) => entry.moduleKey.split("/").pop()),
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
                nonce: renderOptions.nonce,
                headers: responseHeaders,
                cookies: responseCookies,
              });

              timing.total = Math.round(performance.now() - pipelineStartTime);
              renderPipelineLog.debug("Complete", { slug, timing });

              return result;
            } catch (error) {
              if (error instanceof Error) {
                const classifiedError = unwrapDataResponseMetadataError(error);
                const sourceError = classifiedError instanceof Error ? classifiedError : error;
                (sourceError as Error & { sourceFile?: string }).sourceFile = sourceFile;
              }
              if (responseHeaders || responseCookies) {
                throw wrapDataResponseMetadataError(
                  error,
                  mergeDataResponseMetadata([
                    {
                      ...(responseHeaders ? { headers: responseHeaders } : {}),
                      ...(responseCookies ? { cookies: responseCookies } : {}),
                    },
                  ]),
                );
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
          mode: this.config.mode,
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
    const dependencyPinningSource = options?.dependencyPinningSource ??
      this.getDependencyPinningSource();
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      dependencyPinningSource,
      options?.dependencyPinningCacheKey,
      options?.dependencyPinningDependencies,
    );
    options = {
      ...options,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource,
    };

    const projectId = options?.projectId ?? this.config.projectId ?? this.config.projectDir;

    if (this.config.mode === "development") {
      clearSSRModuleCacheForProject(projectId, { preserveActiveTransforms: true });
    }

    const pageInfo = await profilePhase(
      "page_data.resolve_page",
      () =>
        this.config.pageResolver.resolvePage(slug, {
          signal: options?.abortSignal,
        }),
    );

    const skipLayouts = isDotPath({
      slug,
      filePath: pageInfo.entity.path,
      projectDir: this.config.projectDir,
    });
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
        this.extractMdxMetadata(
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
    const errorPath = await profilePhase(
      "page_data.resolve_error_path",
      async () => {
        const resolved = await this.config.ssrOrchestrator.resolveErrorComponentPath({
          pageInfo,
          pageBundle: {} as PageBundle,
          layoutBundle: layoutResult.layoutBundle,
          nestedLayouts: layoutResult.nestedLayouts,
          collectedMetadata: {},
          slug,
          cssImports: [],
          options,
        });
        return resolved ? extractRelativePathShared(resolved, this.config.projectDir) : undefined;
      },
    );

    const { css, cssAction, cssError } = await profilePhase(
      "page_data.resolve_css",
      () => this.resolvePageDataCss(slug, options, projectUpdatedAt, dataResolution),
    );

    resolvePageDataLog.debug("Resolved page data", {
      slug,
      pagePath,
      pageType,
      layoutCount: layouts.length,
      appPath,
      errorPath,
      isolatedClientPage: pageIslandPlan ? true : undefined,
      requiresFullDocumentNavigation: pageIslandPlan?.serverLayouts.length ? true : undefined,
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
      ...(dependencySnapshot.cacheKey === "off"
        ? {}
        : { dependencyPinningCacheKey: dependencySnapshot.cacheKey }),
      appPath,
      errorPath,
      isolatedClientPage: pageIslandPlan ? true : undefined,
      requiresFullDocumentNavigation: pageIslandPlan?.serverLayouts.length ? true : undefined,
      releaseId: options?.releaseId,
      releaseAssetModules: buildReleaseAssetModules(options?.releaseAssetManifest),
      headings,
      css,
      cssAction,
      cssError,
    };
  }

  private async extractMdxMetadata(
    pageType: PageDataResponse["pageType"],
    pageInfo: Awaited<ReturnType<PageResolver["resolvePage"]>>,
    slug: string,
    options: RenderOptions | undefined,
    params: Record<string, string | string[]>,
  ): Promise<MdxMetadataResult> {
    if (pageType !== "mdx") {
      return { frontmatter: {}, headings: [] };
    }

    try {
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
      return {
        frontmatter: pageBundle && "frontmatter" in pageBundle
          ? (pageBundle as { frontmatter?: Record<string, unknown> }).frontmatter || {}
          : {},
        headings: pageBundle && "headings" in pageBundle
          ? (pageBundle as {
            headings?: Array<{ id: string; text: string; level: number }>;
          }).headings || []
          : [],
      };
    } catch (error) {
      renderPipelineLog.error("Frontmatter/headings extraction failed", {
        slug,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { frontmatter: {}, headings: [] };
    }
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
    dataResolution: DataResolutionResult,
  ): Promise<PageCssResult> {
    if (this.hasReadyReleaseCss(options)) {
      return { css: undefined, cssAction: "clear", cssError: undefined };
    }

    const cssCacheKey = getPageCssCacheKey(
      options?.projectId,
      options?.environment,
      slug,
      projectUpdatedAt,
      options?.dependencyPinningCacheKey,
      options?.url?.origin,
    );

    const cachedCss = getCachedPageCss(cssCacheKey);
    if (cachedCss) {
      resolvePageDataLog.debug("CSS cache hit", { slug, cssLength: cachedCss.length });
      return { css: cachedCss, cssAction: undefined, cssError: undefined };
    }

    try {
      const cssRenderOptions: InternalRenderOptions = {
        ...options,
        delivery: "string",
        skipCacheCheck: true,
        skipCachePersist: true,
        [PRE_RESOLVED_DATA]: dataResolution,
      };

      const renderResult = await profilePhase(
        "page_data.css.render_html",
        () =>
          withTimeout(
            this.renderPage(slug, cssRenderOptions),
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
        cssError: `CSS generation failed: ${errorMessage}`,
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
  private buildCacheKey(
    slug: string,
    options: RenderOptions | undefined,
    dependencyPinningCacheKey: string,
  ): string | null {
    const composition: RenderCacheKeyComposition = {
      ...(this.config.renderCacheKeyComposition ?? {}),
      colorScheme: options?.colorScheme,
    };
    const environment = options?.environment === "preview" ? "preview" : "production";
    if (options?.cacheKey) {
      const cacheKey = `${options.cacheKey}:environment-${environment}`;
      return buildDependencyPinnedRenderCacheKey(
        cacheKey,
        dependencyPinningCacheKey,
        options.url?.origin,
        composition,
      );
    }
    const req = options?.request;
    if (req) {
      if (requestHasCacheSensitiveState(req)) return null;
    }

    const baseKey = `${
      buildQueryAwareCacheKey(slug, options?.url, this.config.queryParamOptions)
    }:environment-${environment}`;
    return buildDependencyPinnedRenderCacheKey(
      baseKey,
      dependencyPinningCacheKey,
      options?.url?.origin,
      composition,
    );
  }
}
