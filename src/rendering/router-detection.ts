/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/

import { isAbsolute, join } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";

const logger = rendererLogger.component("router-detection");

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

const ROUTER_DETECTION_CACHE_MAX_ENTRIES = 200;
const ROUTER_DETECTION_CACHE_TTL_MS = 60_000;

const routerDetectionCache = new LRUCache<string, boolean>({
  maxEntries: ROUTER_DETECTION_CACHE_MAX_ENTRIES,
  ttlMs: ROUTER_DETECTION_CACHE_TTL_MS,
});

let warnedMissingProjectId = false;

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

export function primeRouterDetectionCache(
  projectKey: string,
  mode: "app" | "pages",
): void {
  routerDetectionCache.set(projectKey, mode === "app");
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
  const cached = routerDetectionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (!options?.projectId && config?.fs?.type === "veryfront-api" && !warnedMissingProjectId) {
    warnedMissingProjectId = true;
    logger.warn(
      "detectAppRouter called without projectId in multi-tenant mode — cache key falls back to projectDir which may cause cross-tenant poisoning",
      { projectDir },
    );
  }

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

  if (!isSafeRouterDirectory(appDirName) || !isSafeRouterDirectory(pagesDirName)) {
    throw CONFIG_INVALID.create({
      detail: "Router directories must stay inside the project",
    });
  }

  const appDir = join(projectDir, appDirName);
  const pagesDir = join(projectDir, pagesDirName);

  const [appStat, pagesStat] = await Promise.all([
    statFromAdapter(appDir, adapter),
    statFromAdapter(pagesDir, adapter),
  ]);

  const hasAppDir = Boolean(appStat?.isDirectory);
  const hasPagesDir = Boolean(pagesStat?.isDirectory);

  if (hasAppDir && (await hasRouteFiles(appDir, adapter, new Set(), 0))) return true;
  if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter, new Set(), 0))) return false;

  if (hasPagesDir && !hasAppDir) return false;
  return true;
}

const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_PATTERNS = ["page", "layout", "error", "loading", "not-found", "index"];

const MAX_ROUTE_SCAN_DEPTH = 64;

async function hasRouteFiles(
  dir: string,
  adapter: RuntimeAdapter,
  visited: Set<string>,
  depth: number,
): Promise<boolean> {
  if (depth > MAX_ROUTE_SCAN_DEPTH || visited.has(dir)) return false;
  visited.add(dir);

  const entries = await readDirFromAdapter(dir, adapter);

  for (const entry of entries) {
    if (entry.isSymlink || !isSafeDirectoryEntryName(entry.name)) continue;

    if (entry.isFile) {
      const name = entry.name.toLowerCase();
      const dotIndex = name.lastIndexOf(".");
      const ext = dotIndex === -1 ? "" : name.slice(dotIndex);
      const stem = dotIndex === -1 ? name : name.slice(0, dotIndex);

      if (ROUTE_EXTENSIONS.has(ext) && ROUTE_PATTERNS.includes(stem)) {
        return true;
      }

      continue;
    }

    if (
      entry.isDirectory &&
      (await hasRouteFiles(join(dir, entry.name), adapter, visited, depth + 1))
    ) {
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

async function statFromAdapter(
  path: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedStat | null> {
  try {
    return (await adapter.fs.stat(path)) as NormalizedStat;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
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

async function readDirFromAdapter(
  dir: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedDirEntry[]> {
  try {
    return await collectDirEntries(adapter.fs.readDir(dir));
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

function isSafeRouterDirectory(path: string): boolean {
  return path !== "" && !path.includes("\0") && !path.includes("\\") &&
    !isAbsolute(path) && path.split("/").every((segment) => segment !== "" && segment !== "..");
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("\0") &&
    !name.includes("/") && !name.includes("\\");
}
