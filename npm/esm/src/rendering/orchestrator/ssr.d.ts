import type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.js";
export type { PageDataResponse, RendererOptions, RenderOptions, RenderResult } from "./types.js";
export declare class VeryfrontRenderer {
    private configManager;
    private lifecycle;
    private services;
    private adapter?;
    private port;
    private moduleServerUrl?;
    private projectDir;
    private mode;
    private preloadedConfig?;
    private projectId;
    private projectSlug;
    private contentSourceId;
    private mdxCompiler;
    private layoutOrchestrator;
    private htmlGenerator;
    private ssrOrchestrator;
    private renderPipeline;
    constructor(options: RendererOptions);
    /** Generate a short hash-based identifier from a path */
    private hashProjectDir;
    initialize(): Promise<void>;
    private initializeModules;
    renderPage(slug: string, options?: RenderOptions): Promise<RenderResult>;
    resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse>;
    getAllPages(): Promise<string[]>;
    clearCache(slug?: string): void;
    clearAllState(): void;
    getVirtualModuleSystem(): import("../virtual-module-system.js").VirtualModuleSystem;
    initializeComponents(): Promise<void>;
    compileMDX(content: string, frontmatter?: Record<string, unknown>, filePath?: string): Promise<import("../../types/index.js").MdxBundle>;
    destroy(): Promise<void>;
}
export type { SSROrchestratorConfig, SSRRenderingResult } from "./ssr-orchestrator.js";
export { SSROrchestrator } from "./ssr-orchestrator.js";
//# sourceMappingURL=ssr.d.ts.map