/**
 * Bundle Executor
 *
 * Executes pre-built bundles in an isolated module context for SSR.
 * This module provides the runtime environment for executing bundled
 * project code with proper React integration and error handling.
 *
 * ## Implementation Strategy
 *
 * Uses file-based dynamic imports instead of blob URLs for compiled binary
 * compatibility. Bundles are written to temp files and imported via file:// URLs.
 *
 * ## React Instance Consistency
 *
 * JIT bundles keep React external (esm.sh URLs) to ensure a single instance.
 *
 * @module bundler/bundle-executor
 */

import { logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { Span } from "@opentelemetry/api";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { joinPath } from "#veryfront/utils/path-utils.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";

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
 * Generate a unique filename for a bundle based on its cache key.
 */
function getBundleFilename(cacheKey: string): string {
  // Create a safe filename from the cache key
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50);
  const hash = simpleHash(cacheKey);
  return `bundle-${safeKey}-${hash}.mjs`;
}

function getBundleDir(): string {
  return joinPath(getHttpBundleCacheDir(), "jit-bundles");
}

function getBundlePath(cacheKey: string): string {
  return joinPath(getBundleDir(), getBundleFilename(cacheKey));
}

async function removeBundleFile(cacheKey: string): Promise<void> {
  const bundlePath = getBundlePath(cacheKey);
  try {
    await remove(bundlePath);
  } catch {
    // Ignore missing or locked files
  }
}

/**
 * Simple string hash for cache key uniqueness.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Execute a bundled JavaScript module and return its exports.
 *
 * Uses file-based dynamic imports for compiled binary compatibility.
 * Bundles are written to temp files and imported via file:// URLs.
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

      // Write bundle to a temp file for import
      // This works in both regular Deno and compiled binaries (unlike blob URLs)
      const bundleDir = getBundleDir();
      const bundleFilename = getBundleFilename(cacheKey);
      const bundlePath = joinPath(bundleDir, bundleFilename);
      const bundleUrl = `file://${bundlePath}`;

      try {
        // Ensure directory exists
        await mkdir(bundleDir, { recursive: true });

        // Write bundle to file
        await writeTextFile(bundlePath, code);

        span?.setAttribute("bundle.path", bundlePath);

        // Dynamic import with timeout
        const importPromise = import(bundleUrl);
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
            void removeBundleFile(firstKey);
          }

          moduleCache.set(cacheKey, module);

          logger.debug("[BundleExecutor] Bundle executed successfully", {
            projectId,
            cacheKey,
            hasDefault: "default" in module,
            exports: Object.keys(module).length,
            usedFileImport: true,
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
      }
      // Note: We keep the file for caching while the module stays in memory.
      // Files are removed when the module cache evicts or is cleared.
    },
    { "bundler.operation": "execute" },
  );
}

/**
 * Metadata returned by generateMetadata function
 */
export interface GeneratedMetadata {
  title?: string;
  description?: string;
  meta?: Array<{ name: string; content: string }>;
  [key: string]: unknown;
}

/**
 * Result of executing a bundle for rendering.
 *
 * JIT bundles export:
 * - `default`: The page component
 * - `React`: The shared React library (to avoid "two Reacts" problem)
 * - `renderToString`: The renderToString function (same React instance)
 * - `generateMetadata`: Optional function for dynamic metadata
 * - `headings`: Optional array of headings (MDX)
 */
export interface BundleRenderExports {
  /** The page component (default export) */
  Component?: unknown;
  /** Bundled React library - use this for createElement to avoid instance mismatch */
  React?: typeof import("react");
  /** Bundled renderToString - use this for SSR */
  renderToString?: (element: unknown) => string;
  /** Optional generateMetadata function for App Router dynamic metadata */
  generateMetadata?: (
    params?: Record<string, unknown>,
  ) => Promise<GeneratedMetadata> | GeneratedMetadata;
  /** Optional headings array from MDX */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** Raw module for accessing other exports */
  module: BundleModule;
}

/**
 * Execute a bundle and extract the component and shared React.
 *
 * JIT bundles export React from esm.sh to avoid the "two Reacts" problem.
 * The React export is used so callers can use the same instance
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

  // Extract shared React (avoids "two Reacts" problem)
  if (module.React && typeof module.React === "object") {
    result.React = module.React as typeof import("react");
  }

  // Extract bundled renderToString
  if (typeof module.renderToString === "function") {
    result.renderToString = module.renderToString as (element: unknown) => string;
  }

  // Extract generateMetadata for App Router dynamic metadata
  if (typeof module.generateMetadata === "function") {
    result.generateMetadata = module.generateMetadata as BundleRenderExports["generateMetadata"];
  }

  // Extract headings from MDX
  if (Array.isArray(module.headings)) {
    result.headings = module.headings as BundleRenderExports["headings"];
  }

  return result;
}

/**
 * Clear a specific cached module
 */
export function clearModuleCache(cacheKey: string): boolean {
  const deleted = moduleCache.delete(cacheKey);
  if (deleted) {
    void removeBundleFile(cacheKey);
  }
  return deleted;
}

/**
 * Clear all cached modules for a project
 */
export function clearProjectModules(projectId: string): number {
  let count = 0;
  for (const key of moduleCache.keys()) {
    if (key.startsWith(`${projectId}:`)) {
      moduleCache.delete(key);
      void removeBundleFile(key);
      count++;
    }
  }
  return count;
}

/**
 * Clear all cached modules
 */
export function clearAllModules(): void {
  for (const key of moduleCache.keys()) {
    void removeBundleFile(key);
  }
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
