import { PageResolver } from "../page-resolution/index.js";
import { LayoutCollector } from "../layouts/layout-collector.js";
import { LayoutCompiler } from "../layouts/layout-compiler.js";
import { SSRRenderer } from "../ssr-renderer.js";
import { ComponentRegistry } from "../ssr/component-registry.js";
import { VirtualModuleSystem } from "../virtual-module-system.js";
import { PageRenderer } from "../page-renderer.js";
// contentSourceId is now a required field on RenderContext, computed upstream by proxy or fallback paths
export function createPageResolver(ctx) {
    return new PageResolver({
        projectDir: ctx.projectDir,
        config: ctx.config,
        adapter: ctx.adapter,
    });
}
export function createLayoutCollector(ctx, compileMDX) {
    return new LayoutCollector({
        projectDir: ctx.projectDir,
        adapter: ctx.adapter,
        config: ctx.config,
        compileMDX,
    });
}
export function createLayoutCompiler(ctx, compileMDX) {
    return new LayoutCompiler({
        adapter: ctx.adapter,
        compileMDX,
    });
}
export function createSSRRenderer(ctx) {
    return new SSRRenderer(ctx.mode, ctx.adapter, ctx.projectDir);
}
export function createComponentRegistry(ctx, virtualModules) {
    return new ComponentRegistry(virtualModules, ctx.port ?? 3001, ctx.adapter, ctx.moduleServerUrl, undefined, // vendorBundleHash
    ctx.projectId, // Project ID for cache isolation
    ctx.contentSourceId);
}
export function createVirtualModuleSystem(ctx) {
    return new VirtualModuleSystem("/_veryfront/modules", ctx.adapter);
}
export function createPageRenderer(ctx, options) {
    return new PageRenderer({
        projectDir: ctx.projectDir,
        mode: ctx.mode,
        config: ctx.config,
        adapter: ctx.adapter,
        componentRegistry: options.componentRegistry,
        compileMDX: options.compileMDX,
        moduleServerUrl: ctx.moduleServerUrl,
    });
}
export function createContextBoundServices(ctx, compileMDX) {
    const virtualModules = createVirtualModuleSystem(ctx);
    const componentRegistry = createComponentRegistry(ctx, virtualModules);
    return {
        pageResolver: createPageResolver(ctx),
        layoutCollector: createLayoutCollector(ctx, compileMDX),
        layoutCompiler: createLayoutCompiler(ctx, compileMDX),
        ssrRenderer: createSSRRenderer(ctx),
        componentRegistry,
        virtualModules,
        pageRenderer: createPageRenderer(ctx, { componentRegistry, compileMDX }),
    };
}
