/**************************
 * Renderer Adapter
 *
 * Adapts the shared Renderer to work with handler contexts.
 * Creates lightweight adapters that bind the shared renderer
 * to a specific project context.
 *
 * @module server/shared/renderer/adapter
 **************************/

import { rendererLogger as logger } from "#veryfront/utils";
import { getConfig } from "#veryfront/config";
import { getEnv } from "#veryfront/platform/compat/process.ts";
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
} from "../../../rendering/renderer.ts";
import type {
  PageDataResponse,
  RenderOptions,
  RenderResult,
} from "../../../rendering/orchestrator/types.ts";
import type { MdxBundle } from "#veryfront/types";
import { APICacheStore } from "../../../rendering/cache/stores/api-store.ts";
import { computeContentSourceId } from "../../../cache/keys.ts";

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

let rendererInitPromise: Promise<Renderer> | null = null;

async function getOrInitRenderer(): Promise<Renderer> {
  if (isRendererInitialized()) return getRenderer();
  if (rendererInitPromise) return rendererInitPromise;

  const isProxyMode = getEnv("PROXY_MODE") === "1";
  const apiBaseUrl = getEnv("VERYFRONT_API_BASE_URL");
  const options: RendererOptions = {};

  // Only use API-backed cache when both PROXY_MODE=1 and API URL is configured
  if (isProxyMode && apiBaseUrl) {
    const renderCacheTtlSeconds = 3600;
    logger.debug("[RendererAdapter] Using API-backed distributed render cache");
    options.cache = {
      store: new APICacheStore({
        keyPrefix: "render",
        ttlSeconds: renderCacheTtlSeconds,
        localMaxEntries: 200,
        enableLocalCache: false,
      }),
      ttlMs: renderCacheTtlSeconds * 1000,
    };
  }

  const useApiCache = isProxyMode && !!apiBaseUrl;
  logger.debug("[RendererAdapter] Initializing renderer", {
    proxyMode: isProxyMode,
    hasApiUrl: !!apiBaseUrl,
    cacheType: useApiCache ? "api-distributed" : "memory",
  });

  rendererInitPromise = initializeRenderer(options);

  try {
    return await rendererInitPromise;
  } finally {
    rendererInitPromise = null;
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

async function createContextFromHandler(ctx: HandlerContext): Promise<RenderContext> {
  const projectSlug = ctx.projectSlug ?? "unknown";

  if (ctx.enriched) {
    logger.debug("[RendererAdapter] Using pre-built EnrichedContext", { projectSlug });
    return createRenderContextFromEnriched(ctx.enriched);
  }

  let config = ctx.config;
  if (!config) {
    const cacheKey = ctx.projectId ?? ctx.projectSlug;
    logger.debug("[RendererAdapter] Loading config from adapter START", {
      projectDir: ctx.projectDir,
      projectSlug,
      projectId: ctx.projectId,
      cacheKey,
    });

    const configStartTime = performance.now();
    config = await getConfig(ctx.projectDir, ctx.adapter, { cacheKey });
    logger.debug("[RendererAdapter] Loading config from adapter DONE", {
      projectSlug,
      duration: `${(performance.now() - configStartTime).toFixed(2)}ms`,
    });
  }

  const contextStartTime = performance.now();
  const environment = resolveEnvironment(ctx);
  const branch = ctx.requestContext?.branch ?? null;
  const isLocalDev = ctx.requestContext?.isLocalDev ?? false;

  // Use shared utility for contentSourceId (fallback path when no enriched context)
  const contentSourceId = computeContentSourceId(isLocalDev, environment, branch, ctx.releaseId);

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
    isLocalDev,
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
    config,
    releaseId: ctx.releaseId,
    environmentName: ctx.environmentName,
    moduleServerUrl: ctx.moduleServerUrl,
    debug: ctx.debug,
  });

  ctx.enriched = enriched;

  const renderContext = createRenderContextFromEnriched(enriched);
  logger.debug("[RendererAdapter] createRenderContext DONE (built EnrichedContext)", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  return renderContext;
}

class RendererAdapterImpl implements RendererAdapter {
  constructor(
    private renderer: Renderer,
    private ctx: RenderContext,
  ) {}

  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    return this.renderer.renderPage(slug, this.ctx, options);
  }

  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    return this.renderer.resolvePageData(slug, this.ctx, options);
  }

  getAllPages(): Promise<string[]> {
    return this.renderer.getAllPages(this.ctx);
  }

  clearCache(slug?: string): void {
    this.renderer.clearCache(this.ctx, slug).catch((error) => {
      logger.warn("[RendererAdapter] Failed to clear cache", { error: String(error), slug });
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
    logger.warn("[RendererAdapter] getVirtualModuleSystem called - not supported");
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
  }

  async destroy(): Promise<void> {}
}

export async function getRendererForProject(ctx: HandlerContext): Promise<RendererAdapter> {
  const startTime = performance.now();
  const projectSlug = ctx.projectSlug ?? "unknown";

  logger.debug("[RendererAdapter] getRendererForProject START", {
    projectSlug,
    projectId: ctx.projectId,
    hasConfig: !!ctx.config,
  });

  const rendererStartTime = performance.now();
  logger.debug("[RendererAdapter] getOrInitRenderer START", { projectSlug });
  const renderer = await getOrInitRenderer();
  logger.debug("[RendererAdapter] getOrInitRenderer DONE", {
    projectSlug,
    duration: `${(performance.now() - rendererStartTime).toFixed(2)}ms`,
  });

  const contextStartTime = performance.now();
  logger.debug("[RendererAdapter] createContextFromHandler START", { projectSlug });
  const renderCtx = await createContextFromHandler(ctx);
  logger.debug("[RendererAdapter] createContextFromHandler DONE", {
    projectSlug,
    duration: `${(performance.now() - contextStartTime).toFixed(2)}ms`,
  });

  logger.debug("[RendererAdapter] getRendererForProject DONE", {
    projectId: renderCtx.projectId,
    projectSlug: renderCtx.projectSlug,
    duration: `${(performance.now() - startTime).toFixed(2)}ms`,
  });

  return new RendererAdapterImpl(renderer, renderCtx);
}

export async function destroyRendererAdapter(): Promise<void> {
  await destroySharedRenderer();
  rendererInitPromise = null;
}
