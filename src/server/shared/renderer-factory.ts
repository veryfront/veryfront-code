/**
 * Shared Renderer Factory
 *
 * Provides centralized renderer lifecycle management with lazy initialization,
 * LRU caching, and cleanup capabilities. Used by SSR and module handlers.
 *
 * In multi-project mode, renderers are cached per-project with LRU eviction
 * to prevent unbounded memory growth.
 *
 * @module server/shared/renderer-factory
 */

import type { HandlerContext } from "../handlers/types.ts";
import { createRenderer } from "@veryfront/rendering/index.ts";
import { rendererLogger } from "@veryfront/utils";
import { clearSSRModuleCacheForProject } from "../../module-system/react-loader/ssr-module-loader.ts";
import { getHeapStats, registerCache } from "../../core/memory/index.ts";
import { clearConfigCache, getConfig } from "@veryfront/config";

type RendererInstance = Awaited<ReturnType<typeof createRenderer>>;
type RendererPromise = Promise<RendererInstance>;

/**
 * Maximum number of renderer instances to cache.
 * When exceeded, least recently used renderers are evicted.
 * Reduced from 15 to 10 to leave more headroom for Deno internals.
 */
const MAX_RENDERER_CACHE_SIZE = 10;

/**
 * TTL for cached renderers (30 minutes).
 * Renderers not accessed within this time are eligible for eviction.
 */
const RENDERER_TTL_MS = 30 * 60 * 1000;

/**
 * Memory pressure thresholds (percentage of heap limit).
 * When heap usage exceeds these thresholds, aggressive eviction kicks in.
 */
const MEMORY_PRESSURE_WARNING = 70; // Start evicting 50% of cache
const MEMORY_PRESSURE_CRITICAL = 85; // Emergency: keep only 2 renderers

/**
 * Interval for periodic memory pressure checks (30 seconds).
 * This catches slow memory growth even when no new renderers are being created.
 */
const MEMORY_CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Handle for the periodic memory check interval.
 */
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null;

interface CachedRenderer {
  renderer: RendererInstance;
  promise: RendererPromise;
  projectSlug: string;
  lastAccess: number;
  createdAt: number;
}

/**
 * LRU cache of renderer instances keyed by project slug.
 * This replaces the single-renderer pattern to support multi-project mode.
 */
const rendererCache = new Map<string, CachedRenderer>();

/**
 * In-flight renderer creation promises to prevent duplicate creation.
 */
const inFlightCreations = new Map<string, RendererPromise>();

/**
 * Single-project mode renderer (for backwards compatibility).
 * Used when no projectSlug is available.
 */
let singleProjectRenderer: CachedRenderer | null = null;

// Register with memory profiler
registerCache("renderer-cache", () => ({
  name: "renderer-cache",
  entries: rendererCache.size + (singleProjectRenderer ? 1 : 0),
  maxEntries: MAX_RENDERER_CACHE_SIZE,
}));

/**
 * Clean up a renderer instance and its associated caches.
 */
async function destroyRenderer(cached: CachedRenderer): Promise<void> {
  const { renderer, projectSlug } = cached;

  rendererLogger.info("[RendererFactory] Destroying renderer", {
    projectSlug,
    age: Math.round((Date.now() - cached.createdAt) / 1000),
  });

  try {
    // Clear all state from the renderer
    renderer.clearAllState?.();

    // Destroy the renderer (clears internal caches)
    await renderer.destroy?.();

    // Clear SSR module cache for this project to prevent memory growth
    if (projectSlug && projectSlug !== "__single__") {
      clearSSRModuleCacheForProject(projectSlug);
    }
  } catch (error) {
    rendererLogger.warn("[RendererFactory] Error destroying renderer", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Evict least recently used renderers to maintain cache size.
 */
async function evictLRU(targetSize: number = MAX_RENDERER_CACHE_SIZE - 1): Promise<void> {
  if (rendererCache.size <= targetSize) {
    return;
  }

  // Sort by last access time (oldest first)
  const entries = [...rendererCache.entries()]
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toEvict = entries.slice(0, rendererCache.size - targetSize);

  for (const [key, cached] of toEvict) {
    rendererCache.delete(key);
    await destroyRenderer(cached);
  }

  rendererLogger.info("[RendererFactory] LRU eviction complete", {
    evicted: toEvict.length,
    remaining: rendererCache.size,
  });
}

/**
 * Check memory pressure and evict renderers if needed.
 * This is called before creating new renderers and periodically in the background.
 *
 * @param source - Where the check was triggered from (for logging)
 * @returns Whether any eviction occurred
 */
async function checkAndEvictUnderMemoryPressure(
  source: "pre-creation" | "periodic" | "manual" = "pre-creation",
): Promise<boolean> {
  const heap = getHeapStats();
  const { heapUsedPercent: usedPercent } = heap;
  const { size: cacheSize } = rendererCache;
  const hasSingleProject = !!singleProjectRenderer;

  // Always log the check with current state
  rendererLogger.info("[RendererFactory] Memory pressure check", {
    source,
    heapUsedMB: heap.usedHeapSizeMB,
    heapLimitMB: heap.heapSizeLimitMB,
    heapUsedPercent: usedPercent,
    rssMB: heap.rss,
    rendererCacheSize: cacheSize,
    hasSingleProject,
    thresholds: {
      warning: MEMORY_PRESSURE_WARNING,
      critical: MEMORY_PRESSURE_CRITICAL,
    },
  });

  if (usedPercent >= MEMORY_PRESSURE_CRITICAL) {
    // Critical: keep only 2 most recent renderers
    const targetSize = 2;
    rendererLogger.warn("[RendererFactory] CRITICAL memory pressure - emergency eviction", {
      source,
      heapUsedPercent: usedPercent,
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      currentSize: cacheSize,
      targetSize,
      action: "evicting all but 2 renderers",
    });
    await evictLRU(targetSize);

    // Also clear single project renderer if we have one and cache is still too big
    if (singleProjectRenderer && rendererCache.size >= targetSize) {
      rendererLogger.warn(
        "[RendererFactory] Evicting single-project renderer due to critical pressure",
      );
      await destroyRenderer(singleProjectRenderer);
      singleProjectRenderer = null;
    }

    // Log post-eviction state
    const postHeap = getHeapStats();
    rendererLogger.info("[RendererFactory] Post-eviction state", {
      source,
      heapUsedMB: postHeap.usedHeapSizeMB,
      heapUsedPercent: postHeap.heapUsedPercent,
      rendererCacheSize: rendererCache.size,
    });

    return true;
  } else if (usedPercent >= MEMORY_PRESSURE_WARNING) {
    // Warning: evict 50% of cache
    const targetSize = Math.max(2, Math.floor(cacheSize / 2));
    rendererLogger.warn("[RendererFactory] High memory pressure - evicting half of cache", {
      source,
      heapUsedPercent: usedPercent,
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      currentSize: cacheSize,
      targetSize,
      action: "evicting 50% of renderers",
    });
    await evictLRU(targetSize);

    // Log post-eviction state
    const postHeap = getHeapStats();
    rendererLogger.info("[RendererFactory] Post-eviction state", {
      source,
      heapUsedMB: postHeap.usedHeapSizeMB,
      heapUsedPercent: postHeap.heapUsedPercent,
      rendererCacheSize: rendererCache.size,
    });

    return true;
  }

  // Memory is OK
  rendererLogger.debug("[RendererFactory] Memory pressure OK", {
    source,
    heapUsedPercent: usedPercent,
    rendererCacheSize: cacheSize,
  });

  return false;
}

/**
 * Evict expired renderers based on TTL.
 */
async function evictExpired(): Promise<void> {
  const now = Date.now();
  const expired: string[] = [];

  for (const [key, cached] of rendererCache) {
    if (now - cached.lastAccess > RENDERER_TTL_MS) {
      expired.push(key);
    }
  }

  for (const key of expired) {
    const cached = rendererCache.get(key);
    if (cached) {
      rendererCache.delete(key);
      await destroyRenderer(cached);
    }
  }

  if (expired.length > 0) {
    rendererLogger.info("[RendererFactory] Evicted expired renderers", {
      count: expired.length,
      remaining: rendererCache.size,
    });
  }
}

/**
 * Get the cache key for a project.
 */
function getCacheKey(ctx: HandlerContext): string | null {
  // In multi-project mode, use project slug as key
  return ctx.projectSlug || null;
}

/**
 * Get or create renderer for a project.
 *
 * In multi-project mode (when projectSlug is available), renderers are
 * cached per-project with LRU eviction to prevent memory growth.
 *
 * @param ctx - Handler context with projectDir, mode, adapter, projectSlug
 * @returns Renderer instance
 */
export async function getRendererForProject(ctx: HandlerContext): Promise<RendererInstance> {
  const cacheKey = getCacheKey(ctx);

  // Single-project mode (no projectSlug)
  if (!cacheKey) {
    if (singleProjectRenderer) {
      singleProjectRenderer.lastAccess = Date.now();
      return singleProjectRenderer.renderer;
    }

    // Check for in-flight creation
    // IMPORTANT: This check must happen synchronously before any await
    const existingInFlight = inFlightCreations.get("__single__");
    if (existingInFlight) {
      return existingInFlight;
    }

    // Create and register the in-flight promise SYNCHRONOUSLY before any await
    // This prevents race conditions where concurrent calls all pass the in-flight check
    const creationPromise = (async () => {
      const renderer = await createRendererInternal(ctx, "__single__");
      singleProjectRenderer = {
        renderer,
        promise: Promise.resolve(renderer),
        projectSlug: "__single__",
        lastAccess: Date.now(),
        createdAt: Date.now(),
      };
      return renderer;
    })();

    // Register immediately (synchronously) so concurrent calls see it
    inFlightCreations.set("__single__", creationPromise);

    try {
      return await creationPromise;
    } finally {
      inFlightCreations.delete("__single__");
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
  const existingInFlight = inFlightCreations.get(cacheKey);
  if (existingInFlight) {
    rendererLogger.debug("[RendererFactory] Waiting for in-flight creation", {
      projectSlug: cacheKey,
    });
    return existingInFlight;
  }

  // Create and register the in-flight promise SYNCHRONOUSLY before any await
  // This prevents race conditions where concurrent calls all pass the in-flight check
  const creationPromise = (async () => {
    // Check memory pressure before creating new renderer
    await checkAndEvictUnderMemoryPressure();

    // Evict expired entries first
    await evictExpired();

    // Evict LRU if at capacity
    if (rendererCache.size >= MAX_RENDERER_CACHE_SIZE) {
      await evictLRU();
    }

    // Create new renderer
    const renderer = await createRendererInternal(ctx, cacheKey);

    rendererCache.set(cacheKey, {
      renderer,
      promise: Promise.resolve(renderer),
      projectSlug: cacheKey,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    });

    rendererLogger.info("[RendererFactory] Renderer cached", {
      projectSlug: cacheKey,
      cacheSize: rendererCache.size,
    });

    return renderer;
  })();

  // Register immediately (synchronously) so concurrent calls see it
  inFlightCreations.set(cacheKey, creationPromise);

  try {
    return await creationPromise;
  } finally {
    inFlightCreations.delete(cacheKey);
  }
}

/**
 * Internal renderer creation with logging.
 */
async function createRendererInternal(
  ctx: HandlerContext,
  projectSlug: string,
): Promise<RendererInstance> {
  rendererLogger.info("[RendererFactory] Creating renderer", {
    projectSlug,
    mode: ctx.mode,
  });

  try {
    // In multi-project mode (when projectSlug !== "__single__"), load config fresh
    // This runs within runWithContext so FSAdapter reads from the correct project
    // This is necessary because ctx.config from the universal handler is the startup config
    // which doesn't have project-specific settings like defaultLayout
    let config = ctx.config;
    if (projectSlug !== "__single__" && ctx.projectSlug) {
      rendererLogger.info("[RendererFactory] Loading project-specific config", {
        projectSlug,
        projectDir: ctx.projectDir,
      });
      // Clear config cache before loading - in proxy mode, projectDir is always /app
      // but different projects have different configs. The cache is keyed by projectDir
      // so we need to clear it to ensure we load the correct project's config.
      clearConfigCache();
      config = await getConfig(ctx.projectDir, ctx.adapter);
      rendererLogger.info("[RendererFactory] Project config loaded", {
        projectSlug,
        hasDefaultLayout: !!config?.defaultLayout,
        defaultLayout: config?.defaultLayout,
      });
    }

    const renderer = await createRenderer({
      projectDir: ctx.projectDir,
      mode: ctx.mode,
      adapter: ctx.adapter,
      moduleServerUrl: ctx.moduleServerUrl,
      config,
    });

    rendererLogger.debug("[RendererFactory] Renderer created", { projectSlug });
    return renderer;
  } catch (error) {
    rendererLogger.error("[RendererFactory] Renderer creation failed", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Get or create renderer instance (legacy API).
 *
 * @deprecated Use getRendererForProject instead for multi-project support.
 */
export async function getRenderer(
  ctx: HandlerContext,
  rendererInit?: RendererPromise | null,
): Promise<RendererInstance> {
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
export function createRendererPromise(ctx: HandlerContext): RendererPromise {
  return getRendererForProject(ctx);
}

/**
 * Cleanup all cached renderer instances.
 *
 * Destroys all renderer instances that were created, cleaning up
 * their internal resources (cache stores, intervals, etc.).
 * Should be called during test cleanup or server shutdown.
 */
export async function cleanupRenderers(): Promise<void> {
  rendererLogger.info("[RendererFactory] Cleaning up all renderers", {
    cacheSize: rendererCache.size,
    hasSingleProject: !!singleProjectRenderer,
    hasPeriodicCheck: !!memoryCheckInterval,
  });

  // Stop periodic memory check first
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }

  // Clean up all cached renderers
  for (const [_key, cached] of rendererCache) {
    await destroyRenderer(cached);
  }
  rendererCache.clear();

  // Clean up single-project renderer
  if (singleProjectRenderer) {
    await destroyRenderer(singleProjectRenderer);
    singleProjectRenderer = null;
  }

  // Clear in-flight creations
  inFlightCreations.clear();

  rendererLogger.info("[RendererFactory] Renderer cleanup complete");
}

/**
 * Evict a specific project's renderer from cache.
 *
 * @param projectSlug - Project slug to evict
 */
export async function evictProjectRenderer(projectSlug: string): Promise<void> {
  const cached = rendererCache.get(projectSlug);
  if (cached) {
    rendererCache.delete(projectSlug);
    await destroyRenderer(cached);
    rendererLogger.info("[RendererFactory] Evicted project renderer", { projectSlug });
  }
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
} {
  return {
    size: rendererCache.size,
    maxSize: MAX_RENDERER_CACHE_SIZE,
    projects: [...rendererCache.keys()],
  };
}

/**
 * Start periodic memory pressure checks.
 * This catches slow memory growth even when no new renderers are being created.
 * Should be called when the server starts.
 */
export function startPeriodicMemoryCheck(): void {
  if (memoryCheckInterval) {
    rendererLogger.debug("[RendererFactory] Periodic memory check already running");
    return;
  }

  rendererLogger.info("[RendererFactory] Starting periodic memory check", {
    intervalMs: MEMORY_CHECK_INTERVAL_MS,
    warningThreshold: MEMORY_PRESSURE_WARNING,
    criticalThreshold: MEMORY_PRESSURE_CRITICAL,
  });

  const interval = setInterval(async () => {
    try {
      await checkAndEvictUnderMemoryPressure("periodic");
    } catch (error) {
      rendererLogger.error("[RendererFactory] Error in periodic memory check", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  // Ensure interval doesn't prevent process exit
  if (typeof interval === "object" && "unref" in interval) {
    (interval as { unref: () => void }).unref();
  }

  memoryCheckInterval = interval;
}

/**
 * Stop periodic memory pressure checks.
 * Should be called during shutdown or cleanup.
 */
export function stopPeriodicMemoryCheck(): void {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
    rendererLogger.info("[RendererFactory] Stopped periodic memory check");
  }
}

/**
 * Manually trigger a memory pressure check.
 * Useful for testing or when you know memory pressure is high.
 */
export async function triggerMemoryCheck(): Promise<boolean> {
  return await checkAndEvictUnderMemoryPressure("manual");
}

/**
 * Check if memory is too high to safely process a request.
 * Returns true if the request should be rejected to prevent OOM.
 *
 * This is a fast, synchronous check that should be called before starting
 * expensive SSR operations.
 */
export function shouldRejectDueToMemory(): boolean {
  const heap = getHeapStats();
  // Reject if we're above 90% of heap limit - OOM is imminent
  if (heap.heapUsedPercent >= 90) {
    rendererLogger.warn("[RendererFactory] Rejecting request - memory critical", {
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      heapUsedPercent: heap.heapUsedPercent,
    });
    return true;
  }
  return false;
}

/**
 * Aggressively clear caches for a specific project after SSR render.
 * This should be called after every SSR render to prevent memory buildup
 * from large projects like codersociety.
 *
 * @param projectSlug - Project slug to clear caches for
 * @param projectId - Project ID for SSR module cache
 */
export async function clearProjectCachesAfterRender(
  projectSlug: string,
  projectId?: string,
): Promise<void> {
  const heap = getHeapStats();

  // Only do aggressive eviction if memory is elevated (>50% of heap)
  if (heap.heapUsedPercent < 50) {
    return;
  }

  rendererLogger.info("[RendererFactory] Post-render cache eviction", {
    projectSlug,
    projectId,
    heapUsedMB: heap.usedHeapSizeMB,
    heapUsedPercent: heap.heapUsedPercent,
  });

  // Clear SSR module cache for this project
  if (projectId) {
    clearSSRModuleCacheForProject(projectId);
  } else if (projectSlug) {
    clearSSRModuleCacheForProject(projectSlug);
  }

  // If memory is very high, also trigger broader eviction
  if (heap.heapUsedPercent >= 70) {
    await checkAndEvictUnderMemoryPressure("manual");
  }
}
