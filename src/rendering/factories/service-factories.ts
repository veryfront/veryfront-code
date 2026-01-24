import type { RenderContext } from "../context/render-context.ts";
import type { CompileMDXFunction } from "../orchestrator/compiler-service.ts";
import { PageResolver } from "../page-resolution/index.ts";
import { LayoutCollector } from "../layouts/layout-collector.ts";
import { LayoutCompiler } from "../layouts/layout-compiler.ts";
import { SSRRenderer } from "../ssr-renderer.ts";
import { ComponentRegistry } from "../ssr/component-registry.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { PageRenderer } from "../page-renderer.ts";

export function createPageResolver(ctx: RenderContext): PageResolver {
  return new PageResolver({
    projectDir: ctx.projectDir,
    config: ctx.config,
    adapter: ctx.adapter,
  });
}

export function createLayoutCollector(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): LayoutCollector {
  return new LayoutCollector({
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    compileMDX,
  });
}

export function createLayoutCompiler(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): LayoutCompiler {
  return new LayoutCompiler({
    adapter: ctx.adapter,
    compileMDX,
  });
}

export function createSSRRenderer(ctx: RenderContext): SSRRenderer {
  return new SSRRenderer(ctx.mode, ctx.adapter, ctx.projectDir);
}

export function createComponentRegistry(
  ctx: RenderContext,
  virtualModules: VirtualModuleSystem,
): ComponentRegistry {
  return new ComponentRegistry(
    virtualModules,
    ctx.port ?? 3001,
    ctx.adapter,
    ctx.moduleServerUrl,
    undefined, // vendorBundleHash
    ctx.projectId, // Project ID for cache isolation
  );
}

export function createVirtualModuleSystem(ctx: RenderContext): VirtualModuleSystem {
  return new VirtualModuleSystem("/_veryfront/modules", ctx.adapter);
}

export interface CreatePageRendererOptions {
  componentRegistry: ComponentRegistry;
  compileMDX: CompileMDXFunction;
}

export function createPageRenderer(
  ctx: RenderContext,
  options: CreatePageRendererOptions,
): PageRenderer {
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

export interface ContextBoundServices {
  pageResolver: PageResolver;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  ssrRenderer: SSRRenderer;
  componentRegistry: ComponentRegistry;
  virtualModules: VirtualModuleSystem;
  pageRenderer: PageRenderer;
}

export function createContextBoundServices(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): ContextBoundServices {
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
