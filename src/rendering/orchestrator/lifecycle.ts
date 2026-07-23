import { join } from "#veryfront/compat/path";
import { isCompiledBinary, rendererLogger } from "#veryfront/utils";
import { MDXCacheAdapter } from "#veryfront/transforms/mdx/index.ts";
import { DEFAULT_CACHE_DIR } from "#veryfront/utils/constants/server.ts";
import { ComponentRegistry } from "../ssr/component-registry.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { CacheCoordinator } from "../cache/index.ts";
import { createError, toError } from "#veryfront/errors";
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
import { cacheTtlMillisecondsToSeconds } from "#veryfront/cache/backends/ttl.ts";

const logger = rendererLogger.component("lifecycle");

/** Default max cache entries for debug mode */
const DEBUG_MODE_MAX_ENTRIES = 50;
/** Default max cache entries for production mode */
const PRODUCTION_MAX_ENTRIES = 500;

export interface LifecycleOptions {
  configManager: ConfigurationManager;
  port: number;
  moduleServerUrl?: string;
  /** Project ID (UUID) for SSR cache isolation in multi-project mode */
  projectId?: string;
  /** Content source identifier for cache isolation (branch or release) */
  contentSourceId?: string;
  /** Injectable factory for testing — bypasses real service construction */
  servicesFactory?: (
    adapter: RuntimeAdapter,
  ) => RendererServices | Promise<RendererServices>;
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

type RendererLifecycleState =
  | "idle"
  | "initializing"
  | "ready"
  | "destroying"
  | "destroy-failed";

interface CleanupPlan {
  componentRegistry?: Pick<ComponentRegistry, "clear">;
  virtualModules?: Pick<VirtualModuleSystem, "clear">;
  cacheCoordinator?: Pick<CacheCoordinator, "destroy">;
  componentRegistryCleared: boolean;
  virtualModulesCleared: boolean;
  cacheCoordinatorDestroyed: boolean;
}

export class RendererLifecycleCleanupError extends AggregateError {
  readonly retryCleanup: () => Promise<void>;

  constructor(errors: unknown[], retryCleanup: () => Promise<void>) {
    super(errors, "Renderer service cleanup failed");
    this.name = "RendererLifecycleCleanupError";
    this.retryCleanup = retryCleanup;
  }
}

export class RendererLifecycleInitializationError extends AggregateError {
  readonly retryCleanup: () => Promise<void>;

  constructor(
    initializationError: unknown,
    cleanupError: unknown,
    retryCleanup: () => Promise<void>,
  ) {
    super(
      [initializationError, cleanupError],
      "Renderer service initialization and rollback failed",
    );
    this.name = "RendererLifecycleInitializationError";
    this.retryCleanup = retryCleanup;
  }
}

export class RendererLifecycle {
  private configManager: ConfigurationManager;
  private port: number;
  private moduleServerUrl?: string;
  private projectId?: string;
  private contentSourceId?: string;
  private services?: RendererServices;
  private adapter!: RuntimeAdapter;
  private servicesFactory?: (
    adapter: RuntimeAdapter,
  ) => RendererServices | Promise<RendererServices>;
  private state: RendererLifecycleState = "idle";
  private initializationPromise?: Promise<RendererServices>;
  private destroyPromise?: Promise<void>;
  private cleanupPlan?: CleanupPlan;
  private destroyRequested = false;

  constructor(options: LifecycleOptions) {
    this.configManager = options.configManager;
    this.port = options.port;
    this.moduleServerUrl = options.moduleServerUrl;
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;
    this.servicesFactory = options.servicesFactory;
  }

  initialize(): Promise<RendererServices> {
    if (this.state === "ready" && this.services) return Promise.resolve(this.services);
    if (this.initializationPromise) return this.initializationPromise;
    if (this.state === "destroying" || this.state === "destroy-failed") {
      return Promise.reject(
        toError(
          createError({
            type: "render",
            message: "Renderer services require cleanup before initialization can continue",
          }),
        ),
      );
    }

    this.state = "initializing";
    this.destroyRequested = false;
    const initialization = this.initializeGeneration().catch((error) => {
      if (this.state === "initializing") this.state = "idle";
      throw error;
    });
    this.initializationPromise = initialization;
    initialization.finally(() => {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = undefined;
      }
    }).catch(() => {});
    return initialization;
  }

  private async initializeGeneration(): Promise<RendererServices> {
    logger.debug("Initializing renderer services", {
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
    });

    this.adapter = this.configManager.getAdapter();
    if (!this.adapter) {
      const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
      this.adapter = await runtime.get();
    }

    // Allow tests to bypass the full service graph construction
    if (this.servicesFactory) {
      const services = await this.servicesFactory(this.adapter);
      await this.publishServices(services);
      logger.debug("Renderer services initialized via injected factory");
      return services;
    }

    const projectDir = this.configManager.getProjectDir();
    const mode = this.configManager.getMode();
    const debugMode = this.configManager.isDebugMode();
    const config = this.configManager.getConfig();

    let virtualModules: VirtualModuleSystem | undefined;
    let componentRegistry: ComponentRegistry | undefined;
    let cacheCoordinator: CacheCoordinator | undefined;

    try {
      virtualModules = new VirtualModuleSystem("/_veryfront/modules", this.adapter);
      componentRegistry = new ComponentRegistry(
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
            ownerRoot: projectDir,
            maxEntries: renderCacheConfig.maxEntries,
            adapter: this.adapter,
          });
          break;
        case "kv":
          cacheStore = new KVCacheStore({
            path: renderCacheConfig.kvPath,
            ttlMs: renderCacheConfig.ttl,
          });
          break;
        case "redis":
          cacheStore = new RedisCacheStore({
            url: renderCacheConfig.redisUrl,
            keyPrefix: renderCacheConfig.redisKeyPrefix,
            enableFallback: false,
            ttlSeconds: renderCacheConfig.ttl === undefined
              ? undefined
              : cacheTtlMillisecondsToSeconds(renderCacheConfig.ttl),
          });
          break;
        case "memory":
        default:
          cacheStore = new MemoryCacheStore({
            maxEntries: renderCacheConfig.maxEntries ??
              (debugMode ? DEBUG_MODE_MAX_ENTRIES : PRODUCTION_MAX_ENTRIES),
            ttlMs: renderCacheConfig.ttl,
            enforceStoreTtl: false,
          });
          break;
      }

      cacheCoordinator = new CacheCoordinator({
        store: cacheStore,
        ttlMs: renderCacheConfig.ttl,
        projectId: this.projectId,
        contentSourceId: this.contentSourceId,
      });

      const mdxCacheAdapter = new MDXCacheAdapter({
        config,
        mode,
        scope: JSON.stringify([
          this.projectId ?? projectDir,
          this.contentSourceId ?? null,
        ]),
      });

      const compilerService = new CompilerService();
      const compileMDXProxy = compilerService.getCompileFunction();

      const layoutCollector = new LayoutCollector({
        projectDir,
        projectId: this.projectId,
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

      const ssrRenderer = new SSRRenderer(mode, this.adapter, projectDir, this.projectId, config);

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
        projectId: this.projectId,
        config,
        adapter: this.adapter,
      });

      const services: RendererServices = {
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

      await this.publishServices(services);
      logger.debug("Renderer services initialized successfully");
      return services;
    } catch (initializationError) {
      this.cleanupPlan = this.createCleanupPlan({
        componentRegistry,
        virtualModules,
        cacheCoordinator,
      });
      this.state = "destroying";
      try {
        await this.cleanupCurrentGeneration();
      } catch (cleanupError) {
        throw new RendererLifecycleInitializationError(
          initializationError,
          cleanupError,
          () => this.destroy(),
        );
      }
      throw initializationError;
    }
  }

  private async publishServices(services: RendererServices): Promise<void> {
    this.cleanupPlan = this.createCleanupPlan(services);
    if (this.destroyRequested) {
      this.state = "destroying";
      await this.cleanupCurrentGeneration();
      throw toError(
        createError({
          type: "render",
          message: "Renderer service initialization was cancelled during shutdown",
        }),
      );
    }
    this.services = services;
    this.state = "ready";
  }

  private createCleanupPlan(
    resources: Partial<
      Pick<RendererServices, "componentRegistry" | "virtualModules" | "cacheCoordinator">
    >,
  ): CleanupPlan {
    return {
      componentRegistry: resources.componentRegistry,
      virtualModules: resources.virtualModules,
      cacheCoordinator: resources.cacheCoordinator,
      componentRegistryCleared: resources.componentRegistry === undefined,
      virtualModulesCleared: resources.virtualModules === undefined,
      cacheCoordinatorDestroyed: resources.cacheCoordinator === undefined,
    };
  }

  updateCompileMDX(
    compileMDX: (
      content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => Promise<MdxBundle>,
  ): void {
    const services = this.state === "ready" ? this.services : undefined;
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
    const services = this.state === "ready" ? this.services : undefined;
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
    const services = this.state === "ready" ? this.services : undefined;
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
    const services = this.state === "ready" ? this.services : undefined;
    if (!services) return;

    services.cacheCoordinator.clearAll().catch((error) => {
      logger.warn("Failed to clear all caches", { error: String(error) });
    });
    services.virtualModules.clear();
    services.componentRegistry.clear();
  }

  clearSlugCache(slug: string): void {
    const services = this.state === "ready" ? this.services : undefined;
    if (!services) return;

    services.cacheCoordinator.clearSlug(slug).catch((error) => {
      logger.warn("Failed to clear slug cache", { slug, error: String(error) });
    });
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.state === "initializing") this.destroyRequested = true;

    const destruction = this.destroyGeneration();
    this.destroyPromise = destruction;
    destruction.finally(() => {
      if (this.destroyPromise === destruction) this.destroyPromise = undefined;
    }).catch(() => {});
    return destruction;
  }

  private async destroyGeneration(): Promise<void> {
    if (this.state === "initializing" && this.initializationPromise) {
      try {
        await this.initializationPromise;
      } catch {
        // Initialization performs its own rollback. Retry only if that rollback failed.
      }
    }

    if (this.state === "idle") return;
    if (!this.cleanupPlan) {
      this.services = undefined;
      this.destroyRequested = false;
      this.state = "idle";
      return;
    }

    this.state = "destroying";
    await this.cleanupCurrentGeneration();
  }

  private async cleanupCurrentGeneration(): Promise<void> {
    const plan = this.cleanupPlan;
    if (!plan) {
      this.services = undefined;
      this.state = "idle";
      return;
    }

    const failures: unknown[] = [];
    if (!plan.componentRegistryCleared) {
      try {
        plan.componentRegistry!.clear();
        plan.componentRegistryCleared = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (!plan.virtualModulesCleared) {
      try {
        plan.virtualModules!.clear();
        plan.virtualModulesCleared = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (!plan.cacheCoordinatorDestroyed) {
      try {
        await plan.cacheCoordinator!.destroy();
        plan.cacheCoordinatorDestroyed = true;
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      this.state = "destroy-failed";
      throw new RendererLifecycleCleanupError(failures, () => this.destroy());
    }

    this.services = undefined;
    this.cleanupPlan = undefined;
    this.destroyRequested = false;
    this.state = "idle";
  }
}
