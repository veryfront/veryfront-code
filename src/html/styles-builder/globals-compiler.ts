/**
 * Globals CSS Compiler
 *
 * Compiles project's globals.css using Tailwind's programmatic API.
 * Handles @theme, @utility, @variant, @plugin directives properly.
 *
 * Features:
 * - Project-isolated caching (no cross-project data leakage)
 * - Pre-warmed Tailwind base CSS
 * - Performance metrics
 * - Registry-registered caches for visibility
 */

import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import { registerMapCache, CacheKeyPrefix } from "#veryfront/cache/index.ts";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

// ============================================================================
// CACHE KEY PREFIX
// ============================================================================

/**
 * Use the centralized cache key prefix for globals CSS.
 * Format: globals:{projectId}:{contentHash}
 */
const GLOBALS_CSS_PREFIX = CacheKeyPrefix.GLOBALS_CSS;

// ============================================================================
// CACHES (Project-isolated)
// ============================================================================

/**
 * Cache for Tailwind base CSS (shared - same for all projects)
 */
let tailwindBaseCSS: string | null = null;
let tailwindBaseCSSPromise: Promise<string> | null = null;

/**
 * Cache for loaded plugin modules (shared - plugins are project-agnostic)
 */
const pluginCache = new Map<string, unknown>();

/**
 * Cache for compiled CSS output
 * Key format: globals:{projectId}:{contentHash}
 * This ensures project isolation - each project has its own cache entries
 */
const compiledCache = new Map<string, string>();

// Register caches with the registry for visibility and management
registerMapCache("globals-plugin-cache", pluginCache as Map<string, unknown>);
registerMapCache("globals-compiled-cache", compiledCache as Map<string, unknown>);

// ============================================================================
// METRICS
// ============================================================================

interface CompilationMetrics {
  totalCompilations: number;
  cacheHits: number;
  cacheMisses: number;
  totalCompileTimeMs: number;
  avgCompileTimeMs: number;
  lastCompileTimeMs: number;
}

const metrics: CompilationMetrics = {
  totalCompilations: 0,
  cacheHits: 0,
  cacheMisses: 0,
  totalCompileTimeMs: 0,
  avgCompileTimeMs: 0,
  lastCompileTimeMs: 0,
};

/**
 * Get compilation metrics for monitoring.
 */
export function getGlobalsCSSMetrics(): CompilationMetrics {
  return { ...metrics };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Fast hash using djb2 algorithm.
 * More collision-resistant than simple additive hash.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit and then to base36
  return (hash >>> 0).toString(36);
}

/**
 * Build a project-scoped cache key for globals CSS.
 */
function buildGlobalsCSSCacheKey(projectId: string, contentHash: string): string {
  return `${GLOBALS_CSS_PREFIX}:${projectId}:${contentHash}`;
}

// ============================================================================
// TAILWIND BASE CSS (Pre-warm on import)
// ============================================================================

/**
 * Fetch Tailwind base CSS with automatic pre-warming.
 * Uses a singleton promise to prevent duplicate fetches.
 */
async function getTailwindBaseCSS(): Promise<string> {
  if (tailwindBaseCSS) return tailwindBaseCSS;

  // Use singleton promise to prevent duplicate fetches
  if (!tailwindBaseCSSPromise) {
    tailwindBaseCSSPromise = fetchTailwindBaseCSS();
  }

  return tailwindBaseCSSPromise;
}

async function fetchTailwindBaseCSS(): Promise<string> {
  const startTime = performance.now();
  const url = getTailwindCSSUrl();

  try {
    logger.debug("[globals-compiler] Fetching Tailwind base CSS", { url });
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch Tailwind CSS: ${response.status}`);
    }

    tailwindBaseCSS = await response.text();
    const duration = performance.now() - startTime;

    logger.info("[globals-compiler] Pre-warmed Tailwind base CSS", {
      url,
      size: tailwindBaseCSS.length,
      durationMs: Math.round(duration),
    });

    return tailwindBaseCSS;
  } catch (error) {
    tailwindBaseCSSPromise = null; // Allow retry on failure
    throw error;
  }
}

// Pre-warm on module import (non-blocking)
getTailwindBaseCSS().catch((error) => {
  logger.warn("[globals-compiler] Pre-warm failed, will retry on demand", {
    error: error instanceof Error ? error.message : String(error),
  });
});

// ============================================================================
// PLUGIN LOADING
// ============================================================================

/**
 * Map plugin names to ESM CDN URLs
 */
function getPluginUrl(id: string): string {
  return `https://esm.sh/${id}`;
}

/**
 * Load a Tailwind plugin module from ESM CDN.
 * Cached globally since plugins are project-agnostic.
 */
async function loadPlugin(id: string): Promise<unknown> {
  if (pluginCache.has(id)) {
    return pluginCache.get(id);
  }

  const startTime = performance.now();

  try {
    const url = getPluginUrl(id);
    logger.debug("[globals-compiler] Loading plugin", { id, url });

    const mod = await import(url);
    const plugin = mod.default || mod;
    pluginCache.set(id, plugin);

    const duration = performance.now() - startTime;
    logger.debug("[globals-compiler] Plugin loaded", {
      id,
      durationMs: Math.round(duration),
    });

    return plugin;
  } catch (error) {
    logger.warn("[globals-compiler] Failed to load plugin", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return empty function as fallback
    const fallback = () => {};
    pluginCache.set(id, fallback);
    return fallback;
  }
}

// ============================================================================
// MAIN COMPILER
// ============================================================================

/**
 * Compile globals.css using Tailwind's programmatic API.
 *
 * This properly processes:
 * - @import "tailwindcss"
 * - @theme { ... }
 * - @utility { ... }
 * - @variant (both inline and block forms)
 * - @plugin (loads from ESM CDN)
 * - :root and [data-theme] CSS variables
 *
 * @param css - Raw globals.css content
 * @param projectId - Optional project ID for cache isolation (auto-detected if not provided)
 * @returns Compiled CSS ready for browser
 */
export async function compileGlobalsCSS(
  css: string,
  projectId?: string,
): Promise<string> {
  const startTime = performance.now();

  // Get project ID from context if not provided
  const effectiveProjectId = projectId || tryGetCacheKeyContext()?.projectId || "default";
  const contentHash = hashString(css);
  const cacheKey = buildGlobalsCSSCacheKey(effectiveProjectId, contentHash);

  // Check cache first
  const cached = compiledCache.get(cacheKey);
  if (cached) {
    metrics.cacheHits++;
    logger.debug("[globals-compiler] Cache hit", {
      projectId: effectiveProjectId,
      cacheKey,
    });
    return cached;
  }

  metrics.cacheMisses++;

  try {
    const tailwindBase = await getTailwindBaseCSS();

    const compiler = await compile(css, {
      base: "/",
      loadStylesheet: (id: string) => {
        if (id === "tailwindcss") {
          return Promise.resolve({ content: tailwindBase, base: "/", path: "/" });
        }
        logger.debug("[globals-compiler] Unknown stylesheet import", { id });
        return Promise.resolve({ content: "", base: "/", path: "/" });
      },
      loadModule: async (id: string) => {
        const plugin = await loadPlugin(id);
        // deno-lint-ignore no-explicit-any
        return { module: plugin as any, base: "/", path: "/" };
      },
    });

    // Build with empty class list - we just want the base CSS with theme variables
    // The actual utility classes are handled by the CDN at runtime
    const compiled = compiler.build([]);

    // Cache the result (project-isolated)
    compiledCache.set(cacheKey, compiled);

    // Update metrics
    const duration = performance.now() - startTime;
    metrics.totalCompilations++;
    metrics.totalCompileTimeMs += duration;
    metrics.avgCompileTimeMs = metrics.totalCompileTimeMs / metrics.totalCompilations;
    metrics.lastCompileTimeMs = duration;

    logger.info("[globals-compiler] Compiled globals.css", {
      projectId: effectiveProjectId,
      cacheKey,
      inputLength: css.length,
      outputLength: compiled.length,
      durationMs: Math.round(duration),
      cacheSize: compiledCache.size,
    });

    return compiled;
  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error("[globals-compiler] Compilation failed", {
      projectId: effectiveProjectId,
      durationMs: Math.round(duration),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear cache entries for a specific project.
 *
 * @param projectId - Project ID to clear cache for
 * @returns Number of entries cleared
 */
export function clearGlobalsCSSCache(projectId: string): number {
  let cleared = 0;
  const prefix = `${GLOBALS_CSS_PREFIX}:${projectId}:`;

  for (const key of [...compiledCache.keys()]) {
    if (key.startsWith(prefix)) {
      compiledCache.delete(key);
      cleared++;
    }
  }

  if (cleared > 0) {
    logger.info("[globals-compiler] Cleared cache for project", {
      projectId,
      entriesCleared: cleared,
    });
  }

  return cleared;
}

/**
 * Clear all cache entries.
 */
export function clearAllGlobalsCSSCache(): void {
  const size = compiledCache.size;
  compiledCache.clear();
  logger.info("[globals-compiler] Cleared all cache entries", {
    entriesCleared: size,
  });
}

/**
 * Get cache statistics.
 */
export function getGlobalsCSSCacheStats(): {
  compiledCacheSize: number;
  pluginCacheSize: number;
  tailwindBaseCSSCached: boolean;
} {
  return {
    compiledCacheSize: compiledCache.size,
    pluginCacheSize: pluginCache.size,
    tailwindBaseCSSCached: tailwindBaseCSS !== null,
  };
}
