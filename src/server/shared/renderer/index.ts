/**
 * Shared Renderer Factory
 *
 * Provides centralized renderer lifecycle management with lazy initialization,
 * LRU caching, and cleanup capabilities. Used by SSR and module handlers.
 *
 * In multi-project mode, renderers are cached per-project with LRU eviction
 * to prevent unbounded memory growth.
 *
 * ## Universal Renderer Mode
 *
 * When UNIVERSAL_RENDERER=1 is set, a shared universal renderer is used instead
 * of creating per-project renderer instances. This eliminates 7+ second cold
 * starts for new projects by sharing expensive initialization (esbuild, etc.)
 * across all tenants.
 *
 * @module server/shared/renderer
 */

import { rendererLogger } from "@veryfront/utils";
import { clearConfigCache, getConfig } from "@veryfront/config";
import type { HandlerContext } from "../../handlers/types.ts";
import type { AnyRenderer, AnyRendererPromise, RendererInstance } from "./types.ts";
import { MAX_RENDERER_CACHE_SIZE } from "./constants.ts";
import { rendererCache, setSingleProjectRenderer, singleProjectRenderer } from "./state.ts";
import { getCacheKey } from "./cache/key-generation.ts";
import {
  clearInFlightCreation,
  getInFlightCreation,
  setInFlightCreation,
} from "./cache/in-flight.ts";
import { evictExpired, evictLRU } from "./cache/lru-cache.ts";
import { createRendererInternal } from "./lifecycle/creation.ts";
import { checkAndEvictUnderMemoryPressure } from "./memory/pressure.ts";
import {
  getRendererForProjectUniversal,
  isUniversalRendererEnabled,
  type RendererAdapter,
} from "./universal-adapter.ts";

// Re-export types
export type {
  AnyRenderer,
  AnyRendererPromise,
  CachedRenderer,
  RendererInstance,
  RendererPromise,
} from "./types.ts";
export type { RendererAdapter } from "./universal-adapter.ts";

// Re-export constants
export {
  MAX_RENDERER_CACHE_SIZE,
  MEMORY_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_CRITICAL,
  MEMORY_PRESSURE_WARNING,
  RENDERER_TTL_MS,
} from "./constants.ts";

// Re-export lifecycle functions
export { cleanupRenderers, destroyRenderer, evictProjectRenderer } from "./lifecycle/cleanup.ts";

// Re-export memory functions
export {
  checkAndEvictUnderMemoryPressure,
  clearProjectCachesAfterRender,
  shouldRejectDueToMemory,
} from "./memory/pressure.ts";
export {
  startPeriodicMemoryCheck,
  stopPeriodicMemoryCheck,
  triggerMemoryCheck,
} from "./memory/periodic-check.ts";

// Re-export cache functions
export { evictExpired, evictLRU } from "./cache/lru-cache.ts";
export { getCacheKey } from "./cache/key-generation.ts";

/**
 * Get or create renderer for a project.
 *
 * In multi-project mode (when projectSlug is available), renderers are
 * cached per-project with LRU eviction to prevent memory growth.
 *
 * When UNIVERSAL_RENDERER=1 is set, uses a shared universal renderer instead
 * of creating per-project instances. This eliminates cold start times.
 *
 * @param ctx - Handler context with projectDir, mode, adapter, projectSlug
 * @returns Renderer instance or adapter
 */
export async function getRendererForProject(
  ctx: HandlerContext,
): Promise<RendererInstance | RendererAdapter> {
  // Check if universal renderer mode is enabled
  if (isUniversalRendererEnabled()) {
    rendererLogger.debug("[RendererFactory] Using universal renderer mode");
    return getRendererForProjectUniversal(ctx);
  }

  const cacheKey = getCacheKey(ctx);

  // Single-project mode (no projectSlug)
  if (!cacheKey) {
    if (singleProjectRenderer) {
      singleProjectRenderer.lastAccess = Date.now();
      return singleProjectRenderer.renderer;
    }

    // Check for in-flight creation
    // IMPORTANT: This check must happen synchronously before any await
    const existingInFlight = getInFlightCreation("__single__");
    if (existingInFlight) {
      return existingInFlight;
    }

    // Create and register the in-flight promise SYNCHRONOUSLY before any await
    // This prevents race conditions where concurrent calls all pass the in-flight check
    const creationPromise = (async () => {
      const renderer = await createRendererInternal(ctx, "__single__");
      setSingleProjectRenderer({
        renderer,
        promise: Promise.resolve(renderer),
        projectSlug: "__single__",
        lastAccess: Date.now(),
        createdAt: Date.now(),
      });
      return renderer;
    })();

    // Register immediately (synchronously) so concurrent calls see it
    setInFlightCreation("__single__", creationPromise);

    try {
      return await creationPromise;
    } finally {
      clearInFlightCreation("__single__");
    }
  }

  // Multi-project mode - check cache
  const cached = rendererCache.get(cacheKey);
  if (cached) {
    cached.lastAccess = Date.now();
    rendererLogger.debug("[RendererFactory] Cache hit", { projectSlug: cacheKey });
    return cached.renderer;
  }

  // Check for in-flight creation (prevents duplicate renderers for same project)
  // IMPORTANT: This check must happen synchronously before any await
  const existingInFlight = getInFlightCreation(cacheKey);
  if (existingInFlight) {
    rendererLogger.debug("[RendererFactory] Waiting for in-flight creation", {
      projectSlug: cacheKey,
    });
    return existingInFlight;
  }

  // Create and register the in-flight promise SYNCHRONOUSLY before any await
  // This prevents race conditions where concurrent calls all pass the in-flight check
  const creationPromise = (async () => {
    // CRITICAL: Load config FIRST while AsyncLocalStorage context is still valid.
    // The AsyncLocalStorage context may be lost after async boundaries in the IIFE.
    // By loading config as the first await, we ensure it happens while we still have
    // access to the MultiProjectFSAdapter's per-request context.
    let projectConfig = ctx.config;
    if (cacheKey !== "__single__" && ctx.projectSlug) {
      rendererLogger.debug("[RendererFactory] Loading project-specific config", {
        projectSlug: cacheKey,
      });
      clearConfigCache();
      projectConfig = await getConfig(ctx.projectDir, ctx.adapter);
      rendererLogger.debug("[RendererFactory] Project config loaded", {
        projectSlug: cacheKey,
      });
    }

    // After config is loaded, we can do memory management (context doesn't matter here)
    await checkAndEvictUnderMemoryPressure();

    // Evict expired entries first
    await evictExpired();

    // Evict LRU if at capacity
    if (rendererCache.size >= MAX_RENDERER_CACHE_SIZE) {
      await evictLRU();
    }

    // Create new renderer with pre-loaded config
    const renderer = await createRendererInternal(ctx, cacheKey, projectConfig);

    rendererCache.set(cacheKey, {
      renderer,
      promise: Promise.resolve(renderer),
      projectSlug: cacheKey,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    });

    rendererLogger.debug("[RendererFactory] Renderer cached", {
      projectSlug: cacheKey,
      cacheSize: rendererCache.size,
    });

    return renderer;
  })();

  // Register immediately (synchronously) so concurrent calls see it
  setInFlightCreation(cacheKey, creationPromise);

  try {
    return await creationPromise;
  } finally {
    clearInFlightCreation(cacheKey);
  }
}

/**
 * Get or create renderer instance (legacy API).
 *
 * @deprecated Use getRendererForProject instead for multi-project support.
 */
export async function getRenderer(
  ctx: HandlerContext,
  rendererInit?: AnyRendererPromise | null,
): Promise<AnyRenderer> {
  // If caller provided a cached promise, use it
  if (rendererInit) {
    return await rendererInit;
  }

  // Use the new per-project caching
  return getRendererForProject(ctx);
}

/**
 * Create a new renderer promise for caching.
 *
 * @deprecated Use getRendererForProject which handles caching internally.
 */
export function createRendererPromise(
  ctx: HandlerContext,
): Promise<RendererInstance | RendererAdapter> {
  return getRendererForProject(ctx);
}

/**
 * Get the current renderer count (for testing/debugging).
 */
export function getRendererCount(): number {
  return rendererCache.size + (singleProjectRenderer ? 1 : 0);
}

/**
 * Get cache statistics for monitoring.
 */
export function getRendererCacheStats(): {
  size: number;
  maxSize: number;
  projects: string[];
  universalMode: boolean;
} {
  return {
    size: rendererCache.size,
    maxSize: MAX_RENDERER_CACHE_SIZE,
    projects: [...rendererCache.keys()],
    universalMode: isUniversalRendererEnabled(),
  };
}

// Re-export universal renderer functions
export {
  destroyUniversalRendererAdapter,
  getRendererForProjectUniversal,
  isUniversalRendererEnabled,
} from "./universal-adapter.ts";
