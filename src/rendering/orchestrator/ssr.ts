import { rendererLogger as logger } from "@veryfront/utils";
import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { ConfigurationManager } from "./config.ts";
import { RendererLifecycle, type RendererServices } from "./lifecycle.ts";
import { MDXCompiler } from "./mdx.ts";
import { LayoutOrchestrator } from "./layout.ts";
import { createLayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { HTMLGenerator } from "./html.ts";
import { RenderPipeline } from "./pipeline.ts";
import { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { RendererOptions, RenderOptions, RenderResult } from "./types.ts";

// Re-export types for backward compatibility
export type { RendererOptions, RenderOptions, RenderResult } from "./types.ts";

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
  private mdxCompiler!: MDXCompiler;
  private layoutOrchestrator!: LayoutOrchestrator;
  private htmlGenerator!: HTMLGenerator;
  private ssrOrchestrator!: SSROrchestrator;
  private renderPipeline!: RenderPipeline;

  constructor(options: RendererOptions) {
    this.projectDir = options.projectDir;
    this.mode = options.mode;
    this.adapter = options.adapter;
    this.port = options.port || DEFAULT_DASHBOARD_PORT;
    this.moduleServerUrl = options.moduleServerUrl;
    this.preloadedConfig = options.config;
  }

  async initialize(): Promise<void> {
    logger.info("Initializing VeryfrontRenderer");

    if (!this.adapter) {
      const { getAdapter } = await import("@veryfront/platform/adapters/detect.ts");
      this.adapter = await getAdapter();
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
    });
    this.services = await this.lifecycle.initialize();

    this.initializeModules();
    this.lifecycle.updateCompileMDX(this.mdxCompiler.compileMDX.bind(this.mdxCompiler));

    logger.info("VeryfrontRenderer initialized successfully");
  }

  private initializeModules(): void {
    this.mdxCompiler = new MDXCompiler({
      projectDir: this.configManager.getProjectDir(),
      mode: this.configManager.getMode(),
      mdxCacheAdapter: this.services.mdxCacheAdapter,
    });

    this.layoutOrchestrator = new LayoutOrchestrator({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.configManager.getAdapter(),
      config: this.configManager.getConfig(),
      mode: this.configManager.getMode(),
      moduleServerUrl: this.moduleServerUrl,
      layoutCollector: this.services.layoutCollector,
      layoutCompiler: this.services.layoutCompiler,
      providerManager: this.services.providerManager,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: this.services.componentRegistry.getAllAsComponents(),
    });

    this.htmlGenerator = new HTMLGenerator({
      projectDir: this.configManager.getProjectDir(),
      adapter: this.configManager.getAdapter(),
      config: this.configManager.getConfig(),
      mode: this.configManager.getMode(),
    });

    this.ssrOrchestrator = new SSROrchestrator({
      mode: this.configManager.getMode(),
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
      adapter: this.configManager.getAdapter(),
      mode: this.configManager.getMode(),
      projectDir: this.configManager.getProjectDir(),
    });
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    return await this.renderPipeline.renderPage(slug, options);
  }

  async getAllPages(): Promise<string[]> {
    return await this.services.pageResolver.getAllPages();
  }

  clearCache(slug?: string): void {
    if (slug) {
      this.lifecycle.clearSlugCache(slug);
    } else {
      this.lifecycle.clearAllCaches();
      this.layoutOrchestrator.clearCache();
    }
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

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<import("@veryfront/types").MdxBundle> {
    return await this.mdxCompiler.compileMDX(content, frontmatter, filePath);
  }

  async destroy(): Promise<void> {
    await this.lifecycle.destroy();
  }
}

export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr-orchestrator.ts";
export { SSROrchestrator } from "./ssr-orchestrator.ts";
