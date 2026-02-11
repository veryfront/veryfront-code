import { join } from "#veryfront/compat/path";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { ComponentRegistry } from "../ssr/component-registry.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { CacheCoordinator } from "../cache/index.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "../cache/stores/index.ts";
import type { CacheStore } from "../cache/types.ts";
import { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import { PageRenderer } from "../page-renderer.ts";
import { PageResolver } from "../page-resolution/index.ts";
import { ElementValidator } from "../element-validator/index.ts";
import { SSRRenderer } from "../ssr-renderer.ts";
import type { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { MdxBundle } from "#veryfront/types";
import { CompilerService } from "./compiler-service.ts";

const log = logger.component("lifecycle");

export interface LifecycleOptions {
  configManager: ConfigurationManager;
  port: number;
  moduleServerUrl?: string;
  /** Project ID (UUID) for SSR cache isolation in multi-project mode */
  projectId?: string;
  /** Content source identifier for cache isolation (branch or release) */
  contentSourceId?: string;
}

export interface RendererServices {
  componentRegistry: ComponentRegistry;
  virtualModules: VirtualModuleSystem;
  cacheCoordinator: CacheCoordinator;
  mdxCacheAdapter: MDXCacheAdapter;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  elementValidator: ElementValidator;
  ssrRenderer: SSRRenderer;
  pageRenderer: PageRenderer;
  pageResolver: PageResolver;
  compilerService: CompilerService;
}

export class RendererLifecycle {
  private configManager: ConfigurationManager;
  private port: number;
  private moduleServerUrl?: string;
  private projectId?: string;
  private contentSourceId?: string;
  private services?: RendererServices;
  private adapter!: RuntimeAdapter;

  constructor(options: LifecycleOptions) {
    this.configManager = options.configManager;
    this.port = options.port;
    this.moduleServerUrl = options.moduleServerUrl;
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;
  }

  async initialize(): Promise<RendererServices> {
    logger.debug("Initializing renderer services", {
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
    });

    this.adapter = this.configManager.getAdapter();
    if (!this.adapter) {
      const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
      this.adapter = await runtime.get();
    }

    const projectDir = this.configManager.getProjectDir();
    const mode = this.configManager.getMode();
    const debugMode = this.configManager.isDebugMode();
    const config = this.configManager.getConfig();

    const virtualModules = new VirtualModuleSystem("/_veryfront/modules", this.adapter);
    const componentRegistry = new ComponentRegistry(
      virtualModules,
      this.port,
      this.adapter,
      this.moduleServerUrl,
      undefined,
      this.projectId,
      this.contentSourceId,
    );

    const renderCacheConfig = config.cache?.render ?? {};
    const cacheBaseDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;

    let cacheStore: CacheStore;
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
      projectId: this.projectId,
      contentSourceId: this.contentSourceId,
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

    if (!compiledBinary && !isVeryFrontAPI) {
      logger.debug("Loading components eagerly for MDX import mapping");

      const componentDirs = config.directories?.components ?? ["components"];
      for (const dir of componentDirs) {
        await componentRegistry.loadFromDirectory(join(projectDir, dir), false);
      }
    } else {
      logger.debug("Skipping eager component loading (will load lazily on-demand)", {
        isCompiledBinary: compiledBinary,
        isVeryFrontAPI,
      });
    }

    logger.debug("Renderer services initialized successfully");
    return this.services;
  }

  updateCompileMDX(
    compileMDX: (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => Promise<MdxBundle>,
  ): void {
    const services = this.services;
    if (!services) {
      throw toError(
        createError({
          type: "render",
          message: "Services not initialized",
        }),
      );
    }

    services.compilerService.setCompileMDX(compileMDX);
  }

  getServices(): RendererServices {
    const services = this.services;
    if (!services) {
      throw toError(
        createError({
          type: "render",
          message: "Services not initialized. Call initialize() first.",
        }),
      );
    }
    return services;
  }

  async initializeComponents(): Promise<void> {
    const services = this.services;
    if (!services) {
      throw toError(
        createError({
          type: "render",
          message: "Services not initialized",
        }),
      );
    }

    await services.componentRegistry.initializeComponents();
  }

  clearAllCaches(): void {
    const services = this.services;
    if (!services) return;

    services.cacheCoordinator.clearAll().catch((error) => {
      log.warn("Failed to clear all caches", { error: String(error) });
    });
    services.virtualModules.clear();
    services.componentRegistry.clear();
  }

  clearSlugCache(slug: string): void {
    const services = this.services;
    if (!services) return;

    services.cacheCoordinator.clearSlug(slug).catch((error) => {
      log.warn("Failed to clear slug cache", { slug, error: String(error) });
    });
  }

  async destroy(): Promise<void> {
    await this.services?.cacheCoordinator.destroy();
  }
}
