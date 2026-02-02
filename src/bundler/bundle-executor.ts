/**
 * Bundle Executor
 *
 * Executes pre-built bundles in an isolated module context for SSR.
 * This module provides the runtime environment for executing bundled
 * project code with proper React integration and error handling.
 *
 * ## React Instance Consistency
 *
 * JIT bundles include React directly (not external), making them self-contained.
 * This ensures blob URL execution works without bare import resolution issues.
 *
 * @module bundler/bundle-executor
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";

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
}

/**
 * Module cache to avoid re-evaluating the same bundle multiple times
 */
const moduleCache = new Map<string, BundleModule>();
const MAX_CACHE_SIZE = 100;

/**
 * Execute a bundled JavaScript module and return its exports.
 *
 * The bundle is expected to be a self-contained ES module with all
 * dependencies (including React) bundled directly.
 */
export async function executeBundle(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<BundleModule> {
  const { projectId, globals: _globals = {}, timeoutMs = 10000 } = options;

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

      // JIT bundles include React directly (externalizeReact: false),
      // so no import rewriting is needed - bundles are self-contained.
      const blob = new Blob([code], { type: "application/javascript" });
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
 * Result of executing a bundle for rendering.
 *
 * JIT bundles export:
 * - `default`: The page component
 * - `React`: The bundled React library (to avoid "two Reacts" problem)
 * - `renderToString`: The bundled renderToString function
 */
export interface BundleRenderExports {
  /** The page component (default export) */
  Component?: unknown;
  /** Bundled React library - use this for createElement to avoid instance mismatch */
  React?: typeof import("react");
  /** Bundled renderToString - use this for SSR */
  renderToString?: (element: unknown) => string;
  /** Raw module for accessing other exports */
  module: BundleModule;
}

/**
 * Execute a bundle and extract the component and bundled React.
 *
 * JIT bundles include React directly to avoid the "two Reacts" problem.
 * The bundled React is exported so callers can use the same instance
 * for createElement and renderToString.
 */
export async function executeBundleForRender(
  code: string,
  cacheKey: string,
  options: ExecuteOptions,
): Promise<BundleRenderExports> {
  const module = await executeBundle(code, cacheKey, options);

  const result: BundleRenderExports = { module };

  // Extract the page component (default export)
  if (module.default !== undefined) {
    result.Component = module.default;
  }

  // Extract bundled React (avoids "two Reacts" problem)
  if (module.React && typeof module.React === "object") {
    result.React = module.React as typeof import("react");
  }

  // Extract bundled renderToString
  if (typeof module.renderToString === "function") {
    result.renderToString = module.renderToString as (element: unknown) => string;
  }

  return result;
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
