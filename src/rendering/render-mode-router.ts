/**
 * Render Mode Router
 *
 * Central dispatcher for all rendering operations. Uses the JIT Renderer
 * for all modes (production, preview, development).
 *
 * ## Architecture Overview
 *
 * All rendering now uses the JIT (Just-In-Time) bundler:
 *
 * ```
 * First request → esbuild bundles project (~100-200ms) → Store in API cache → Execute → Return HTML
 * Subsequent requests → Fetch cached bundle (~5-10ms) → Execute → Return HTML
 * ```
 *
 * Benefits:
 * - Zero path tokenization bugs (paths resolved at bundle time)
 * - Every pod serves identical content (same bundle from cache)
 * - Cache invalidation is trivial (content hash = cache key)
 * - Unified architecture for all environments
 *
 * ## Usage
 *
 * ```typescript
 * import { getRendererForMode, initializeRenderers } from './render-mode-router';
 *
 * // Initialize on server start
 * await initializeRenderers({ jit: { cache } });
 *
 * // Render a page
 * const result = await getRendererForMode(ctx).renderPage(slug, ctx);
 *
 * // Or use the convenience function
 * const result = await renderPageWithRouter(slug, ctx);
 * ```
 *
 * @module rendering/render-mode-router
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import type { RenderContext } from "./context/render-context.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import {
  destroyJitRenderer,
  getJitRenderer,
  isJitRendererInitialized,
  type JitRendererOptions,
} from "./jit-renderer.ts";
import { getRenderer, initializeRenderer } from "./renderer.ts";

// Track legacy renderer initialization
let legacyRendererInitialized = false;

/**
 * Get the legacy renderer (for development/test modes)
 */
function getLegacyRenderer(): CommonRenderer {
  return getRenderer();
}

/**
 * Common renderer interface shared by all renderers (JIT, legacy, watch)
 * All renderers must implement these methods for full feature parity.
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

type RenderMode = "jit-bundle" | "on-demand" | "watch";

/**
 * Options for render mode router
 */
export interface RenderModeRouterOptions {
  /** JIT renderer options */
  jit?: JitRendererOptions;
}

/**
 * Get the effective render mode, considering environment config and context
 *
 * NOTE: JIT bundler is preferred for production. Legacy renderer is used for
 * development/test modes due to React instance conflicts in non-compiled binary.
 * bundlerEnabled=false forces legacy mode for emergency rollback.
 */
export function getEffectiveRenderMode(ctx?: RenderContext): RenderMode {
  const env = getRuntimeEnv();

  // If bundler is explicitly disabled, use on-demand (legacy)
  if (!env.bundlerEnabled) {
    return "on-demand";
  }

  // Production environments use JIT bundler (proven in compiled binary)
  if (ctx?.environment === "production" || ctx?.mode === "production") {
    return "jit-bundle";
  }

  // Development/test modes use legacy renderer (avoids React instance conflicts)
  return env.renderMode;
}

/**
 * Check if JIT rendering should be used for a context
 */
export function shouldUseJitRenderer(ctx?: RenderContext): boolean {
  const mode = getEffectiveRenderMode(ctx);
  return mode === "jit-bundle";
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
 * Initialize renderers based on render mode
 *
 * Initializes both JIT renderer (for production) and legacy renderer (for development).
 */
export async function initializeRenderers(options?: RenderModeRouterOptions): Promise<void> {
  const env = getRuntimeEnv();

  logger.debug("[RenderModeRouter] Initializing renderers", {
    renderMode: env.renderMode,
    bundlerEnabled: env.bundlerEnabled,
  });

  // Initialize legacy renderer for development/test modes
  await initializeRenderer();
  legacyRendererInitialized = true;

  // Initialize JIT renderer for production
  getJitRenderer(options?.jit);

  logger.debug("[RenderModeRouter] Renderers initialized", {
    jitInitialized: isJitRendererInitialized(),
    legacyInitialized: legacyRendererInitialized,
  });
}

/**
 * Get the appropriate renderer for a render context
 *
 * Routes to JIT renderer for production or legacy renderer for development.
 * JIT renderer is preferred but has React instance conflicts in dev mode.
 */
export function getRendererForMode(ctx: RenderContext): CommonRenderer {
  const mode = getEffectiveRenderMode(ctx);

  // Use JIT renderer for production (avoids path tokenization issues)
  if (mode === "jit-bundle" && isJitRendererInitialized()) {
    logger.debug("[RenderModeRouter] Using JIT renderer", {
      projectId: ctx.projectId,
      environment: ctx.environment,
      mode,
    });
    return getJitRenderer();
  }

  logger.debug("[RenderModeRouter] Using legacy renderer", {
    projectId: ctx.projectId,
    environment: ctx.environment,
    mode,
  });

  // Use legacy renderer for development/test modes
  return getLegacyRenderer();
}

/**
 * Render a page using the appropriate renderer for the context
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
 * Resolve page data using the appropriate renderer for the context
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
 * Get all pages using the appropriate renderer for the context
 */
export async function getAllPagesWithRouter(ctx: RenderContext): Promise<string[]> {
  const renderer = getRendererForMode(ctx);
  return renderer.getAllPages(ctx);
}

/**
 * Clear caches for a context
 */
export async function clearCacheWithRouter(ctx: RenderContext, slug?: string): Promise<void> {
  // Only clear JIT renderer cache - legacy renderer is deprecated
  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCache(ctx, slug);
  }
}

/**
 * Clear caches for a project
 */
export async function clearCacheForProjectWithRouter(projectId: string): Promise<void> {
  logger.debug("[RenderModeRouter] Clearing cache for project", { projectId });

  // Only clear JIT renderer cache - legacy renderer is deprecated
  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCacheForProject(projectId);
  }
}

/**
 * Destroy all renderers
 */
export async function destroyRenderers(): Promise<void> {
  logger.debug("[RenderModeRouter] Destroying JIT renderer");

  if (isJitRendererInitialized()) {
    await destroyJitRenderer();
  }

  logger.debug("[RenderModeRouter] JIT renderer destroyed");
}

// Watch Mode Helpers (deprecated - JIT handles all modes)
// These functions remain for API compatibility but are no-ops.

/**
 * Check if watch mode is active for a context
 *
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function shouldUseWatchMode(_ctx?: RenderContext): boolean {
  return false;
}

/**
 * Trigger an incremental rebuild for a project in watch mode
 *
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export async function triggerWatchRebuild(_projectId: string): Promise<string | null> {
  return null;
}

/**
 * Get the HMR runtime code for a project
 *
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function getHmrRuntimeForProject(_projectId: string): string | null {
  return null;
}

/**
 * Get the current bundle for a project (without rebuilding)
 *
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export function getCurrentWatchBundle(_projectId: string): string | null {
  return null;
}

/**
 * Start watching a project for file changes (watch mode only)
 *
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
 * Stop watching a project
 *
 * @deprecated Watch mode is no longer used. JIT renderer handles all modes.
 */
export async function stopWatching(_projectId: string): Promise<void> {
  // No-op: JIT renderer handles all modes
}

// Re-export JIT renderer functions for convenience
export { getJitRenderer, isJitRendererInitialized } from "./jit-renderer.ts";
