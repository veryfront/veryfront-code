import { join } from "../../platform/compat/path-helper.js";
import { isCompiledBinary, rendererLogger as logger } from "../../utils/index.js";
import { MDXCacheAdapter } from "../../transforms/mdx/index.js";
import { DEFAULT_CACHE_DIR } from "../../utils/constants/server.js";
import { ComponentRegistry } from "../ssr/component-registry.js";
import { VirtualModuleSystem } from "../virtual-module-system.js";
import { CacheCoordinator } from "../cache/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { FilesystemCacheStore, KVCacheStore, MemoryCacheStore, RedisCacheStore, } from "../cache/stores/index.js";
import { LayoutCollector, LayoutCompiler } from "../layouts/index.js";
import { PageRenderer } from "../page-renderer.js";
import { PageResolver } from "../page-resolution/index.js";
import { ElementValidator } from "../element-validator/index.js";
import { SSRRenderer } from "../ssr-renderer.js";
import { CompilerService } from "./compiler-service.js";
export class RendererLifecycle {
    configManager;
    port;
    moduleServerUrl;
    projectId;
    contentSourceId;
    services;
    adapter;
    constructor(options) {
        this.configManager = options.configManager;
        this.port = options.port;
        this.moduleServerUrl = options.moduleServerUrl;
        this.projectId = options.projectId;
        this.contentSourceId = options.contentSourceId;
    }
    async initialize() {
        logger.debug("Initializing renderer services", {
            projectDir: this.configManager.getProjectDir(),
            mode: this.configManager.getMode(),
        });
        this.adapter = this.configManager.getAdapter();
        if (!this.adapter) {
            const { runtime } = await import("../../platform/adapters/detect.js");
            this.adapter = await runtime.get();
        }
        const projectDir = this.configManager.getProjectDir();
        const mode = this.configManager.getMode();
        const debugMode = this.configManager.isDebugMode();
        const config = this.configManager.getConfig();
        const virtualModules = new VirtualModuleSystem("/_veryfront/modules", this.adapter);
        const componentRegistry = new ComponentRegistry(virtualModules, this.port, this.adapter, this.moduleServerUrl, undefined, this.projectId, this.contentSourceId);
        const renderCacheConfig = config.cache?.render ?? {};
        const cacheBaseDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;
        let cacheStore;
        switch (renderCacheConfig.type) {
            case "filesystem":
                cacheStore = new FilesystemCacheStore({
                    baseDir: join(projectDir, cacheBaseDir, "render"),
                });
                break;
            case "kv":
                cacheStore = new KVCacheStore({ path: renderCacheConfig.kvPath });
                break;
            case "redis":
                cacheStore = new RedisCacheStore({
                    url: renderCacheConfig.redisUrl,
                    keyPrefix: renderCacheConfig.redisKeyPrefix,
                    enableFallback: false,
                });
                break;
            case "memory":
            default:
                cacheStore = new MemoryCacheStore({
                    maxEntries: renderCacheConfig.maxEntries ?? (debugMode ? 50 : 500),
                    ttlMs: renderCacheConfig.ttl,
                });
                break;
        }
        const cacheCoordinator = new CacheCoordinator({
            store: cacheStore,
            ttlMs: renderCacheConfig.ttl,
        });
        const mdxCacheAdapter = new MDXCacheAdapter({ config, mode });
        const compilerService = new CompilerService();
        const compileMDXProxy = compilerService.getCompileFunction();
        const layoutCollector = new LayoutCollector({
            projectDir,
            adapter: this.adapter,
            config,
            compileMDX: compileMDXProxy,
        });
        const layoutCompiler = new LayoutCompiler({
            adapter: this.adapter,
            compileMDX: compileMDXProxy,
        });
        const elementValidator = new ElementValidator({
            maxDepth: 20,
            debugMode,
        });
        const ssrRenderer = new SSRRenderer(mode, this.adapter, projectDir);
        const pageRenderer = new PageRenderer({
            projectDir,
            mode,
            config,
            adapter: this.adapter,
            componentRegistry,
            compileMDX: compileMDXProxy,
            moduleServerUrl: this.moduleServerUrl,
        });
        const pageResolver = new PageResolver({
            projectDir,
            config,
            adapter: this.adapter,
        });
        this.services = {
            componentRegistry,
            virtualModules,
            cacheCoordinator,
            mdxCacheAdapter,
            layoutCollector,
            layoutCompiler,
            elementValidator,
            ssrRenderer,
            pageRenderer,
            pageResolver,
            compilerService,
        };
        const isVeryFrontAPI = config.fs?.type === "veryfront-api";
        const compiledBinary = isCompiledBinary();
        if (compiledBinary || isVeryFrontAPI) {
            logger.debug("Skipping eager component loading (will load lazily on-demand)", {
                isCompiledBinary: compiledBinary,
                isVeryFrontAPI,
            });
            logger.debug("Renderer services initialized successfully");
            return this.services;
        }
        logger.debug("Loading components eagerly for MDX import mapping");
        const componentDirs = config.directories?.components ?? ["components"];
        for (const dir of componentDirs) {
            await componentRegistry.loadFromDirectory(join(projectDir, dir), false);
        }
        logger.debug("Renderer services initialized successfully");
        return this.services;
    }
    updateCompileMDX(compileMDX) {
        const services = this.services;
        if (!services) {
            throw toError(createError({
                type: "render",
                message: "Services not initialized",
            }));
        }
        services.compilerService.setCompileMDX(compileMDX);
    }
    getServices() {
        if (!this.services) {
            throw toError(createError({
                type: "render",
                message: "Services not initialized. Call initialize() first.",
            }));
        }
        return this.services;
    }
    async initializeComponents() {
        const services = this.services;
        if (!services) {
            throw toError(createError({
                type: "render",
                message: "Services not initialized",
            }));
        }
        await services.componentRegistry.initializeComponents();
    }
    clearAllCaches() {
        const services = this.services;
        if (!services)
            return;
        services.cacheCoordinator.clearAll().catch((error) => {
            logger.warn("[Lifecycle] Failed to clear all caches", { error: String(error) });
        });
        services.virtualModules.clear();
        services.componentRegistry.clear();
    }
    clearSlugCache(slug) {
        const services = this.services;
        if (!services)
            return;
        services.cacheCoordinator.clearSlug(slug).catch((error) => {
            logger.warn("[Lifecycle] Failed to clear slug cache", { slug, error: String(error) });
        });
    }
    async destroy() {
        if (!this.services)
            return;
        await this.services.cacheCoordinator.destroy();
    }
}
