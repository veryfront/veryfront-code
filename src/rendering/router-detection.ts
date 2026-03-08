/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/

import { join } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

const logger = rendererLogger.component("router-detection");

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

const ROUTER_DETECTION_CACHE_MAX_ENTRIES = 200;
const ROUTER_DETECTION_CACHE_TTL_MS = 60_000;

const routerDetectionCache = new LRUCache<string, boolean>({
  maxEntries: ROUTER_DETECTION_CACHE_MAX_ENTRIES,
  ttlMs: ROUTER_DETECTION_CACHE_TTL_MS,
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
 *
 * @param projectId - The project ID used as cache key. Falls back to projectDir for local dev.
 */
export function clearRouterDetectionCacheForProject(projectId: string): void {
  routerDetectionCache.delete(projectId);
}

export interface DetectAppRouterOptions {
  /** Project ID for cache isolation in multi-tenant deployments */
  projectId?: string;
}

/**
 * Detect if app router should be used based on config and directory structure.
 *
 * In multi-tenant proxy mode, `projectDir` is the same for all projects ("/app"),
 * so the cache key must use `projectId` to avoid cross-project cache poisoning.
 */
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
  options?: DetectAppRouterOptions,
): Promise<boolean> {
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;

  const cacheKey = options?.projectId ?? projectDir;

  if (!options?.projectId && config?.fs?.type === "veryfront-api") {
    logger.warn(
      "detectAppRouter called without projectId in multi-tenant mode — cache key falls back to projectDir which may cause cross-tenant poisoning",
      { projectDir },
    );
  }

  const cached = routerDetectionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  return await withSpan(
    SpanNames.ROUTER_DETECT_APP,
    async () => {
      const result = await detectAppRouterImpl(projectDir, config, adapter);
      routerDetectionCache.set(cacheKey, result);
      return result;
    },
    {
      "router.project_dir": projectDir,
      "router.cache_key": cacheKey,
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

  if (hasAppDir && (await hasRouteFiles(appDir, adapter))) return true;
  if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter))) return false;

  if (hasPagesDir && !hasAppDir) return false;
  return true;
}

const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_PATTERNS = ["page", "layout", "error", "loading", "not-found", "index"];

async function hasRouteFiles(dir: string, adapter: RuntimeAdapter): Promise<boolean> {
  const entries = await readDirWithFallback(dir, adapter);

  for (const entry of entries) {
    if (entry.isFile) {
      const name = entry.name.toLowerCase();
      const dotIndex = name.lastIndexOf(".");
      const ext = dotIndex === -1 ? "" : name.slice(dotIndex);

      if (ROUTE_EXTENSIONS.has(ext) && ROUTE_PATTERNS.some((pattern) => name.startsWith(pattern))) {
        return true;
      }

      continue;
    }

    if (entry.isDirectory && (await hasRouteFiles(join(dir, entry.name), adapter))) {
      return true;
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
  } catch (_) {
    /* expected: adapter may not support this operation */
    try {
      return await fallbackFn();
    } catch (_) {
      /* expected: fallback may also fail */
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
