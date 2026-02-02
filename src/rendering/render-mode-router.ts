/**
 * Render Mode Router
 *
 * Central dispatcher that selects the appropriate renderer based on environment
 * and configuration. This is the entry point for all rendering operations.
 *
 * ## Architecture Overview
 *
 * The renderer supports three distinct modes optimized for different use cases:
 *
 * ### Production Mode: JIT Bundle (`jit-bundle`)
 * ```
 * First request → esbuild bundles project (~100-200ms) → Store in API cache → Execute → Return HTML
 * Subsequent requests → Fetch cached bundle (~5-10ms) → Execute → Return HTML
 * ```
 * Benefits:
 * - Zero path tokenization bugs (paths resolved at bundle time)
 * - Every pod serves identical content (same bundle from cache)
 * - Cache invalidation is trivial (content hash = cache key)
 *
 * ### Preview Mode: Watch (`watch`)
 * ```
 * File change → esbuild incremental rebuild (~10-50ms) → HMR update → Browser refresh
 * ```
 * Benefits:
 * - Sub-second feedback during development
 * - Native HMR support via WebSocket
 * - No distributed cache needed (local-only)
 *
 * ### Legacy Mode: On-Demand (`on-demand`)
 * ```
 * Request → Per-file transform → Cache transform result → Execute → Return HTML
 * ```
 * Used as fallback when bundler is disabled or for specific edge cases.
 *
 * ## Mode Selection Logic
 *
 * 1. If `bundlerEnabled=false` → always use on-demand
 * 2. If preview + development context → use watch mode
 * 3. If production context → use jit-bundle (if enabled) or on-demand
 * 4. Otherwise → use configured `renderMode` from environment
 *
 * ## Usage
 *
 * ```typescript
 * import { getRendererForMode, initializeRenderers } from './render-mode-router';
 *
 * // Initialize on server start
 * await initializeRenderers({ legacy: { cache }, jit: { cache } });
 *
 * // Render a page (automatically selects correct renderer)
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
import {
  getPreviewBundler,
  type PreviewBundlerConfig,
  resetPreviewBundler,
} from "../bundler/preview-bundler.ts";
import {
  destroyRenderer,
  getRenderer,
  initializeRenderer,
  isRendererInitialized,
} from "./renderer.ts";

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
  /** Preview bundler options (for watch mode) */
  preview?: PreviewBundlerConfig;
  /** Force a specific render mode (overrides env config) */
  forceMode?: RenderMode;
}

/**
 * Get the effective render mode, considering environment config and context
 */
export function getEffectiveRenderMode(ctx?: RenderContext): RenderMode {
  const env = getRuntimeEnv();

  // If bundler is explicitly disabled, force on-demand mode
  if (!env.bundlerEnabled) {
    return "on-demand";
  }

  // Check context for environment-specific overrides
  if (ctx) {
    // Preview mode uses watch mode for HMR support
    if (ctx.environment === "preview" && ctx.mode === "development") {
      return "watch";
    }

    // Production environments use JIT bundler
    if (ctx.environment === "production") {
      return env.renderMode === "jit-bundle" ? "jit-bundle" : "on-demand";
    }
  }

  return env.renderMode;
}

/**
 * Check if JIT rendering should be used for a context
 */
export function shouldUseJitRenderer(ctx?: RenderContext): boolean {
  const mode = getEffectiveRenderMode(ctx);
  return mode === "jit-bundle";
}

// Track if preview bundler has been initialized
let previewBundlerInitialized = false;

// Track legacy renderer initialization
let legacyRendererInitialized = false;

/**
 * Check if preview bundler is initialized
 */
export function isPreviewBundlerInitialized(): boolean {
  return previewBundlerInitialized;
}

/**
 * Initialize renderers based on render mode
 *
 * - JIT renderer is used for production (jit-bundle mode)
 * - Legacy renderer is used for on-demand and watch modes
 * - Preview bundler is initialized for watch mode to provide HMR and incremental builds
 */
export async function initializeRenderers(options?: RenderModeRouterOptions): Promise<void> {
  const env = getRuntimeEnv();
  const mode = options?.forceMode ?? env.renderMode;

  logger.debug("[RenderModeRouter] Initializing renderers", {
    renderMode: mode,
    bundlerEnabled: env.bundlerEnabled,
  });

  // Initialize legacy renderer for on-demand and watch modes
  await initializeRenderer();
  legacyRendererInitialized = true;

  // Initialize JIT renderer for production (jit-bundle mode)
  getJitRenderer(options?.jit);

  // Initialize preview bundler for watch mode (provides HMR and incremental builds)
  if (mode === "watch") {
    getPreviewBundler(options?.preview);
    previewBundlerInitialized = true;
    logger.debug("[RenderModeRouter] Preview bundler initialized for watch mode");
  }

  logger.debug("[RenderModeRouter] Renderers initialized", {
    legacyRendererInitialized,
    jitInitialized: isJitRendererInitialized(),
    previewBundlerInitialized,
    mode,
  });
}

/**
 * Get the appropriate renderer for a render context
 *
 * Routes to JIT renderer for production (jit-bundle mode) or falls back
 * to legacy renderer for on-demand and watch modes.
 */
export function getRendererForMode(ctx: RenderContext): CommonRenderer {
  const mode = getEffectiveRenderMode(ctx);

  // Use JIT renderer for jit-bundle mode (production)
  if (mode === "jit-bundle" && isJitRendererInitialized()) {
    logger.debug("[RenderModeRouter] Using JIT renderer", {
      projectId: ctx.projectId,
      environment: ctx.environment,
      mode,
    });
    return getJitRenderer();
  }

  // Check if legacy renderer is initialized
  if (!isRendererInitialized()) {
    logger.warn("[RenderModeRouter] Legacy renderer not initialized, will initialize on demand");
  }

  logger.debug("[RenderModeRouter] Using legacy renderer", {
    projectId: ctx.projectId,
    environment: ctx.environment,
    mode,
    legacyRendererInitialized,
    previewBundlerActive: mode === "watch" ? previewBundlerInitialized : undefined,
  });

  // Use legacy renderer for on-demand and watch modes
  return getRenderer();
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
  // Clear legacy renderer cache
  if (legacyRendererInitialized) {
    await getRenderer().clearCache(ctx, slug);
  }

  // Also clear JIT renderer cache for consistency
  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCache(ctx, slug);
  }
}

/**
 * Clear caches for a project
 */
export async function clearCacheForProjectWithRouter(projectId: string): Promise<void> {
  logger.debug("[RenderModeRouter] Clearing cache for project", { projectId });

  // Clear legacy renderer cache
  if (legacyRendererInitialized) {
    await getRenderer().clearCacheForProject(projectId);
  }

  // Also clear JIT renderer cache for consistency
  if (isJitRendererInitialized()) {
    await getJitRenderer().clearCacheForProject(projectId);
  }
}

/**
 * Destroy all renderers
 */
export async function destroyRenderers(): Promise<void> {
  logger.debug("[RenderModeRouter] Destroying renderers");

  // Destroy legacy renderer
  if (legacyRendererInitialized) {
    await destroyRenderer();
    legacyRendererInitialized = false;
    logger.debug("[RenderModeRouter] Legacy renderer shutdown");
  }

  // Destroy JIT renderer
  if (isJitRendererInitialized()) {
    await destroyJitRenderer();
  }

  // Shutdown preview bundler
  if (previewBundlerInitialized) {
    await resetPreviewBundler();
    previewBundlerInitialized = false;
    logger.debug("[RenderModeRouter] Preview bundler shutdown");
  }

  logger.debug("[RenderModeRouter] Renderers destroyed");
}

// Watch Mode Helpers

/**
 * Check if watch mode is active for a context
 */
export function shouldUseWatchMode(ctx?: RenderContext): boolean {
  const mode = getEffectiveRenderMode(ctx);
  return mode === "watch" && previewBundlerInitialized;
}

/**
 * Trigger an incremental rebuild for a project in watch mode
 *
 * @param projectId - The project identifier
 * @returns The rebuilt bundle code, or null if not in watch mode
 */
export async function triggerWatchRebuild(projectId: string): Promise<string | null> {
  if (!previewBundlerInitialized) {
    logger.debug("[RenderModeRouter] Cannot trigger rebuild - preview bundler not initialized");
    return null;
  }

  try {
    const bundler = getPreviewBundler();
    return await bundler.rebuild(projectId);
  } catch (error) {
    logger.error("[RenderModeRouter] Watch rebuild failed", {
      projectId,
      error: String(error),
    });
    throw error;
  }
}

/**
 * Get the HMR runtime code for a project
 *
 * @param projectId - The project identifier
 * @returns The HMR runtime JavaScript code, or null if not in watch mode
 */
export function getHmrRuntimeForProject(projectId: string): string | null {
  if (!previewBundlerInitialized) {
    return null;
  }

  const bundler = getPreviewBundler();
  return bundler.getHmrRuntime(projectId);
}

/**
 * Get the current bundle for a project (without rebuilding)
 *
 * @param projectId - The project identifier
 * @returns The current bundle code, or null if not available
 */
export function getCurrentWatchBundle(projectId: string): string | null {
  if (!previewBundlerInitialized) {
    return null;
  }

  const bundler = getPreviewBundler();
  return bundler.getCurrentBundle(projectId);
}

/**
 * Start watching a project for file changes (watch mode only)
 *
 * @param projectId - The project identifier
 * @param projectDir - The project directory path
 * @param adapter - The runtime adapter
 * @param options - Build options
 */
export async function startWatching(
  projectId: string,
  projectDir: string,
  adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
  options?: { entryPoint?: string; reactVersion?: string },
): Promise<void> {
  if (!previewBundlerInitialized) {
    logger.warn("[RenderModeRouter] Cannot start watching - preview bundler not initialized");
    return;
  }

  const bundler = getPreviewBundler();
  await bundler.watch(projectId, projectDir, adapter, options);
}

/**
 * Stop watching a project
 *
 * @param projectId - The project identifier
 */
export async function stopWatching(projectId: string): Promise<void> {
  if (!previewBundlerInitialized) {
    return;
  }

  const bundler = getPreviewBundler();
  await bundler.stopWatching(projectId);
}

// Re-export JIT renderer functions for convenience
export { getJitRenderer, isJitRendererInitialized } from "./jit-renderer.ts";
