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
import { initializeRenderer } from "./renderer.ts";

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
 *
 * NOTE: JIT bundler is now used for ALL modes (production, preview, development).
 * This unification eliminates the need for maintaining two separate renderers and
 * ensures consistent behavior across all environments. The JIT bundler handles
 * arbitrary file structures through fallback entry point detection.
 */
export function getEffectiveRenderMode(_ctx?: RenderContext): RenderMode {
  // Always use JIT bundler - it now handles all modes including development
  return "jit-bundle";
}

/**
 * Check if JIT rendering should be used for a context
 *
 * NOTE: Always returns true since JIT bundler now handles all modes.
 */
export function shouldUseJitRenderer(_ctx?: RenderContext): boolean {
  return true;
}

// Track if preview bundler has been initialized
let previewBundlerInitialized = false;

/**
 * Check if preview bundler is initialized
 */
export function isPreviewBundlerInitialized(): boolean {
  return previewBundlerInitialized;
}

/**
 * Initialize renderers based on render mode
 *
 * NOTE: Only initializes JIT renderer. Legacy renderer initialization is kept
 * for backward compatibility but JIT is used for all modes.
 */
export async function initializeRenderers(options?: RenderModeRouterOptions): Promise<void> {
  const env = getRuntimeEnv();

  logger.debug("[RenderModeRouter] Initializing JIT renderer (unified mode)", {
    renderMode: "jit-bundle",
    bundlerEnabled: env.bundlerEnabled,
  });

  // Initialize legacy renderer for backward compatibility (may be removed in future)
  await initializeRenderer();

  // Initialize JIT renderer - used for ALL modes
  getJitRenderer(options?.jit);

  // Preview bundler is no longer needed since JIT handles all modes
  // Keeping the flag for interface compatibility
  previewBundlerInitialized = false;

  logger.debug("[RenderModeRouter] JIT renderer initialized (unified mode)", {
    jitInitialized: isJitRendererInitialized(),
  });
}

/**
 * Get the appropriate renderer for a render context
 *
 * NOTE: Always returns JIT renderer. The JIT bundler now handles all modes
 * including development and testing, with fallback entry point detection
 * for arbitrary file structures.
 */
export function getRendererForMode(ctx: RenderContext): CommonRenderer {
  // Always use JIT renderer - it now handles all modes
  logger.debug("[RenderModeRouter] Using JIT renderer", {
    projectId: ctx.projectId,
    environment: ctx.environment,
  });
  return getJitRenderer();
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
  logger.debug("[RenderModeRouter] Destroying renderers");

  // Destroy JIT renderer
  if (isJitRendererInitialized()) {
    await destroyJitRenderer();
  }

  // Shutdown preview bundler if initialized
  if (previewBundlerInitialized) {
    await resetPreviewBundler();
    previewBundlerInitialized = false;
    logger.debug("[RenderModeRouter] Preview bundler shutdown");
  }

  logger.debug("[RenderModeRouter] JIT renderer destroyed");
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
