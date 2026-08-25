/**************************
 * Renderer Adapter
 *
 * Adapts the shared Renderer to work with handler contexts.
 * Creates lightweight adapters that bind the shared renderer
 * to a specific project context.
 *
 * @module server/shared/renderer/adapter
 **************************/

import { rendererLogger } from "#veryfront/utils";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import { evaluateHostedConfigSource, getHostedConfig } from "#veryfront/config/loader.ts";
import { hasNotFoundStatus } from "#veryfront/server/runtime-handler/adapter-factory.ts";
import { getEnvBoolean, getEnvString } from "#veryfront/compat/process.ts";
import type { HandlerContext } from "../../handlers/types.ts";
import { buildEnrichedContext } from "../../context/enriched-context.ts";
import {
  createRenderContextFromEnriched,
  destroyRenderer as destroySharedRenderer,
  getRenderer,
  initializeRenderer,
  isRendererInitialized,
  type RenderContext,
  type Renderer,
  type RendererOptions,
} from "#veryfront/rendering/renderer.ts";
import type {
  PageDataResponse,
  RenderOptions,
  RenderResult,
} from "#veryfront/rendering/orchestrator/types.ts";
import type { MdxBundle } from "#veryfront/types";
import { APICacheStore } from "#veryfront/rendering/cache/stores/api-store.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const logger = rendererLogger.component("renderer-adapter");

/** TTL for the API-backed distributed render cache (1 hour) */
const RENDER_CACHE_TTL_SECONDS = 3_600;

/** Maximum entries for the local render cache layer */
const RENDER_CACHE_LOCAL_MAX_ENTRIES = 200;

export interface RendererAdapter {
  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult>;
  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse>;
  getAllPages(): Promise<string[]>;
  clearCache(slug?: string): void;
  clearAllState(): void;
  getVirtualModuleSystem(): {
    handleRequest(req: Request): Response | null;
    register(id: string, source: string, projectDir: string): Promise<string>;
    registerModule(id: string, source: string, projectDir: string): Promise<string>;
    getModule(id: string): unknown;
    clear(): void;
  };
  initializeComponents(): Promise<void>;
  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle>;
  destroy(): Promise<void>;
}

/**
 * Abstraction over renderer initialization, allowing tests to inject
 * a mock renderer without pulling in the full rendering subsystem.
 */
export interface RendererInitializer {
  initialize(options: RendererOptions): Promise<Renderer>;
  isInitialized(): boolean;
  get(): Renderer;
  destroy(): Promise<void>;
}

/**
 * Default initializer that delegates to the real shared renderer
 * singleton from `#veryfront/rendering/renderer.ts`.
 */
const defaultInitializer: RendererInitializer = {
  initialize: initializeRenderer,
  isInitialized: isRendererInitialized,
  get: getRenderer,
  destroy: destroySharedRenderer,
};

let activeInitializer: RendererInitializer = defaultInitializer;
let rendererInitState: { initializer: RendererInitializer; promise: Promise<Renderer> } | null =
  null;

function scheduleInitializerDestroy(
  initializer: RendererInitializer,
  pendingPromise?: Promise<unknown>,
): void {
  const destroy = async () => {
    try {
      await initializer.destroy();
    } catch (error) {
      logger.warn("Failed to destroy renderer initializer", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (pendingPromise) {
    void pendingPromise
      .catch(() => undefined)
      .then(destroy);
    return;
  }

  if (!initializer.isInitialized()) return;
  void destroy();
}

/**
 * Replace the renderer initializer used by the adapter layer.
 * Pass `undefined` to restore the default (real) initializer.
 *
 * Returns a disposer that restores the previous initializer — use in
 * `afterEach` or with `using` to prevent test pollution:
 *
 * ```ts
 * afterEach(() => setRendererInitializer(undefined));
 * ```
 *
 * @internal Test-only — not part of the public API.
 */
export function setRendererInitializer(
  initializer?: RendererInitializer,
): void {
  const nextInitializer = initializer ?? defaultInitializer;
  const previous = activeInitializer;
  const previousPendingPromise = rendererInitState?.initializer === previous
    ? rendererInitState.promise
    : undefined;

  activeInitializer = nextInitializer;

  if (rendererInitState?.initializer !== activeInitializer) {
    rendererInitState = null;
  }

  if (previous !== activeInitializer) {
    scheduleInitializerDestroy(previous, previousPendingPromise);
  }
}

async function getOrInitRenderer(): Promise<Renderer> {
  if (activeInitializer.isInitialized()) return activeInitializer.get();
  if (rendererInitState?.initializer === activeInitializer) {
    return rendererInitState.promise;
  }

  const isProxyMode = getEnvBoolean("PROXY_MODE", false, {
    trueValues: ["1"],
    trim: false,
    caseSensitive: true,
  });
  const apiBaseUrl = getEnvString("VERYFRONT_API_BASE_URL");
  const options: RendererOptions = {};

  // Only use API-backed cache when both PROXY_MODE=1 and API URL is configured
  if (isProxyMode && apiBaseUrl) {
    logger.debug("Using API-backed distributed render cache");
    options.cache = {
      store: new APICacheStore({
        keyPrefix: "render",
        ttlSeconds: RENDER_CACHE_TTL_SECONDS,
        localMaxEntries: RENDER_CACHE_LOCAL_MAX_ENTRIES,
        enableLocalCache: false,
      }),
      ttlMs: RENDER_CACHE_TTL_SECONDS * 1000,
    };
  }

  const useApiCache = isProxyMode && !!apiBaseUrl;
  logger.debug("Initializing renderer", {
    proxyMode: isProxyMode,
    hasApiUrl: !!apiBaseUrl,
    cacheType: useApiCache ? "api-distributed" : "memory",
  });

  const initializer = activeInitializer;
  const initPromise = initializer.initialize(options);
  rendererInitState = {
    initializer,
    promise: initPromise,
  };

  try {
    return await initPromise;
  } finally {
    if (rendererInitState?.promise === initPromise) {
      rendererInitState = null;
    }
  }
}

function resolveEnvironment(ctx: HandlerContext): "preview" | "production" {
  if (ctx.resolvedEnvironment) return ctx.resolvedEnvironment;

  const domainEnv = ctx.parsedDomain?.environment;
  if (domainEnv === "production") return "production";
  if (domainEnv === "staging" || domainEnv === "development" || domainEnv === "preview") {
    return "preview";
  }

  return ctx.requestContext?.mode ?? "preview";
}

/**
 * Load project config for a handler that did not receive one.
 *
 * A shared multi-project runtime serves untrusted project sources, so config
 * is evaluated declaratively under the identity the request already
 * established. Deriving a source or environment here instead would let one
 * request evaluate the same project two different ways.
 */
async function loadConfigForHandler(
  ctx: HandlerContext,
  cacheKey: string | undefined,
): Promise<VeryfrontConfig> {
  if (shouldUseMultiProjectContext(ctx) && ctx.prepareHostedConfigContext && cacheKey) {
    // Prepared outside the try: a 404 from context preparation means the
    // project, release or token could not be resolved, which is a real failure
    // and must not be read as "this release published no config".
    const hosted = await ctx.prepareHostedConfigContext();

    // Set only where a 404 genuinely means absence. hasNotFoundStatus is
    // documented as scoped to a single operation, never to a block that also
    // performs other requests -- adapter-factory.ts does the same thing for the
    // first config load, and the two must not drift.
    let hostedConfigAbsent = false;
    try {
      return await getHostedConfig(ctx.projectDir, ctx.adapter, { cacheKey, ...hosted })
        .catch((error: unknown) => {
          if (hasNotFoundStatus(error)) hostedConfigAbsent = true;
          throw error;
        });
    } catch (error) {
      // A release that published no config answers 404. The adapter factory
      // already treats that as an ordinary project shape and falls through to
      // defaults; this second load has to agree, or a project without a config
      // clears that guard and dies here instead.
      if (!hostedConfigAbsent) throw error;
      rendererLogger.debug("No hosted config for this release; using defaults", {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
      });
      // `source: null` returns merged defaults on the first statement, so
      // nothing below it is read today. The values are still the correct ones
      // rather than placeholders: `?? "release"` would mislabel preview, whose
      // VirtualConfigSourceContext carries no environmentName at all, and this
      // becomes a live bug the moment the short-circuit moves. `environment` is
      // empty because there is no source to evaluate against it -- the real one
      // lives inside `hosted.preparedContext`, not on the context itself.
      return await evaluateHostedConfigSource({
        cacheKey,
        source: null,
        environmentName: hosted.sourceContext.environmentName ?? resolveEnvironment(ctx),
        environment: {},
      });
    }
  }

  return await getConfig(ctx.projectDir, ctx.adapter, { cacheKey });
}

async function createContextFromHandler(ctx: HandlerContext): Promise<RenderContext> {
  // "unknown" is used only for debug logging below — actual cache keys and enriched context
  // use ctx.projectSlug ?? ctx.projectId ?? derivedProjectId (never "unknown"), so there
  // is no cross-project cache pollution from this sentinel.
  const projectSlug = ctx.projectSlug ?? "unknown";

  if (ctx.enriched) {
    logger.debug("Using pre-built EnrichedContext", { projectSlug });
    return {
      ...createRenderContextFromEnriched(ctx.enriched),
      allowHostProjectCodeExecution: ctx.isLocalProject === true ||
        ctx.allowHostProjectCodeExecution === true,
    };
  }

  let config = ctx.config;
  if (!config) {
    const cacheKey = ctx.projectId ?? ctx.projectSlug;
    logger.debug("Loading config from adapter START", {
      projectDir: ctx.projectDir,
      projectSlug,
      projectId: ctx.projectId,
      cacheKey,
    });

    const configStartTime = performance.now();
    config = await loadConfigForHandler(ctx, cacheKey);
    logger.debug("Loading config from adapter DONE", {
      projectSlug,
      duration: `${(performance.now() - configStartTime).toFixed(2)}ms`,
    });
  }

  // At this point, config is guaranteed to be defined (either from ctx or getConfig)
  const resolvedConfig = config as VeryfrontConfig;

  const contextStartTime = performance.now();
  const environment = resolveEnvironment(ctx);
  const branch = ctx.requestContext?.branch ?? null;
  const isLocal = !!ctx.isLocalProject;

  // Use shared utility for contentSourceId (fallback path when no enriched context)
  const contentSourceId = computeContentSourceId(isLocal, environment, branch, ctx.releaseId);

  // Derive a unique identifier from projectDir when no explicit projectId/slug is available
  // This prevents cache pollution between different local projects
  const derivedProjectId = ctx.projectId ?? ctx.projectSlug ??
    (ctx.projectDir
      ? ctx.projectDir.split("/").filter(Boolean).pop() ?? "__single__"
      : "__single__");

  const enriched = buildEnrichedContext({
    projectId: derivedProjectId,
    projectSlug: ctx.projectSlug ?? ctx.projectId ?? derivedProjectId,
    projectDir: ctx.projectDir,
    token: ctx.proxyToken ?? "",
    environment,
    branch,
    isLocalProject: isLocal,
    allowHostProjectCodeExecution: ctx.allowHostProjectCodeExecution,
    contentSourceId,
    parsedDomain: ctx.parsedDomain ?? {
      slug: null,
      branch: null,
      environment: null,
      isVeryfrontDomain: false,
      isDraft: false,
      allowIframeEmbed: false,
    },
    adapter: ctx.adapter,
    config: resolvedConfig,
    releaseId: ctx.releaseId,
    environmentName: ctx.environmentName,
    moduleServerUrl: ctx.moduleServerUrl,
    debug: ctx.debug,
  });

  ctx.enriched = enriched;

  const renderContext = createRenderContextFromEnriched(enriched);
  logger.debug("createRenderContext DONE (built EnrichedContext)", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  return renderContext;
}

function shouldUseMultiProjectContext(ctx: HandlerContext): boolean {
  if (!ctx.projectSlug) return false;
  const fs = ctx.adapter?.fs;
  if (!fs) return false;
  return isExtendedFSAdapter(fs) && fs.isMultiProjectMode();
}

function resolveContextBranch(ctx: HandlerContext): string | null {
  return ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null;
}

function runWithProjectContext<T>(ctx: HandlerContext, fn: () => Promise<T>): Promise<T> {
  if (!shouldUseMultiProjectContext(ctx)) return fn();

  const fs = ctx.adapter?.fs;
  if (!fs || !isExtendedFSAdapter(fs)) return fn();

  const environment = resolveEnvironment(ctx);
  const token = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";

  return fs.runWithContext(
    ctx.projectSlug!,
    token,
    fn,
    ctx.projectId,
    {
      productionMode: environment === "production",
      releaseId: ctx.releaseId,
      branch: resolveContextBranch(ctx),
      environmentName: ctx.environmentName,
    },
  );
}

class RendererAdapterImpl implements RendererAdapter {
  constructor(
    private renderer: Renderer,
    private ctx: RenderContext,
    private handlerCtx: HandlerContext,
  ) {}

  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    return runWithProjectContext(
      this.handlerCtx,
      () => this.renderer.renderPage(slug, this.ctx, options),
    );
  }

  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    return runWithProjectContext(
      this.handlerCtx,
      () => this.renderer.resolvePageData(slug, this.ctx, options),
    );
  }

  getAllPages(): Promise<string[]> {
    return runWithProjectContext(this.handlerCtx, () => this.renderer.getAllPages(this.ctx));
  }

  clearCache(slug?: string): void {
    // The interface requires void return, so cache-clear failures are fire-and-forget.
    // The warn log below surfaces failures in monitoring. Callers (e.g., HMR invalidation)
    // cannot observe the failure — if stale content is served after a deploy, check logs
    // for "Failed to clear cache" entries.
    this.renderer.clearCache(this.ctx, slug).catch((error) => {
      logger.warn("Failed to clear cache", { error: String(error), slug });
    });
  }

  clearAllState(): void {
    this.clearCache();
  }

  getVirtualModuleSystem(): {
    handleRequest(req: Request): Response | null;
    register(id: string, source: string, projectDir: string): Promise<string>;
    registerModule(id: string, source: string, projectDir: string): Promise<string>;
    getModule(id: string): unknown;
    clear(): void;
  } {
    logger.warn("getVirtualModuleSystem called - not supported");
    return {
      handleRequest: () => null,
      register: async () => "",
      registerModule: async () => "",
      getModule: () => undefined,
      clear: () => {},
    };
  }

  async initializeComponents(): Promise<void> {}

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle> {
    return await runWithProjectContext(this.handlerCtx, async () => {
      const { MDXCompiler } = await import("../../../rendering/orchestrator/mdx.ts");
      const { MDXCacheAdapter } = await import("#veryfront/transforms/mdx/index.ts");

      const mdxCacheAdapter = new MDXCacheAdapter({
        config: this.ctx.config,
        mode: this.ctx.mode,
      });

      const compiler = new MDXCompiler({
        projectDir: this.ctx.projectDir,
        mode: this.ctx.mode,
        mdxCacheAdapter,
      });

      return compiler.compileMDX(content, frontmatter, filePath);
    });
  }

  async destroy(): Promise<void> {}
}

export async function getRendererForProject(ctx: HandlerContext): Promise<RendererAdapter> {
  const startTime = performance.now();
  const projectSlug = ctx.projectSlug ?? "unknown";

  logger.debug("getRendererForProject START", {
    projectSlug,
    projectId: ctx.projectId,
    hasConfig: !!ctx.config,
  });

  const rendererStartTime = performance.now();
  logger.debug("getOrInitRenderer START", { projectSlug });
  const renderer = await getOrInitRenderer();
  logger.debug("getOrInitRenderer DONE", {
    projectSlug,
    duration: `${(performance.now() - rendererStartTime).toFixed(2)}ms`,
  });

  const contextStartTime = performance.now();
  logger.debug("createContextFromHandler START", { projectSlug });
  const renderCtx = await runWithProjectContext(ctx, () => createContextFromHandler(ctx));
  logger.debug("createContextFromHandler DONE", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  logger.debug("getRendererForProject DONE", {
    projectId: renderCtx.projectId,
    projectSlug: renderCtx.projectSlug,
    duration: `${(performance.now() - startTime).toFixed(2)}ms`,
  });

  return new RendererAdapterImpl(renderer, renderCtx, ctx);
}

export async function destroyRendererAdapter(): Promise<void> {
  const pendingPromise = rendererInitState?.initializer === activeInitializer
    ? rendererInitState.promise
    : undefined;
  rendererInitState = null;

  if (pendingPromise) {
    await pendingPromise.catch(() => undefined);
  }

  await activeInitializer.destroy();
}
