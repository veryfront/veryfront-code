import type { RenderContext } from "../context/render-context.js";
import type { CompileMDXFunction } from "../orchestrator/compiler-service.js";
import { PageResolver } from "../page-resolution/index.js";
import { LayoutCollector } from "../layouts/layout-collector.js";
import { LayoutCompiler } from "../layouts/layout-compiler.js";
import { SSRRenderer } from "../ssr-renderer.js";
import { ComponentRegistry } from "../ssr/component-registry.js";
import { VirtualModuleSystem } from "../virtual-module-system.js";
import { PageRenderer } from "../page-renderer.js";
export declare function createPageResolver(ctx: RenderContext): PageResolver;
export declare function createLayoutCollector(ctx: RenderContext, compileMDX: CompileMDXFunction): LayoutCollector;
export declare function createLayoutCompiler(ctx: RenderContext, compileMDX: CompileMDXFunction): LayoutCompiler;
export declare function createSSRRenderer(ctx: RenderContext): SSRRenderer;
export declare function createComponentRegistry(ctx: RenderContext, virtualModules: VirtualModuleSystem): ComponentRegistry;
export declare function createVirtualModuleSystem(ctx: RenderContext): VirtualModuleSystem;
export interface CreatePageRendererOptions {
    componentRegistry: ComponentRegistry;
    compileMDX: CompileMDXFunction;
}
export declare function createPageRenderer(ctx: RenderContext, options: CreatePageRendererOptions): PageRenderer;
export interface ContextBoundServices {
    pageResolver: PageResolver;
    layoutCollector: LayoutCollector;
    layoutCompiler: LayoutCompiler;
    ssrRenderer: SSRRenderer;
    componentRegistry: ComponentRegistry;
    virtualModules: VirtualModuleSystem;
    pageRenderer: PageRenderer;
}
export declare function createContextBoundServices(ctx: RenderContext, compileMDX: CompileMDXFunction): ContextBoundServices;
//# sourceMappingURL=service-factories.d.ts.map