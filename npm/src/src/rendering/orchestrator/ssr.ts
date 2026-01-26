import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "../../utils/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import { ConfigurationManager } from "./config.js";
import { RendererLifecycle, type RendererServices } from "./lifecycle.js";
import { MDXCompiler } from "./mdx.js";
import { LayoutOrchestrator } from "./layout.js";
import { createLayoutComponentCache } from "../layouts/utils/component-loader.js";
import { HTMLGenerator } from "./html.js";
import { RenderPipeline } from "./pipeline.js";
import { SSROrchestrator } from "./ssr-orchestrator.js";
import type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";

// Re-export types for backward compatibility
export type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.js";

export class VeryfrontRenderer {
  private configManager!: ConfigurationManager;
  private lifecycle!: RendererLifecycle;
  private services!: RendererServices;
  private adapter?: RuntimeAdapter;
  private port: number;
  private moduleServerUrl?: string;
  private projectDir: string;
  private mode: "development" | "production";
  private preloadedConfig?: VeryfrontConfig;
  private projectId: string;
  private projectSlug: string;
  private contentSourceId: string;
  private mdxCompiler!: MDXCompiler;
  private layoutOrchestrator!: LayoutOrchestrator;
  private htmlGenerator!: HTMLGenerator;
  private ssrOrchestrator!: SSROrchestrator;
  private renderPipeline!: RenderPipeline;

  constructor(options: RendererOptions) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.adapter = options.adapter;
    this.port = options.port ?? DEFAULT_DASHBOARD_PORT;
    this.moduleServerUrl = options.moduleServerUrl;
    this.preloadedConfig = options.config;
    // Generate a short projectId if not provided - use hash of projectDir to avoid
    // issues with long paths being URL-encoded in cache directories
    this.projectId = options.projectId ?? this.hashProjectDir(options.projectDir);
    this.projectSlug = options.projectSlug ?? options.projectId ??
      this.hashProjectDir(options.projectDir);
    this.contentSourceId = options.contentSourceId ?? "build-static";
  }

  /** Generate a short hash-based identifier from a path */
  private hashProjectDir(path: string): string {
    // Simple hash function to create a short, URL-safe identifier
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to base36 and make positive
    return `proj_${Math.abs(hash).toString(36)}`;
  }

  initialize(): Promise<void> {
    return withSpan(
      "renderer.initialize",
      async () => {
        logger.debug("Initializing VeryfrontRenderer");

        if (!this.adapter) {
          const { runtime } = await import("../../platform/adapters/detect.js");
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
    });

    this.ssrOrchestrator = new SSROrchestrator({
      mode,
      debugMode: this.configManager.isDebugMode(),
      elementValidator: this.services.elementValidator,
      ssrRenderer: this.services.ssrRenderer,
      htmlGenerator: this.htmlGenerator,
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
    });
  }

  renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    // Inject instance-level context values into render options
    const mergedOptions: RenderOptions = {
      ...options,
      projectId: options?.projectId ?? this.projectId,
      projectSlug: options?.projectSlug ?? this.projectSlug,
      contentSourceId: options?.contentSourceId ?? this.contentSourceId,
    };
    return withSpan(
      "renderer.renderPage",
      () => this.renderPipeline.renderPage(slug, mergedOptions),
      {
        "renderer.slug": slug,
      },
    );
  }

  resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse> {
    // Inject instance-level context values into render options
    const mergedOptions: RenderOptions = {
      ...options,
      projectId: options?.projectId ?? this.projectId,
      projectSlug: options?.projectSlug ?? this.projectSlug,
      contentSourceId: options?.contentSourceId ?? this.contentSourceId,
    };
    return withSpan(
      "renderer.resolvePageData",
      () => this.renderPipeline.resolvePageData(slug, mergedOptions),
      { "renderer.slug": slug },
    );
  }

  getAllPages(): Promise<string[]> {
    return withSpan("renderer.getAllPages", () => this.services.pageResolver.getAllPages(), {});
  }

  clearCache(slug?: string): void {
    if (slug) {
      this.lifecycle.clearSlugCache(slug);
      return;
    }

    this.lifecycle.clearAllCaches();
    this.layoutOrchestrator.clearCache();
  }

  clearAllState(): void {
    this.lifecycle.clearAllCaches();
    this.layoutOrchestrator.clearCache();
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
  ): Promise<import("../../types/index.js").MdxBundle> {
    return this.mdxCompiler.compileMDX(content, frontmatter, filePath);
  }

  destroy(): Promise<void> {
    return this.lifecycle.destroy();
  }
}

export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr-orchestrator.js";
export { SSROrchestrator } from "./ssr-orchestrator.js";
