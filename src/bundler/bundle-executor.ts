/**
 * Bundle Executor
 *
 * Executes pre-built bundles in an isolated module context for SSR.
 * This module provides the runtime environment for executing bundled
 * project code with proper React integration and error handling.
 *
 * ## React Instance Consistency
 *
 * New bundles are built with React imports resolved to file:// paths
 * at bundle time (via react-cache.ts). This ensures the bundled code
 * uses the same React instance as SSR without runtime URL rewriting.
 *
 * For backward compatibility with cached bundles that contain esm.sh URLs,
 * we still perform URL rewriting at execution time. This fallback handles:
 * - Bundles cached before the file:// path change
 * - Bundles built without pre-cached React paths
 *
 * @module bundler/bundle-executor
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { cacheModuleToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { getReactCDNMapping } from "./build-config.ts";

export interface BundleModule {
  /** Default export - typically the app component */
  default?: unknown;
  /** Named exports from the bundle */
  [key: string]: unknown;
}

export interface ExecuteOptions {
  /** Project identifier for logging */
  projectId: string;
  /** Global variables to inject into the bundle context */
  globals?: Record<string, unknown>;
  /** Timeout for execution in milliseconds */
  timeoutMs?: number;
  /** React version for import rewriting (default: 18.3.1) */
  reactVersion?: string;
}

/**
 * Module cache to avoid re-evaluating the same bundle multiple times
 */
const moduleCache = new Map<string, BundleModule>();
const MAX_CACHE_SIZE = 100;

/**
 * Cache for React URL to local file path mappings.
 * Once we cache React modules, we reuse the paths across executions.
 */
const reactPathCache = new Map<string, string>();

/**
 * Rewrite React imports in bundle code to use local file:// paths.
 *
 * This ensures the bundle uses the same React instance as SSR by:
 * 1. Caching all React esm.sh modules to local files
 * 2. Replacing esm.sh URLs in the bundle with file:// paths
 *
 * @param code - The bundle code with external React imports
 * @param reactVersion - React version to use
 * @returns The bundle code with file:// React imports
 */
async function rewriteReactImports(code: string, reactVersion: string): Promise<string> {
  const cacheDir = getHttpBundleCacheDir();
  const reactUrls = getReactCDNMapping(reactVersion);

  // Cache all React modules and collect URL -> file:// mappings
  const urlToPath: Record<string, string> = {};

  await Promise.all(
    Object.entries(reactUrls).map(async ([_pkg, url]) => {
      // Check if we already cached this URL
      if (reactPathCache.has(url)) {
        urlToPath[url] = reactPathCache.get(url)!;
        return;
      }

      try {
        const localPath = await cacheModuleToLocal(url, cacheDir);
        urlToPath[url] = localPath;
        reactPathCache.set(url, localPath);

        logger.debug("[BundleExecutor] Cached React module", {
          url: url.slice(0, 60) + "...",
          localPath: localPath.slice(0, 60) + "...",
        });
      } catch (error) {
        logger.warn("[BundleExecutor] Failed to cache React module, keeping original URL", {
          url,
          error: String(error),
        });
        // Keep original URL if caching fails
        urlToPath[url] = url;
      }
    }),
  );

  // Replace all esm.sh React URLs with file:// paths in the bundle
  let rewrittenCode = code;
  for (const [url, localPath] of Object.entries(urlToPath)) {
    if (localPath !== url) {
      // Escape special regex characters in URL
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rewrittenCode = rewrittenCode.replace(new RegExp(escapedUrl, "g"), localPath);
    }
  }

  logger.debug("[BundleExecutor] Rewrote React imports", {
    originalSize: code.length,
    rewrittenSize: rewrittenCode.length,
    urlsReplaced: Object.keys(urlToPath).length,
  });

  return rewrittenCode;
}

/**
 * Execute a bundled JavaScript module and return its exports.
 *
 * The bundle is expected to be an ES module that has been pre-built
 * with all dependencies resolved (except React, which is provided externally).
 */
export async function executeBundle(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<BundleModule> {
  const { projectId, globals: _globals = {}, timeoutMs = 10000, reactVersion = "18.3.1" } = options;

  return withSpan(
    "bundler.execute",
    async (span?: Span) => {
      span?.setAttributes({
        "project.id": projectId,
        "bundle.size": code.length,
        "cache.key": cacheKey,
      });

      // Check cache
      const cached = moduleCache.get(cacheKey);
      if (cached) {
        span?.setAttribute("cache.hit", true);
        return cached;
      }

      span?.setAttribute("cache.hit", false);

      // Rewrite React imports to use local file:// paths
      // This ensures the bundle uses the same React instance as SSR
      const rewrittenCode = await rewriteReactImports(code, reactVersion);
      span?.setAttribute("bundle.rewritten.size", rewrittenCode.length);

      // Create a blob URL for the module
      const blob = new Blob([rewrittenCode], { type: "application/javascript" });
      const blobUrl = URL.createObjectURL(blob);

      try {
        // Dynamic import with timeout
        const importPromise = import(blobUrl);
        let timeoutId: number | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Bundle execution timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ) as unknown as number;
        });

        try {
          const module = await Promise.race([importPromise, timeoutPromise]) as BundleModule;
          if (timeoutId !== undefined) clearTimeout(timeoutId);

          // Evict oldest cache entry if at capacity
          if (moduleCache.size >= MAX_CACHE_SIZE) {
            const firstKey = moduleCache.keys().next().value as string;
            moduleCache.delete(firstKey);
          }

          moduleCache.set(cacheKey, module);

          logger.debug("[BundleExecutor] Bundle executed successfully", {
            projectId,
            cacheKey,
            hasDefault: "default" in module,
            exports: Object.keys(module).length,
          });

          return module;
        } catch (error) {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          throw error;
        }
      } catch (error) {
        span?.setAttribute("error", true);
        span?.setAttribute("error.message", String(error));

        logger.error("[BundleExecutor] Bundle execution failed", {
          projectId,
          cacheKey,
          error: String(error),
        });

        throw error;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    },
    { "bundler.operation": "execute" },
  );
}

/**
 * Execute a bundle and extract the render function.
 *
 * Bundles are expected to export either:
 * 1. A `render` function directly
 * 2. A `default` export with a `render` method
 * 3. A React component as the default export
 */
export async function executeBundleForRender(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<{
  render?: (context: Record<string, unknown>) => Promise<string> | string;
  Component?: unknown;
  module: BundleModule;
}> {
  const module = await executeBundle(code, cacheKey, options);

  // Check for render function
  if (typeof module.render === "function") {
    return {
      render: module.render as (context: Record<string, unknown>) => Promise<string> | string,
      module,
    };
  }

  // Check for default export with render method
  const defaultExport = module.default;
  if (defaultExport && typeof defaultExport === "object" && "render" in defaultExport) {
    const renderMethod = (defaultExport as Record<string, unknown>).render;
    if (typeof renderMethod === "function") {
      return {
        render: renderMethod as (context: Record<string, unknown>) => Promise<string> | string,
        module,
      };
    }
  }

  // Return the default export as a Component
  return {
    Component: defaultExport,
    module,
  };
}

/**
 * Clear a specific cached module
 */
export function clearModuleCache(cacheKey: string): boolean {
  return moduleCache.delete(cacheKey);
}

/**
 * Clear all cached modules for a project
 */
export function clearProjectModules(projectId: string): number {
  let count = 0;
  for (const key of moduleCache.keys()) {
    if (key.startsWith(`${projectId}:`)) {
      moduleCache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Clear all cached modules
 */
export function clearAllModules(): void {
  moduleCache.clear();
}

/**
 * Get cache statistics
 */
export function getModuleCacheStats(): { size: number; maxSize: number } {
  return {
    size: moduleCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}
