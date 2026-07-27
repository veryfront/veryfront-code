/**************************
 * Router Detection
 *
 * Determines whether to use App Router or Pages Router based on:
 * - Explicit configuration (config.router)
 * - Directory structure analysis
 * - Route file presence detection
 **************************/

import { basename, dirname, isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { normalizeProjectRelativeDiscoveryPath } from "#veryfront/utils/discovery-path-policy.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";
import { DYNAMIC_ROUTE_ERROR } from "#veryfront/errors";

const logger = rendererLogger.component("router-detection");

// Re-export from app-route-resolver for backward compatibility
export { getAppRouteEntity } from "./app-route-resolver.ts";

const ROUTER_DETECTION_CACHE_MAX_ENTRIES = 200;
const ROUTER_DETECTION_CACHE_TTL_MS = 60_000;
const MAX_ROUTE_DETECTION_DIRECTORIES = 1_024;
const MAX_ROUTE_DETECTION_ENTRIES = 100_000;
const MAX_DIRECTORY_ENTRIES = 10_000;

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
  for (const cacheKey of routerDetectionCache.keys()) {
    if (routerCacheKeyBelongsToScope(cacheKey, projectId)) {
      routerDetectionCache.delete(cacheKey);
    }
  }
}

export function primeRouterDetectionCache(
  projectKey: string,
  mode: "app" | "pages",
  config: VeryfrontConfig = {},
): void {
  const directories = resolveRouterDirectories(config);
  routerDetectionCache.set(
    createRouterCacheKey(projectKey, directories),
    mode === "app",
  );
}

export interface DetectAppRouterOptions {
  /** Project ID for cache isolation in multi-tenant deployments */
  projectId?: string;
}

function isPathInside(path: string, directory: string): boolean {
  const relativePath = relative(directory, path).replaceAll("\\", "/");
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !isAbsolute(relativePath));
}

function resolveProjectPath(projectDir: string, path: string): string {
  return normalize(isAbsolute(path) ? path : join(projectDir, path));
}

/**
 * Normalize a configured router root while preserving "." as the explicit
 * project-root convention.
 */
export function normalizeRouterDirectoryName(
  value: unknown,
  fallback: string,
): string {
  const candidate = value ?? fallback;
  return candidate === "." ? "." : normalizeProjectRelativeDiscoveryPath(candidate);
}

type RouterDirectories = {
  app: string;
  pages: string;
};

function resolveRouterDirectories(config: VeryfrontConfig): RouterDirectories {
  return {
    app: normalizeRouterDirectoryName(config.directories?.app, "app"),
    pages: normalizeRouterDirectoryName(config.directories?.pages, "pages"),
  };
}

function createRouterCacheKey(
  scope: string,
  directories: RouterDirectories,
): string {
  return JSON.stringify([scope, directories.app, directories.pages]);
}

function routerCacheKeyBelongsToScope(cacheKey: string, scope: string): boolean {
  try {
    const value: unknown = JSON.parse(cacheKey);
    return Array.isArray(value) && value.length === 3 && value[0] === scope;
  } catch {
    return false;
  }
}

/**
 * Resolve the router that owns an already-resolved page.
 *
 * Auto-detection decides which router to try first, but mixed projects can
 * legitimately fall back to the other router. Per-page rendering must follow
 * the route that actually resolved instead of the project-wide preference.
 *
 * Pages routes can also resolve from the project root. App routes cannot
 * resolve outside their configured root, so an unmatched resolved path belongs
 * to the Pages router.
 */
export function resolveRouterModeForPage(
  projectDir: string,
  pagePath: string,
  config: VeryfrontConfig,
): "app" | "pages" {
  if (config.router === "app") return "app";
  if (config.router === "pages") return "pages";

  const resolvedPagePath = resolveProjectPath(projectDir, pagePath);
  const appRoot = resolveProjectPath(
    projectDir,
    normalizeRouterDirectoryName(config.directories?.app, "app"),
  );
  const pagesRoot = resolveProjectPath(
    projectDir,
    normalizeRouterDirectoryName(config.directories?.pages, "pages"),
  );

  const isAppRoute = isPathInside(resolvedPagePath, appRoot);
  const isPagesRoute = isPathInside(resolvedPagePath, pagesRoot);

  if (isAppRoute && isPagesRoute) {
    const appDistance = relative(appRoot, resolvedPagePath).split(/[\\/]/).filter(Boolean).length;
    const pagesDistance =
      relative(pagesRoot, resolvedPagePath).split(/[\\/]/).filter(Boolean).length;
    return pagesDistance < appDistance ? "pages" : "app";
  }

  if (isAppRoute) return "app";
  return "pages";
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
  const directories = resolveRouterDirectories(config);
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;

  const cacheScope = options?.projectId ?? projectDir;
  const cacheKey = createRouterCacheKey(cacheScope, directories);
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
      const result = await detectAppRouterImpl(
        projectDir,
        adapter,
        directories,
      );
      routerDetectionCache.set(cacheKey, result);
      return result;
    },
    {
      "router.project_dir": projectDir,
      "router.cache_key": cacheScope,
      "router.config_router": config?.router ?? "auto",
    },
  );
}

async function detectAppRouterImpl(
  projectDir: string,
  adapter: RuntimeAdapter,
  directories: RouterDirectories,
): Promise<boolean> {
  const appDir = normalize(join(projectDir, directories.app));
  const pagesDir = normalize(join(projectDir, directories.pages));

  const [hasAppDir, hasPagesDir] = await Promise.all([
    directoryExists(appDir, projectDir, adapter),
    directoryExists(pagesDir, projectDir, adapter),
  ]);

  if (hasAppDir && (await hasRouteFiles(appDir, adapter, "app"))) return true;
  if (hasPagesDir && (await hasRouteFiles(pagesDir, adapter, "pages"))) return false;

  if (hasPagesDir && !hasAppDir) return false;
  return true;
}

const ROUTE_EXTENSIONS = new Set([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const ROUTE_FILE_STEMS = new Set(["page", "layout", "error", "loading", "not-found", "index"]);

type RouteTraversalState = {
  directoriesVisited: number;
  entriesInspected: number;
  visited: Set<string>;
};

function isSafeDirectoryEntryName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PATH_LENGTH_CHARS &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !containsPathControlCharacters(name);
}

function isRouteFile(name: string, routerKind: "app" | "pages"): boolean {
  const lowerName = name.toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  if (dotIndex <= 0) return false;

  if (!ROUTE_EXTENSIONS.has(lowerName.slice(dotIndex))) return false;
  return routerKind === "pages" || ROUTE_FILE_STEMS.has(lowerName.slice(0, dotIndex));
}

async function resolveTraversalKey(
  dir: string,
  adapter: RuntimeAdapter,
  requireCanonicalPath: boolean,
): Promise<string | null> {
  if (!adapter.fs.realPath) {
    return requireCanonicalPath ? null : normalize(dir);
  }

  try {
    return normalize(await adapter.fs.realPath(dir));
  } catch (_) {
    /* expected: virtual adapters may not resolve physical paths */
    return requireCanonicalPath ? null : normalize(dir);
  }
}

async function hasRouteFiles(
  dir: string,
  adapter: RuntimeAdapter,
  routerKind: "app" | "pages",
  state: RouteTraversalState = {
    directoriesVisited: 0,
    entriesInspected: 0,
    visited: new Set(),
  },
  requireCanonicalPath = false,
): Promise<boolean> {
  const traversalKey = await resolveTraversalKey(dir, adapter, requireCanonicalPath);
  if (traversalKey === null || state.visited.has(traversalKey)) return false;
  state.visited.add(traversalKey);
  state.directoriesVisited += 1;
  if (state.directoriesVisited > MAX_ROUTE_DETECTION_DIRECTORIES) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: `Router detection exceeds the ${MAX_ROUTE_DETECTION_DIRECTORIES}-directory limit`,
    });
  }

  const entries = await readDirWithFallback(dir, adapter);
  state.entriesInspected += entries.length;
  if (state.entriesInspected > MAX_ROUTE_DETECTION_ENTRIES) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: `Router detection exceeds the ${MAX_ROUTE_DETECTION_ENTRIES}-entry limit`,
    });
  }

  for (const entry of entries) {
    if (!isSafeDirectoryEntryName(entry.name)) continue;

    if (entry.isFile) {
      if (isRouteFile(entry.name, routerKind)) return true;
      continue;
    }

    if (
      entry.isDirectory &&
      !entry.isSymlink &&
      (await hasRouteFiles(join(dir, entry.name), adapter, routerKind, state))
    ) {
      return true;
    }

    if (
      entry.isSymlink &&
      (await hasRouteFiles(join(dir, entry.name), adapter, routerKind, state, true))
    ) {
      return true;
    }
  }

  return false;
}

type NormalizedDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

type NormalizedStat = {
  size?: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  mtime?: Date | null;
};

async function withAdapterFallback<T>(
  adapter: RuntimeAdapter,
  adapterFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
  defaultValue: T,
): Promise<T> {
  try {
    return await adapterFn();
  } catch (adapterError) {
    if (!canUseHostFilesystemFallback(adapter)) {
      if (isNotFoundError(adapterError)) return defaultValue;
      throw adapterError;
    }

    try {
      return await fallbackFn();
    } catch (fallbackError) {
      if (isNotFoundError(fallbackError)) return defaultValue;
      throw fallbackError;
    }
  }
}

function canUseHostFilesystemFallback(adapter: RuntimeAdapter): boolean {
  return (adapter.id === "node" || adapter.id === "deno" || adapter.id === "bun") &&
    !isVirtualFilesystem(adapter.fs);
}

async function directoryExists(
  path: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (normalize(path) === normalize(projectDir)) return true;

  const parentEntries = await readDirWithFallback(dirname(path), adapter);
  const directoryName = basename(path);
  const listed = parentEntries.some((entry) =>
    entry.name === directoryName && (entry.isDirectory || entry.isSymlink)
  );
  if (listed || adapter.id !== "cloudflare") return listed;

  // Cloudflare KV represents directories only as key prefixes, so its parent
  // listing can omit a directory that stat can still resolve.
  return Boolean((await statWithFallback(path, adapter))?.isDirectory);
}

async function statWithFallback(
  path: string,
  adapter: RuntimeAdapter,
): Promise<NormalizedStat | null> {
  const fs = createFileSystem();

  return await withAdapterFallback(
    adapter,
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
  iterable: AsyncIterable<unknown>,
): Promise<NormalizedDirEntry[]> {
  const entries: NormalizedDirEntry[] = [];

  for await (const value of iterable) {
    if (entries.length >= MAX_DIRECTORY_ENTRIES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Router directory listing exceeds the ${MAX_DIRECTORY_ENTRIES}-entry limit`,
      });
    }
    if (typeof value !== "object" || value === null) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: "Router filesystem adapter returned an invalid directory entry",
      });
    }
    const entry = value as Partial<NormalizedDirEntry>;
    if (
      typeof entry.name !== "string" ||
      typeof entry.isFile !== "boolean" ||
      typeof entry.isDirectory !== "boolean" ||
      (entry.isSymlink !== undefined && typeof entry.isSymlink !== "boolean")
    ) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: "Router filesystem adapter returned an invalid directory entry",
      });
    }
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
    adapter,
    () => collectDirEntries(adapter.fs.readDir(dir)),
    () => collectDirEntries(fs.readDir(dir)),
    [],
  );
}
