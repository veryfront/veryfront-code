import { computeHash, DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ConfigurationManager } from "./config.ts";
import { RendererLifecycle, type RendererServices } from "./lifecycle.ts";
import { MDXCompiler } from "./mdx.ts";
import { LayoutOrchestrator } from "./layout.ts";
import { createLayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { HTMLGenerator } from "./html.ts";
import { RenderPipeline } from "./pipeline.ts";
import { normalizeRoutePathname } from "./path-helpers.ts";
import { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.ts";
import type { StaticPathsResult } from "#veryfront/data";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";

// Re-export types for backward compatibility
export type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.ts";

export async function deriveDefaultRendererProjectId(
  projectDir: string,
): Promise<string> {
  return `proj_${await computeHash(projectDir)}`;
}

export function mergeRendererConfig(
  config: VeryfrontConfig | undefined,
  directories: RendererOptions["directories"],
): VeryfrontConfig | undefined {
  if (!directories) return config;

  return {
    ...(config ?? {}),
    directories: {
      ...config?.directories,
      ...directories,
      ...(directories.components ? { components: [...directories.components] } : {}),
    },
  };
}

interface RendererFacadeLifecycleOperation {
  readonly kind: "initialize" | "destroy";
  readonly promise: Promise<void>;
}

interface RendererFacadeOwnedResources {
  lifecycle?: RendererLifecycle;
  renderPipeline?: RenderPipeline;
  lifecycleDisposed: boolean;
  renderPipelineDisposed: boolean;
}

export class VeryfrontRenderer {
  private configManager!: ConfigurationManager;
  private lifecycle!: RendererLifecycle;
  private services!: RendererServices;
  private lifecycleOperation?: RendererFacadeLifecycleOperation;
  private resourceCleanupPromise?: Promise<void>;
  private lifecycleGeneration = 0;
  private ownedResources?: RendererFacadeOwnedResources;
  private adapter?: RuntimeAdapter;
  private port: number;
  private moduleServerUrl?: string;
  private projectDir: string;
  private mode: "development" | "production";
  private isLocalProject: boolean;
  private clientModuleStrategy: ClientModuleStrategy;
  private preloadedConfig?: VeryfrontConfig;
  private readonly configuredProjectId?: string;
  private readonly configuredProjectSlug?: string;
  private projectId!: string;
  private projectSlug!: string;
  private contentSourceId: string;
  private mdxCompiler!: MDXCompiler;
  private layoutOrchestrator!: LayoutOrchestrator;
  private htmlGenerator!: HTMLGenerator;
  private ssrOrchestrator!: SSROrchestrator;
  private renderPipeline!: RenderPipeline;

  constructor(options: RendererOptions) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.isLocalProject = options.isLocalProject === true;
    this.clientModuleStrategy = options.clientModuleStrategy === "fs" ? "fs" : "rsc-module";
    this.adapter = options.adapter;
    this.port = options.port ?? DEFAULT_DASHBOARD_PORT;
    this.moduleServerUrl = options.moduleServerUrl;
    this.preloadedConfig = mergeRendererConfig(
      options.config,
      options.directories,
    );

    this.configuredProjectId = options.projectId;
    this.configuredProjectSlug = options.projectSlug;
    this.contentSourceId = options.contentSourceId ?? "build-static";
  }

  initialize(): Promise<void> {
    const precedingOperation = this.lifecycleOperation;
    if (precedingOperation?.kind === "initialize") {
      return precedingOperation.promise;
    }

    const generation = ++this.lifecycleGeneration;
    const initialization = withSpan(
      "renderer.initialize",
      () => this.initializeGeneration(generation, precedingOperation?.promise),
      { "renderer.projectDir": this.projectDir, "renderer.mode": this.mode },
    );
    const operation: RendererFacadeLifecycleOperation = {
      kind: "initialize",
      promise: initialization,
    };
    this.lifecycleOperation = operation;
    void initialization.finally(() => {
      if (this.lifecycleOperation === operation) this.lifecycleOperation = undefined;
    }).catch(() => {});
    return initialization;
  }

  private async initializeGeneration(
    generation: number,
    precedingOperation?: Promise<void>,
  ): Promise<void> {
    if (precedingOperation) await precedingOperation;
    this.assertCurrentLifecycleGeneration(generation);

    if (this.ownedResources) {
      await this.cleanupOwnedResources();
      this.assertCurrentLifecycleGeneration(generation);
    }

    const ownedResources: RendererFacadeOwnedResources = {
      lifecycleDisposed: true,
      renderPipelineDisposed: true,
    };
    this.ownedResources = ownedResources;

    try {
      logger.debug("Initializing VeryfrontRenderer");

      this.projectId = this.configuredProjectId ??
        await deriveDefaultRendererProjectId(this.projectDir);
      this.projectSlug = this.configuredProjectSlug ??
        this.configuredProjectId ??
        this.projectId;
      this.assertCurrentLifecycleGeneration(generation);

      if (!this.adapter) {
        const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
        this.adapter = await runtime.get();
        this.assertCurrentLifecycleGeneration(generation);
      }

      this.configManager = new ConfigurationManager({
        projectDir: this.projectDir,
        mode: this.mode,
        adapter: this.adapter,
        config: this.preloadedConfig,
      });
      await this.configManager.initialize();
      this.assertCurrentLifecycleGeneration(generation);

      this.lifecycle = new RendererLifecycle({
        configManager: this.configManager,
        port: this.port,
        moduleServerUrl: this.moduleServerUrl,
        projectId: this.projectId,
        contentSourceId: this.contentSourceId,
      });
      ownedResources.lifecycle = this.lifecycle;
      ownedResources.lifecycleDisposed = false;
      const services = await this.lifecycle.initialize();
      this.assertCurrentLifecycleGeneration(generation);
      this.services = services;

      this.initializeModules();
      ownedResources.renderPipeline = this.renderPipeline;
      ownedResources.renderPipelineDisposed = false;
      this.lifecycle.updateCompileMDX(this.mdxCompiler.compileMDX.bind(this.mdxCompiler));

      logger.debug("VeryfrontRenderer initialized successfully");
    } catch (initializationError) {
      try {
        await this.cleanupOwnedResources();
      } catch (cleanupError) {
        throw new AggregateError(
          [initializationError, cleanupError],
          "VeryfrontRenderer initialization and cleanup failed",
        );
      }
      throw initializationError;
    }
  }

  private assertCurrentLifecycleGeneration(generation: number): void {
    if (generation === this.lifecycleGeneration) return;
    throw new Error("VeryfrontRenderer initialization was cancelled during shutdown");
  }

  private initializeModules(): void {
    const projectDir = this.configManager.getProjectDir();
    const mode = this.configManager.getMode();
    const adapter = this.configManager.getAdapter();
    const config = this.configManager.getConfig();

    this.mdxCompiler = new MDXCompiler({
      projectDir,
      mode,
      mdxCacheAdapter: this.services.mdxCacheAdapter,
    });

    this.layoutOrchestrator = new LayoutOrchestrator({
      projectDir,
      projectId: this.projectId,
      projectSlug: this.projectSlug,
      contentSourceId: this.contentSourceId,
      adapter,
      config,
      mode,
      moduleServerUrl: this.moduleServerUrl,
      layoutCollector: this.services.layoutCollector,
      layoutCompiler: this.services.layoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: this.services.componentRegistry.getAllAsComponents(),
    });

    this.htmlGenerator = new HTMLGenerator({
      projectDir,
      adapter,
      config,
      mode,
      isLocalProject: this.isLocalProject,
      clientModuleStrategy: this.clientModuleStrategy,
    });

    this.ssrOrchestrator = new SSROrchestrator({
      mode,
      debugMode: this.configManager.isDebugMode(),
      elementValidator: this.services.elementValidator,
      ssrRenderer: this.services.ssrRenderer,
      htmlGenerator: this.htmlGenerator,
      layoutOrchestrator: this.layoutOrchestrator,
    });

    this.renderPipeline = new RenderPipeline({
      pageResolver: this.services.pageResolver,
      cacheCoordinator: this.services.cacheCoordinator,
      pageRenderer: this.services.pageRenderer,
      layoutOrchestrator: this.layoutOrchestrator,
      ssrOrchestrator: this.ssrOrchestrator,
      adapter,
      mode,
      projectDir,
      isLocalProject: this.isLocalProject,
      clientModuleStrategy: this.clientModuleStrategy,
      projectId: this.projectId,
      contentSourceId: this.contentSourceId,
      config,
      directories: config.directories,
      dataCacheScope: mode === "production"
        ? {
          projectId: this.projectId,
          mode: "production",
          versionId: this.contentSourceId,
        }
        : null,
    });
  }

  private mergeRenderOptions(options?: RenderOptions): RenderOptions {
    return {
      ...options,
      projectId: options?.projectId ?? this.projectId,
      projectSlug: options?.projectSlug ?? this.projectSlug,
      contentSourceId: options?.contentSourceId ?? this.contentSourceId,
    };
  }

  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const mergedOptions = this.mergeRenderOptions(options);
    return withSpan(
      "renderer.renderPage",
      () => this.renderPipeline.renderPage(slug, mergedOptions),
      {
        "renderer.slug": slug,
      },
    );
  }

  getStaticPaths(
    slug: string,
    options?: Pick<RenderOptions, "projectId" | "contentSourceId" | "abortSignal">,
  ): Promise<StaticPathsResult | null> {
    const mergedOptions = this.mergeRenderOptions(options as RenderOptions | undefined);
    const pipelineOptions = {
      projectId: mergedOptions.projectId,
      contentSourceId: mergedOptions.contentSourceId,
      ...(mergedOptions.abortSignal ? { abortSignal: mergedOptions.abortSignal } : {}),
    };
    return withSpan(
      "renderer.getStaticPaths",
      () => this.renderPipeline.getStaticPaths(slug, pipelineOptions),
      { "renderer.slug": slug },
    );
  }

  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    const mergedOptions = this.mergeRenderOptions(options);
    return withSpan(
      "renderer.resolvePageData",
      () => this.renderPipeline.resolvePageData(slug, mergedOptions),
      {
        "renderer.slug": slug,
      },
    );
  }

  getAllPages(): Promise<string[]> {
    return withSpan("renderer.getAllPages", () => this.services.pageResolver.getAllPages(), {});
  }

  clearCache(slug?: string): void {
    if (slug) {
      try {
        this.lifecycle.clearSlugCache(slug);
      } finally {
        this.renderPipeline?.clearDataCacheForRoute(normalizeRoutePathname(slug));
      }
      return;
    }

    this.clearAllState();
  }

  clearAllState(): void {
    const failures: unknown[] = [];
    try {
      this.lifecycle?.clearAllCaches();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.layoutOrchestrator?.clearCache();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.renderPipeline?.clearDataCache();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Failed to clear renderer state");
    }
  }

  getVirtualModuleSystem() {
    return this.services.virtualModules;
  }

  async initializeComponents(): Promise<void> {
    await this.lifecycle.initializeComponents();
  }

  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<import("#veryfront/types").MdxBundle> {
    return this.mdxCompiler.compileMDX(content, frontmatter, filePath);
  }

  destroy(): Promise<void> {
    const precedingOperation = this.lifecycleOperation;
    if (precedingOperation?.kind === "destroy") {
      return precedingOperation.promise;
    }
    if (!this.ownedResources && !precedingOperation) {
      return Promise.resolve();
    }

    this.lifecycleGeneration++;
    const requestedCleanup = this.cleanupOwnedResources();
    const destruction = this.destroyGeneration(
      precedingOperation?.promise,
      requestedCleanup,
    );
    const operation: RendererFacadeLifecycleOperation = {
      kind: "destroy",
      promise: destruction,
    };
    this.lifecycleOperation = operation;
    void destruction.finally(() => {
      if (this.lifecycleOperation === operation) this.lifecycleOperation = undefined;
    }).catch(() => {});
    return destruction;
  }

  private async destroyGeneration(
    precedingOperation: Promise<void> | undefined,
    requestedCleanup: Promise<void>,
  ): Promise<void> {
    let cleanupError: unknown;
    try {
      await requestedCleanup;
    } catch (error) {
      cleanupError = error;
    }

    await precedingOperation?.catch(() => undefined);
    if (cleanupError !== undefined) throw cleanupError;
    await this.cleanupOwnedResources();
  }

  private cleanupOwnedResources(): Promise<void> {
    if (this.resourceCleanupPromise) return this.resourceCleanupPromise;
    const resources = this.ownedResources;
    if (!resources) return Promise.resolve();

    const cleanup = (async () => {
      const failures: unknown[] = [];
      if (!resources.renderPipelineDisposed) {
        if (!resources.renderPipeline) {
          resources.renderPipelineDisposed = true;
        } else {
          try {
            resources.renderPipeline.destroy();
            resources.renderPipelineDisposed = true;
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (!resources.lifecycleDisposed) {
        if (!resources.lifecycle) {
          resources.lifecycleDisposed = true;
        } else {
          try {
            await resources.lifecycle.destroy();
            resources.lifecycleDisposed = true;
          } catch (error) {
            failures.push(error);
          }
        }
      }

      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Failed to destroy renderer");
      }

      if (this.ownedResources === resources) this.ownedResources = undefined;
    })();
    this.resourceCleanupPromise = cleanup;
    void cleanup.finally(() => {
      if (this.resourceCleanupPromise === cleanup) {
        this.resourceCleanupPromise = undefined;
      }
    }).catch(() => {});
    return cleanup;
  }
}

export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr-orchestrator.ts";
export { SSROrchestrator } from "./ssr-orchestrator.ts";
