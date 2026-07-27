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

export class VeryfrontRenderer {
  private configManager!: ConfigurationManager;
  private lifecycle!: RendererLifecycle;
  private services!: RendererServices;
  private adapter?: RuntimeAdapter;
  private port: number;
  private moduleServerUrl?: string;
  private projectDir: string;
  private mode: "development" | "production";
  private isLocalProject: boolean;
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
    return withSpan(
      "renderer.initialize",
      async () => {
        logger.debug("Initializing VeryfrontRenderer");

        this.projectId = this.configuredProjectId ??
          await deriveDefaultRendererProjectId(this.projectDir);
        this.projectSlug = this.configuredProjectSlug ??
          this.configuredProjectId ??
          this.projectId;

        if (!this.adapter) {
          const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
          this.adapter = await runtime.get();
        }

        this.configManager = new ConfigurationManager({
          projectDir: this.projectDir,
          mode: this.mode,
          adapter: this.adapter,
          config: this.preloadedConfig,
        });
        await this.configManager.initialize();

        this.lifecycle = new RendererLifecycle({
          configManager: this.configManager,
          port: this.port,
          moduleServerUrl: this.moduleServerUrl,
          projectId: this.projectId,
          contentSourceId: this.contentSourceId,
        });
        this.services = await this.lifecycle.initialize();

        this.initializeModules();
        this.lifecycle.updateCompileMDX(this.mdxCompiler.compileMDX.bind(this.mdxCompiler));

        logger.debug("VeryfrontRenderer initialized successfully");
      },
      { "renderer.projectDir": this.projectDir, "renderer.mode": this.mode },
    );
  }

  private initializeModules(): void {
    // Re-initialization replaces the owned pipeline generation.
    this.renderPipeline?.destroy();

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

  async destroy(): Promise<void> {
    const failures: unknown[] = [];
    try {
      this.renderPipeline?.destroy();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.lifecycle?.destroy();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Failed to destroy renderer");
    }
  }
}

export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr-orchestrator.ts";
export { SSROrchestrator } from "./ssr-orchestrator.ts";
