/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/

import { join } from "../platform/compat/path-helper.ts";
import { createFileSystem } from "../platform/compat/fs.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

const routerDetectionCache = new LRUCache<string, boolean>({
  maxEntries: 200,
  ttlMs: 60_000,
});

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

  return await withSpan(
    SpanNames.ROUTER_DETECT_APP,
    async () => {
      const result = await detectAppRouterImpl(projectDir, config, adapter);
      routerDetectionCache.set(projectDir, result);
      return result;
    },
    {
      "router.project_dir": projectDir,
      "router.config_router": config?.router ?? "auto",
    },
  );
}

async function detectAppRouterImpl(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  const appDirName = config?.directories?.app ?? "app";
  const pagesDirName = config?.directories?.pages ?? "pages";

  const appDir = join(projectDir, appDirName);
  const pagesDir = join(projectDir, pagesDirName);

  const [appStat, pagesStat] = await Promise.all([
    statWithFallback(appDir, adapter),
    statWithFallback(pagesDir, adapter),
  ]);

  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  if (hasAppDir && (await hasRouteFiles(appDir, adapter, true))) return true;
  if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter, false))) return false;

  if (hasPagesDir && !hasAppDir) return false;
  return true;
}

const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_PATTERNS = ["page", "layout", "error", "loading", "not-found", "index"];
// Files to ignore in Pages Router (special files that aren't routes)
const PAGES_IGNORED_FILES = new Set(["_app", "_document", "_error", "api"]);

/**
 * Check if a directory contains route files.
 * @param dir - Directory to check
 * @param adapter - Runtime adapter
 * @param strictPatterns - If true, require App Router patterns (page.*, layout.*, etc.).
 *                         If false, accept any file with route extension (for Pages Router).
 */
async function hasRouteFiles(
  dir: string,
  adapter: RuntimeAdapter,
  strictPatterns = true,
): Promise<boolean> {
  const entries = await readDirWithFallback(dir, adapter);

  for (const entry of entries) {
    if (entry.isFile) {
      const name = entry.name.toLowerCase();
      const dotIndex = name.lastIndexOf(".");
      const baseName = dotIndex === -1 ? name : name.slice(0, dotIndex);
      const ext = dotIndex === -1 ? "" : name.slice(dotIndex);

      if (!ROUTE_EXTENSIONS.has(ext)) continue;

      if (strictPatterns) {
        // App Router: require specific patterns (page.tsx, layout.tsx, etc.)
        if (ROUTE_PATTERNS.some((pattern) => name.startsWith(pattern))) {
          return true;
        }
      } else {
        // Pages Router: any file with route extension counts (except special files)
        if (!PAGES_IGNORED_FILES.has(baseName) && !baseName.startsWith("_")) {
          return true;
        }
      }

      continue;
    }

    if (entry.isDirectory && entry.name !== "api") {
      if (await hasRouteFiles(join(dir, entry.name), adapter, strictPatterns)) {
        return true;
      }
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
    async () => (await adapter.fs.stat(path)) as NormalizedStat,
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
  iterable: AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }>,
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
