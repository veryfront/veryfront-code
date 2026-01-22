/**
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 */

import { join } from "../platform/compat/path-helper.ts";
import { createFileSystem } from "../platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

// Re-export from route-params-extractor for backward compatibility
export { extractAppRouteParams, extractPagesRouteParams } from "./route-params-extractor.ts";

// Cache for router detection results - avoids repeated filesystem calls
// Key is projectDir, value is whether app router should be used
const routerDetectionCache = new Map<string, boolean>();

/**
 * Clear the router detection cache. Call when filesystem changes.
 * @deprecated Use clearRouterDetectionCacheForProject for multi-tenant deployments
 */
export function clearRouterDetectionCache(): void {
  routerDetectionCache.clear();
}

/**
 * Clear the router detection cache for a specific project.
 * Use this in multi-tenant deployments to avoid clearing other projects' caches.
 */
export function clearRouterDetectionCacheForProject(projectDir: string): void {
  routerDetectionCache.delete(projectDir);
}

/**
 * Detect if app router should be used based on config and directory structure
 */
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;

  const cached = routerDetectionCache.get(projectDir);
  if (cached !== undefined) return cached;

  const result = await detectAppRouterImpl(projectDir, config, adapter);
  routerDetectionCache.set(projectDir, result);
  return result;
}

/**
 * Internal implementation of router detection
 */
async function detectAppRouterImpl(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  // Check if app directory exists AND contains route files
  const appDirName = config?.directories?.app || "app";
  const pagesDirName = config?.directories?.pages || "pages";

  const appDir = join(projectDir, appDirName);
  const pagesDir = join(projectDir, pagesDirName);

  let hasAppRoutes = false;
  let hasPagesRoutes = false;

  const appStat = await statWithFallback(appDir, adapter);
  if (appStat?.isDirectory) {
    hasAppRoutes = await hasRouteFiles(appDir, adapter);
  }

  // Check for pages routes
  const pagesStat = await statWithFallback(pagesDir, adapter);
  if (pagesStat?.isDirectory) {
    hasPagesRoutes = await hasRouteFiles(pagesDir, adapter);
  }

  // If both have routes, prefer app router
  // If only one has routes, use that one
  if (hasAppRoutes) return true;
  if (hasPagesRoutes) return false;

  // If neither has routes, check which directory exists
  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  // If pages dir exists (even without routes), use pages router for legacy support
  // Otherwise default to app router (modern default)
  if (hasPagesDir && !hasAppDir) return false;
  return true; // Default to app router
}

const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_PATTERNS = ["page", "layout", "error", "loading", "not-found", "index"];

/**
 * Check if a directory contains route files
 */
async function hasRouteFiles(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const entries = await readDirWithFallback(dir, adapter);

  for (const entry of entries) {
    if (entry.isFile) {
      const name = entry.name.toLowerCase();
      const dotIndex = name.lastIndexOf(".");
      const ext = dotIndex === -1 ? "" : name.slice(dotIndex);
      const isRouteFile = ROUTE_EXTENSIONS.has(ext) &&
        ROUTE_PATTERNS.some((pattern) => name.startsWith(pattern));
      if (isRouteFile) return true;
    } else if (entry.isDirectory) {
      if (await hasRouteFiles(join(dir, entry.name), adapter)) return true;
    }
  }

  return false;
}

type NormalizedStat = {
  size?: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  mtime?: Date | null;
};

type NormalizedDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

/**
 * Execute an async operation with adapter, falling back to native fs on failure.
 */
async function withAdapterFallback<T>(
  adapterFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
  defaultValue: T,
): Promise<T> {
  try {
    return await adapterFn();
  } catch {
    try {
      return await fallbackFn();
    } catch {
      return defaultValue;
    }
  }
}

async function statWithFallback(
  path: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedStat | null> {
  const fs = createFileSystem();
  return await withAdapterFallback(
    async () => await adapter.fs.stat(path) as NormalizedStat,
    async () => {
      const stat = await fs.stat(path);
      return {
        size: stat.size,
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymlink: stat.isSymlink,
        mtime: stat.mtime,
      };
    },
    null,
  );
}

async function collectDirEntries(
  iterable: AsyncIterable<
    { name: string; isFile: boolean; isDirectory: boolean; isSymlink?: boolean }
  >,
): Promise<NormalizedDirEntry[]> {
  const entries: NormalizedDirEntry[] = [];
  for await (const entry of iterable) {
    entries.push({
      name: entry.name,
      isFile: entry.isFile,
      isDirectory: entry.isDirectory,
      isSymlink: entry.isSymlink ?? false,
    });
  }
  return entries;
}

async function readDirWithFallback(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedDirEntry[]> {
  const fs = createFileSystem();
  return await withAdapterFallback(
    () => collectDirEntries(adapter.fs.readDir(dir)),
    () => collectDirEntries(fs.readDir(dir)),
    [],
  );
}
