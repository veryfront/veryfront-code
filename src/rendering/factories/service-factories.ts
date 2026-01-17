/**
 * Context-Bound Service Factories
 *
 * These factories create per-request service instances bound to a specific
 * RenderContext. This ensures tenant isolation in the universal renderer
 * by creating fresh service instances for each request.
 *
 * Services created here are LIGHTWEIGHT - they don't do expensive initialization.
 * Expensive work (esbuild, etc.) is done in SharedServices.
 *
 * @module rendering/factories/service-factories
 */

import type { RenderContext } from "../context/render-context.ts";
import type { CompileMDXFunction } from "../orchestrator/compiler-service.ts";
import { PageResolver, type PageResolverOptions } from "../page-resolution/index.ts";
import { LayoutCollector, type LayoutCollectorOptions } from "../layouts/layout-collector.ts";
import { LayoutCompiler, type LayoutCompilerOptions } from "../layouts/layout-compiler.ts";
import { ProviderManager, type ProviderManagerOptions } from "../layouts/provider-manager.ts";
import { SSRRenderer } from "../ssr-renderer.ts";
import { ComponentRegistry } from "../ssr/component-registry.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { PageRenderer } from "../page-renderer.ts";

/**
 * Create a PageResolver bound to the render context
 *
 * PageResolver handles slug-to-entity resolution and needs:
 * - projectDir: for file system access
 * - config: for directory settings
 * - adapter: for reading files
 *
 * @param ctx - Render context
 * @returns New PageResolver instance
 */
export function createPageResolver(ctx: RenderContext): PageResolver {
  const options: PageResolverOptions = {
    projectDir: ctx.projectDir,
    config: ctx.config,
    adapter: ctx.adapter,
  };
  return new PageResolver(options);
}

/**
 * Create a LayoutCollector bound to the render context
 *
 * LayoutCollector discovers and compiles layouts for pages.
 *
 * @param ctx - Render context
 * @param compileMDX - MDX compilation function
 * @returns New LayoutCollector instance
 */
export function createLayoutCollector(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): LayoutCollector {
  const options: LayoutCollectorOptions = {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    compileMDX,
  };
  return new LayoutCollector(options);
}

/**
 * Create a LayoutCompiler bound to the render context
 *
 * LayoutCompiler handles MDX layout compilation.
 *
 * @param ctx - Render context
 * @param compileMDX - MDX compilation function
 * @returns New LayoutCompiler instance
 */
export function createLayoutCompiler(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): LayoutCompiler {
  const options: LayoutCompilerOptions = {
    adapter: ctx.adapter,
    compileMDX,
  };
  return new LayoutCompiler(options);
}

/**
 * Create a ProviderManager bound to the render context
 *
 * ProviderManager discovers and manages React context providers.
 * Note: Has internal caching keyed by project ID for efficiency.
 *
 * @param ctx - Render context
 * @param compileMDX - MDX compilation function
 * @returns New ProviderManager instance
 */
export function createProviderManager(
  ctx: RenderContext,
  compileMDX: CompileMDXFunction,
): ProviderManager {
  const options: ProviderManagerOptions = {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    compileMDX,
  };
  return new ProviderManager(options);
}

/**
 * Create an SSRRenderer bound to the render context
 *
 * SSRRenderer handles React server-side rendering.
 *
 * @param ctx - Render context
 * @returns New SSRRenderer instance
 */
export function createSSRRenderer(ctx: RenderContext): SSRRenderer {
  return new SSRRenderer(ctx.mode, ctx.adapter, ctx.projectDir);
}

/**
 * Create a ComponentRegistry bound to the render context
 *
 * ComponentRegistry maps component names for SSR import resolution.
 *
 * @param ctx - Render context
 * @param virtualModules - Shared virtual module system
 * @returns New ComponentRegistry instance
 */
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

/**
 * Create a VirtualModuleSystem bound to the render context
 *
 * VirtualModuleSystem handles virtual module registration and serving.
 * Note: This creates a new instance per context for isolation.
 *
 * @param ctx - Render context
 * @returns New VirtualModuleSystem instance
 */
export function createVirtualModuleSystem(ctx: RenderContext): VirtualModuleSystem {
  return new VirtualModuleSystem("/_veryfront/modules", ctx.adapter);
}

/**
 * Options for creating a PageRenderer
 */
export interface CreatePageRendererOptions {
  componentRegistry: ComponentRegistry;
  compileMDX: CompileMDXFunction;
}

/**
 * Create a PageRenderer bound to the render context
 *
 * PageRenderer prepares page bundles for rendering.
 *
 * @param ctx - Render context
 * @param options - Additional options
 * @returns New PageRenderer instance
 */
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

/**
 * Collection of all context-bound services needed for rendering
 */
export interface ContextBoundServices {
  pageResolver: PageResolver;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  providerManager: ProviderManager;
  ssrRenderer: SSRRenderer;
  componentRegistry: ComponentRegistry;
  virtualModules: VirtualModuleSystem;
  pageRenderer: PageRenderer;
}

/**
 * Create all context-bound services at once
 *
 * This is a convenience function that creates all per-request services
 * in one call. Use this when you need all services for a full render.
 *
 * @param ctx - Render context
 * @param compileMDX - MDX compilation function
 * @returns All context-bound services
 */
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
    providerManager: createProviderManager(ctx, compileMDX),
    ssrRenderer: createSSRRenderer(ctx),
    componentRegistry,
    virtualModules,
    pageRenderer: createPageRenderer(ctx, { componentRegistry, compileMDX }),
  };
}
