/**
 * Render Mode Router
 *
 * Central dispatcher for all rendering operations using the JIT bundler.
 *
 * ## Architecture
 *
 * All rendering uses the JIT (Just-In-Time) bundler. There is ONE render mode.
 *
 * ```
 * First request → esbuild bundles project (~100-200ms) → Store in cache → Execute → Return HTML
 * Subsequent requests → Fetch cached bundle (~5-10ms) → Execute → Return HTML
 * ```
 *
 * Benefits:
 * - Zero path tokenization bugs (paths resolved at bundle time)
 * - Every pod serves identical content (same bundle from cache)
 * - Cache invalidation is trivial (content hash = cache key)
 * - Unified architecture for all environments
 *
 * @module rendering/render-mode-router
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { RenderContext } from "./context/render-context.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import {
  destroyJitRenderer,
  getJitRenderer,
  isJitRendererInitialized,
  type JitRendererOptions,
} from "./jit-renderer.ts";

/**
 * Common renderer interface for the JIT renderer.
 * All rendering operations go through this interface.
 */
export interface CommonRenderer {
  renderPage(slug: string, ctx: RenderContext, options?: RenderOptions): Promise<RenderResult>;
  resolvePageData(
    slug: string,
    ctx: RenderContext,
    options?: RenderOptions,
  ): Promise<PageDataResponse>;
  getAllPages(ctx: RenderContext): Promise<string[]>;
  clearCache(ctx: RenderContext, slug?: string): Promise<void>;
  clearCacheForProject(projectId: string): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * Options for render mode router
 */
export interface RenderModeRouterOptions {
  /** JIT renderer options */
  jit?: JitRendererOptions;
}

/**
 * Check if JIT rendering should be used for a context
 *
 * Always returns true - JIT is the only render mode.
 */
export function shouldUseJitRenderer(_ctx?: RenderContext): boolean {
  return true;
}

/**
 * Check if preview bundler is initialized
 *
 * NOTE: Always returns false since preview bundler is no longer used.
 * JIT renderer handles all modes including preview/development.
 */
export function isPreviewBundlerInitialized(): boolean {
  return false;
}

/**
 * Initialize the JIT renderer
 */
export async function initializeRenderers(options?: RenderModeRouterOptions): Promise<void> {
  logger.debug("[RenderModeRouter] Initializing JIT renderer");

  // Initialize JIT renderer
  getJitRenderer(options?.jit);

  logger.debug("[RenderModeRouter] JIT renderer initialized", {
    jitInitialized: isJitRendererInitialized(),
  });
}

/**
 * Get the JIT renderer for a render context
 *
 * Auto-initializes the JIT renderer if not already initialized.
 */
export function getRendererForMode(ctx: RenderContext): CommonRenderer {
  logger.debug("[RenderModeRouter] Using JIT renderer", {
    projectId: ctx.projectId,
    environment: ctx.environment,
  });

  // getJitRenderer auto-creates the singleton if not already initialized
  return getJitRenderer();
}

/**
 * Render a page using the JIT renderer
 */
export async function renderPageWithRouter(
  slug: string,
  ctx: RenderContext,
  options?: RenderOptions,
): Promise<RenderResult> {
  const renderer = getRendererForMode(ctx);
  return renderer.renderPage(slug, ctx, options);
}

/**
 * Resolve page data using the JIT renderer
 */
export async function resolvePageDataWithRouter(
  slug: string,
  ctx: RenderContext,
  options?: RenderOptions,
): Promise<PageDataResponse> {
  const renderer = getRendererForMode(ctx);
  return renderer.resolvePageData(slug, ctx, options);
}

/**
 * Get all pages using the JIT renderer
 */
export async function getAllPagesWithRouter(ctx: RenderContext): Promise<string[]> {
  const renderer = getRendererForMode(ctx);
  return renderer.getAllPages(ctx);
}

/**
 * Clear JIT renderer cache for a context
 */
export async function clearCacheWithRouter(ctx: RenderContext, slug?: string): Promise<void> {
  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCache(ctx, slug);
  }
}

/**
 * Clear JIT renderer cache for a project
 */
export async function clearCacheForProjectWithRouter(projectId: string): Promise<void> {
  logger.debug("[RenderModeRouter] Clearing cache for project", { projectId });

  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCacheForProject(projectId);
  }
}

/**
 * Destroy the JIT renderer
 */
export async function destroyRenderers(): Promise<void> {
  logger.debug("[RenderModeRouter] Destroying JIT renderer");

  if (isJitRendererInitialized()) {
    await destroyJitRenderer();
  }

  logger.debug("[RenderModeRouter] JIT renderer destroyed");
}

// Deprecated watch mode helpers - kept for API compatibility but are no-ops.

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function shouldUseWatchMode(_ctx?: RenderContext): boolean {
  return false;
}

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export async function triggerWatchRebuild(_projectId: string): Promise<string | null> {
  return null;
}

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function getHmrRuntimeForProject(_projectId: string): string | null {
  return null;
}

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function getCurrentWatchBundle(_projectId: string): string | null {
  return null;
}

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export async function startWatching(
  _projectId: string,
  _projectDir: string,
  _adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
  _options?: { entryPoint?: string; reactVersion?: string },
): Promise<void> {
  // No-op: JIT renderer handles all modes
}

/**
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export async function stopWatching(_projectId: string): Promise<void> {
  // No-op: JIT renderer handles all modes
}

// Re-export JIT renderer functions for convenience
export { getJitRenderer, isJitRendererInitialized } from "./jit-renderer.ts";

// Keep getEffectiveRenderMode for backward compatibility but always returns "jit-bundle"
/**
 * @deprecated There is only one render mode (JIT). This always returns "jit-bundle".
 */
export function getEffectiveRenderMode(_ctx?: RenderContext): "jit-bundle" {
  return "jit-bundle";
}
