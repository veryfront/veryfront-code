import { join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { MDXCacheAdapter } from "@veryfront/transforms/mdx/index.ts";
import { isCompiledBinary } from "@veryfront/utils";
import { DEFAULT_CACHE_DIR } from "@veryfront/utils/constants/server.ts";
import { ComponentRegistry } from "../ssr/component-registry.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { CacheCoordinator } from "../cache/index.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import {
  FilesystemCacheStore,
  KVCacheStore,
  MemoryCacheStore,
  RedisCacheStore,
} from "../cache/stores/index.ts";
import type { CacheStore } from "../cache/types.ts";
import { LayoutCollector, LayoutCompiler, ProviderManager } from "../layouts/index.ts";
import { PageRenderer } from "../page-renderer.ts";
import { PageResolver } from "../page-resolution/index.ts";
import { ElementValidator } from "../element-validator/index.ts";
import { SSRRenderer } from "../ssr-renderer.ts";
import type { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MdxBundle } from "@veryfront/types";
import { CompilerService } from "./compiler-service.ts";

export interface LifecycleOptions {
  configManager: ConfigurationManager;
  port: number;
  moduleServerUrl?: string;
}

export interface RendererServices {
  componentRegistry: ComponentRegistry;
  virtualModules: VirtualModuleSystem;
  cacheCoordinator: CacheCoordinator;
  mdxCacheAdapter: MDXCacheAdapter;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  providerManager: ProviderManager;
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
  private services?: RendererServices;
  private adapter!: RuntimeAdapter;

  constructor(options: LifecycleOptions) {
    this.configManager = options.configManager;
    this.port = options.port;
    this.moduleServerUrl = options.moduleServerUrl;
  }

  async initialize(): Promise<RendererServices> {
    logger.info("Initializing renderer services", {
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
    });

    // Get or detect adapter
    this.adapter = this.configManager.getAdapter();
    if (!this.adapter) {
      const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
      this.adapter = await getAdapter();
    }

    const config = this.configManager.getConfig();

    // Initialize core services
    const virtualModules = new VirtualModuleSystem("/_veryfront/modules", this.adapter);
    const componentRegistry = new ComponentRegistry(
      virtualModules,
      this.port,
      this.adapter,
      this.moduleServerUrl,
    );

    // Initialize cache system (pluggable)
    const renderCacheConfig = config.cache?.render ?? {};
    const cacheBaseDir = config.cache?.dir ?? DEFAULT_CACHE_DIR;

    let cacheStore: CacheStore;
    switch (renderCacheConfig.type) {
      case "filesystem":
        cacheStore = new FilesystemCacheStore({
          baseDir: join(this.configManager.getProjectDir(), cacheBaseDir, "render"),
        });
        break;
      case "kv":
        cacheStore = new KVCacheStore({
          path: renderCacheConfig.kvPath,
        });
        break;
      case "redis":
        cacheStore = new RedisCacheStore({
          url: renderCacheConfig.redisUrl,
          keyPrefix: renderCacheConfig.redisKeyPrefix,
        });
        break;
      case "memory":
      default:
        cacheStore = new MemoryCacheStore({
          maxEntries: renderCacheConfig.maxEntries ?? (this.configManager.isDebugMode() ? 50 : 500),
          ttlMs: renderCacheConfig.ttl,
        });
        break;
    }

    const cacheCoordinator = new CacheCoordinator({
      store: cacheStore,
      ttlMs: renderCacheConfig.ttl,
    });

    // Initialize MDX cache adapter
    const mdxCacheAdapter = new MDXCacheAdapter({
      config,
      mode: this.configManager.getMode(),
    });

    // Initialize compiler service to handle late binding
    const compilerService = new CompilerService();
    const compileMDXProxy = compilerService.getCompileFunction();

    // Initialize layout system components
    const layoutCollector = new LayoutCollector({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.adapter,
      config,
      compileMDX: compileMDXProxy,
    });

    const layoutCompiler = new LayoutCompiler({
      adapter: this.adapter,
      compileMDX: compileMDXProxy,
    });

    const providerManager = new ProviderManager({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.adapter,
      config,
      compileMDX: compileMDXProxy,
    });

    // Initialize rendering pipeline components
    const debugMode = this.configManager.isDebugMode();

    const elementValidator = new ElementValidator({
      maxDepth: 20,
      debugMode,
    });

    const ssrRenderer = new SSRRenderer(
      this.configManager.getMode(),
      this.adapter,
      this.configManager.getProjectDir(),
    );

    const pageRenderer = new PageRenderer({
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
      config,
      adapter: this.adapter,
      componentRegistry: componentRegistry,
      compileMDX: compileMDXProxy,
      moduleServerUrl: this.moduleServerUrl,
    });

    // Initialize page resolver
    const pageResolver = new PageResolver({
      projectDir: this.configManager.getProjectDir(),
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
      providerManager,
      elementValidator,
      ssrRenderer,
      pageRenderer,
      pageResolver,
      compilerService,
    };

    // Skip eager component loading in compiled binaries to avoid @mdx-js/mdx Worker issues
    // Components will be loaded lazily on-demand instead
    if (!isCompiledBinary()) {
      logger.info("Loading components eagerly for MDX import mapping");

      const componentDirs = config.directories?.components || ["components"];

      for (const dir of componentDirs) {
        await componentRegistry.loadFromDirectory(
          join(this.configManager.getProjectDir(), dir),
          false,
        );
      }
    } else {
      logger.info(
        "Skipping eager component loading in compiled binary (will load lazily on-demand)",
      );
    }

    logger.info("Renderer services initialized successfully");

    return this.services;
  }

  updateCompileMDX(
    compileMDX: (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => Promise<MdxBundle>,
  ): void {
    if (!this.services) {
      throw toError(createError({
        type: "render",
        message: "Services not initialized",
      }));
    }

    // Update the compiler service, which updates the proxy function used by all services
    this.services.compilerService.setCompileMDX(compileMDX);
  }

  getServices(): RendererServices {
    if (!this.services) {
      throw toError(createError({
        type: "render",
        message: "Services not initialized. Call initialize() first.",
      }));
    }
    return this.services;
  }

  async initializeComponents(): Promise<void> {
    if (!this.services) {
      throw toError(createError({
        type: "render",
        message: "Services not initialized",
      }));
    }
    await this.services.componentRegistry.initializeComponents();
  }

  clearAllCaches(): void {
    if (!this.services) return;

    void this.services.cacheCoordinator.clearAll();
    this.services.virtualModules.clear();

    // Clear component registry state
    this.services.componentRegistry.clear();

    // Clear provider cache to pick up provider changes
    this.services.providerManager.clearCache();
  }

  clearSlugCache(slug: string): void {
    if (!this.services) return;
    void this.services.cacheCoordinator.clearSlug(slug);
  }

  async destroy(): Promise<void> {
    if (!this.services) return;
    await this.services.cacheCoordinator.destroy();
  }
}
