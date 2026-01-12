/**
 * Renderer Factory State
 *
 * Centralized mutable state for the renderer factory.
 * Exported as a module singleton for use across submodules.
 *
 * @module server/shared/renderer/state
 */

import type { CachedRenderer, RendererPromise } from "./types.ts";
import { MAX_RENDERER_CACHE_SIZE } from "./constants.ts";
import { registerCache } from "@veryfront/core/memory/index.ts";

/**
 * LRU cache of renderer instances keyed by project slug.
 * This replaces the single-renderer pattern to support multi-project mode.
 */
export const rendererCache = new Map<string, CachedRenderer>();

/**
 * In-flight renderer creation promises to prevent duplicate creation.
 */
export const inFlightCreations = new Map<string, RendererPromise>();

/**
 * Single-project mode renderer (for backwards compatibility).
 * Used when no projectSlug is available.
 */
export let singleProjectRenderer: CachedRenderer | null = null;

/** Set the single project renderer */
export function setSingleProjectRenderer(renderer: CachedRenderer | null): void {
  singleProjectRenderer = renderer;
}

/**
 * Handle for the periodic memory check interval.
 */
export let memoryCheckInterval: ReturnType<typeof setInterval> | null = null;

/** Set the memory check interval handle */
export function setMemoryCheckInterval(
  interval: ReturnType<typeof setInterval> | null,
): void {
  memoryCheckInterval = interval;
}

// Register with memory profiler
registerCache("renderer-cache", () => ({
  name: "renderer-cache",
  entries: rendererCache.size + (singleProjectRenderer ? 1 : 0),
  maxEntries: MAX_RENDERER_CACHE_SIZE,
}));
