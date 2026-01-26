/**
 * Renderer Adapter
 *
 * Adapts the shared Renderer to work with handler contexts.
 * Creates lightweight adapters that bind the shared renderer
 * to a specific project context.
 *
 * @module server/shared/renderer/adapter
 */
import * as dntShim from "../../../../_dnt.shims.js";
import type { HandlerContext } from "../../handlers/types.js";
import type { PageDataResponse, RenderOptions, RenderResult } from "../../../rendering/orchestrator/types.js";
import type { MdxBundle } from "../../../types/index.js";
export interface RendererAdapter {
    renderPage(slug: string, options?: RenderOptions): Promise<RenderResult>;
    resolvePageData(slug: string, options?: RenderOptions): Promise<PageDataResponse>;
    getAllPages(): Promise<string[]>;
    clearCache(slug?: string): void;
    clearAllState(): void;
    getVirtualModuleSystem(): {
        handleRequest(req: dntShim.Request): dntShim.Response | null;
        register(id: string, source: string, projectDir: string): Promise<string>;
        registerModule(id: string, source: string, projectDir: string): Promise<string>;
        getModule(id: string): unknown;
        clear(): void;
    };
    initializeComponents(): Promise<void>;
    compileMDX(content: string, frontmatter?: Record<string, unknown>, filePath?: string): Promise<MdxBundle>;
    destroy(): Promise<void>;
}
export declare function getRendererForProject(ctx: HandlerContext): Promise<RendererAdapter>;
export declare function destroyRendererAdapter(): Promise<void>;
//# sourceMappingURL=adapter.d.ts.map