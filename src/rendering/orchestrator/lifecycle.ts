/**
 * Renderer Lifecycle Manager
 * Handles system initialization, component registry setup, and resource cleanup
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { MDXCacheAdapter } from "@veryfront/transforms/mdx/index.ts";
import { isCompiledBinary } from "@veryfront/utils";
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
// Removed: deleted module - rendering/caching/ directory was deleted
// import {
//   CacheCoordinator,
//   RenderCache,
//   LayoutComponentCache,
//   PageModuleCache,
//   CachePersistence,
// } from "../caching/index.ts";
import { LayoutCollector, LayoutCompiler, ProviderManager } from "../layouts/index.ts";
import { PageRenderer } from "../page-renderer.ts";
import { PageResolver } from "../page-resolution/index.ts";
import { ElementValidator } from "../element-validator/index.ts";
import { SSRRenderer } from "../ssr-renderer.ts";
import type { ConfigurationManager } from "./config.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MdxBundle } from "@veryfront/types";

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
}

/**
 * Manages renderer lifecycle: initialization and cleanup
 */
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

  /**
   * Initialize all renderer services and components
   */
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
    const cacheBaseDir = config.cache?.dir ?? ".veryfront/cache";

    let cacheStore: CacheStore;
    switch (renderCacheConfig.type) {
      case "filesystem":
        cacheStore = new FilesystemCacheStore({
          baseDir: join(this.configManager.getProjectDir(), cacheBaseDir, "render"),
          adapter: this.adapter,
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

    // Create compileMDX function that will be bound to renderer
    // We'll pass a placeholder for now and the renderer will bind it
    const compileMDXPlaceholder = () => {
      throw toError(createError({
        type: "render",
        message: "compileMDX not bound yet",
      }));
    };

    // Initialize layout system components
    const layoutCollector = new LayoutCollector({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.adapter,
      config,
      compileMDX: compileMDXPlaceholder,
    });

    const layoutCompiler = new LayoutCompiler({
      adapter: this.adapter,
      compileMDX: compileMDXPlaceholder,
    });

    const providerManager = new ProviderManager({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.adapter,
      compileMDX: compileMDXPlaceholder,
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
    );

    const pageRenderer = new PageRenderer({
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
      config,
      adapter: this.adapter,
      componentRegistry: componentRegistry,
      compileMDX: compileMDXPlaceholder,
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
  /**
   * Update compileMDX function in all services that need it
   * This is called after the renderer is created with the bound method
   */
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

    // Update all services that use compileMDX
    // Use 'any' to bypass TypeScript's strict checking for internal property update
    (this.services.layoutCollector as any).compileMDX = compileMDX;
    (this.services.layoutCompiler as any).compileMDX = compileMDX;
    (this.services.providerManager as any).compileMDX = compileMDX;
    (this.services.pageRenderer as any).compileMDX = compileMDX;
  }

  /**
   * Get initialized services
   */
  getServices(): RendererServices {
    if (!this.services) {
      throw toError(createError({
        type: "render",
        message: "Services not initialized. Call initialize() first.",
      }));
    }
    return this.services;
  }

  /**
   * Initialize deferred components after server starts
   */
  async initializeComponents(): Promise<void> {
    if (!this.services) {
      throw toError(createError({
        type: "render",
        message: "Services not initialized",
      }));
    }
    await this.services.componentRegistry.initializeComponents();
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    if (!this.services) return;

    void this.services.cacheCoordinator.clearAll();
    this.services.virtualModules.clear();

    // Clear component registry state
    this.services.componentRegistry.clear();
  }

  /**
   * Clear cache for specific slug
   */
  clearSlugCache(slug: string): void {
    if (!this.services) return;
    void this.services.cacheCoordinator.clearSlug(slug);
  }

  /**
   * Clean up all resources
   */
  async destroy(): Promise<void> {
    if (!this.services) return;
    await this.services.cacheCoordinator.destroy();
  }
}
