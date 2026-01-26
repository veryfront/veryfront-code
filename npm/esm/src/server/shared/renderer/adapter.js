import { rendererLogger as logger } from "../../../utils/index.js";
import { getConfig } from "../../../config/index.js";
import { getEnv } from "../../../platform/compat/process.js";
import { buildEnrichedContext } from "../../context/enriched-context.js";
import { createRenderContextFromEnriched, destroyRenderer as destroySharedRenderer, getRenderer, initializeRenderer, isRendererInitialized, } from "../../../rendering/renderer.js";
import { APICacheStore } from "../../../rendering/cache/stores/api-store.js";
import { computeContentSourceId } from "../../../cache/keys.js";
let rendererInitPromise = null;
async function getOrInitRenderer() {
    if (isRendererInitialized())
        return getRenderer();
    if (rendererInitPromise)
        return rendererInitPromise;
    const isProxyMode = getEnv("PROXY_MODE") === "1";
    const options = {};
    if (isProxyMode) {
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
    logger.debug("[RendererAdapter] Initializing renderer", {
        proxyMode: isProxyMode,
        cacheType: isProxyMode ? "api-distributed" : "memory",
    });
    rendererInitPromise = initializeRenderer(options);
    try {
        return await rendererInitPromise;
    }
    finally {
        rendererInitPromise = null;
    }
}
function resolveEnvironment(ctx) {
    if (ctx.resolvedEnvironment)
        return ctx.resolvedEnvironment;
    const domainEnv = ctx.parsedDomain?.environment;
    if (domainEnv === "staging" || domainEnv === "development" || domainEnv === "preview") {
        return "preview";
    }
    if (domainEnv === "production")
        return "production";
    return ctx.requestContext?.mode ?? "preview";
}
async function createContextFromHandler(ctx) {
    const projectSlug = ctx.projectSlug || "unknown";
    if (ctx.enriched) {
        logger.debug("[RendererAdapter] Using pre-built EnrichedContext", { projectSlug });
        return createRenderContextFromEnriched(ctx.enriched);
    }
    let config = ctx.config;
    if (!config) {
        const cacheKey = ctx.projectId || ctx.projectSlug;
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
    const enriched = buildEnrichedContext({
        projectId: ctx.projectId ?? ctx.projectSlug ?? "__single__",
        projectSlug: ctx.projectSlug ?? ctx.projectId ?? "__single__",
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
class RendererAdapterImpl {
    renderer;
    ctx;
    constructor(renderer, ctx) {
        this.renderer = renderer;
        this.ctx = ctx;
    }
    renderPage(slug, options) {
        return this.renderer.renderPage(slug, this.ctx, options);
    }
    resolvePageData(slug, options) {
        return this.renderer.resolvePageData(slug, this.ctx, options);
    }
    getAllPages() {
        return this.renderer.getAllPages(this.ctx);
    }
    clearCache(slug) {
        this.renderer.clearCache(this.ctx, slug).catch((error) => {
            logger.warn("[RendererAdapter] Failed to clear cache", { error: String(error), slug });
        });
    }
    clearAllState() {
        this.clearCache();
    }
    getVirtualModuleSystem() {
        logger.warn("[RendererAdapter] getVirtualModuleSystem called - not supported");
        return {
            handleRequest: () => null,
            register: () => Promise.resolve(""),
            registerModule: () => Promise.resolve(""),
            getModule: () => undefined,
            clear: () => { },
        };
    }
    async initializeComponents() { }
    async compileMDX(content, frontmatter, filePath) {
        const { MDXCompiler } = await import("../../../rendering/orchestrator/mdx.js");
        const { MDXCacheAdapter } = await import("../../../transforms/mdx/index.js");
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
    async destroy() { }
}
export async function getRendererForProject(ctx) {
    const startTime = performance.now();
    const projectSlug = ctx.projectSlug || "unknown";
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
export async function destroyRendererAdapter() {
    await destroySharedRenderer();
    rendererInitPromise = null;
}
