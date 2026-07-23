/**
 * Local Project Discovery
 *
 * Handles discovery and caching of local project paths for the dev server.
 * Supports finding projects in standard directories (data/projects, projects).
 *
 * @module server/runtime-handler/local-project-discovery
 */

import { getBaseLogger } from "#veryfront/utils";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { canonicalizeLocalProjectSlug } from "./project-slug.ts";
import { isNotFoundError as isFilesystemNotFoundError } from "#veryfront/platform/compat/fs.ts";

export { canonicalizeLocalProjectSlug } from "./project-slug.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("runtime-handler");

/**
 * Injectable cache container for project discovery state.
 *
 * Wraps both the project-path cache (slug → absolute path) and the
 * adapter cache (project dir to RuntimeAdapter) so that callers, especially
 * tests, can supply an isolated instance instead of sharing global state.
 */
export class ProjectDiscoveryCache {
  /** Cache of discovered local project paths by slug */
  readonly projects: LRUCache<string, string>;
  /** Cache of local adapters by project directory */
  readonly adapters: LRUCache<string, RuntimeAdapter>;

  constructor(opts?: { maxProjects?: number; maxAdapters?: number }) {
    this.projects = new LRUCache<string, string>({
      maxEntries: opts?.maxProjects ?? 100,
    });
    this.adapters = new LRUCache<string, RuntimeAdapter>({
      maxEntries: opts?.maxAdapters ?? 50,
    });
  }

  /** Clear both caches */
  clear(): void {
    this.projects.clear();
    this.adapters.clear();
  }
}

/** Default module-level cache instance (backward-compatible singleton) */
export const defaultDiscoveryCache = new ProjectDiscoveryCache();

// Register the default caches for monitoring
registerLRUCache("local-project-cache", defaultDiscoveryCache.projects);
registerLRUCache("local-adapter-cache", defaultDiscoveryCache.adapters);

/** Standard directories to search for local projects */
export const standardProjectDirs = ["data/projects", "projects"];

function isStrictlyContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== "." && relativePath !== ".." &&
    !relativePath.startsWith("../") && !isAbsolute(relativePath);
}

async function resolveContainedProjectPath(
  projectRoot: string,
  projectPath: string,
  adapter: RuntimeAdapter,
): Promise<{ validationPath: string; cachePath: string } | undefined> {
  const absoluteRoot = resolve(cwd(), projectRoot);
  const absoluteProjectPath = resolve(absoluteRoot, projectPath);

  // Reject lexical traversal before touching the filesystem.
  if (!isStrictlyContainedPath(absoluteRoot, absoluteProjectPath)) return undefined;

  if (!adapter.fs.realPath) {
    return { validationPath: `${projectRoot}/${projectPath}`, cachePath: absoluteProjectPath };
  }

  const canonicalRoot = resolve(await adapter.fs.realPath(absoluteRoot));
  const canonicalProjectPath = resolve(await adapter.fs.realPath(absoluteProjectPath));
  if (!isStrictlyContainedPath(canonicalRoot, canonicalProjectPath)) return undefined;

  return { validationPath: canonicalProjectPath, cachePath: canonicalProjectPath };
}

function getErrorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(error.name)
    ? error.name
    : typeof error;
}

async function isValidLocalProjectPath(path: string, adapter: RuntimeAdapter): Promise<boolean> {
  try {
    const stat = await adapter.fs.stat(path);
    if (!stat?.isDirectory) return false;
  } catch (error) {
    // A missing directory is not a valid project path (expected for most lookups).
    if (isFilesystemNotFoundError(error)) return false;
    throw error; // Unexpected errors (permissions, I/O) propagate to caller
  }

  const checkDir = async (subPath: string): Promise<boolean> => {
    try {
      const s = await adapter.fs.stat(subPath);
      return s?.isDirectory ?? false;
    } catch (error) {
      if (isFilesystemNotFoundError(error)) return false;
      throw error;
    }
  };

  const checkFile = async (subPath: string): Promise<boolean> => {
    try {
      const s = await adapter.fs.stat(subPath);
      return s !== null && !s.isDirectory;
    } catch (error) {
      if (isFilesystemNotFoundError(error)) return false;
      throw error;
    }
  };

  const [hasApp, hasPages, hasComponents, ...configMarkers] = await Promise.all([
    checkDir(`${path}/app`),
    checkDir(`${path}/pages`),
    checkDir(`${path}/components`),
    ...VERYFRONT_CONFIG_FILES.map((file) => checkFile(`${path}/${file}`)),
  ]);

  return hasApp || hasPages || hasComponents || configMarkers.some(Boolean);
}

/**
 * Find the local filesystem path for a project by slug.
 *
 * @param slug - The project slug to find
 * @param adapter - The runtime adapter to use for filesystem operations
 * @param headerPath - Optional path from x-project-path header (takes precedence)
 * @param cache - Optional cache instance (defaults to module-level singleton)
 * @returns The absolute path to the project, or undefined if not found
 */
export async function findLocalProjectPath(
  slug: string,
  adapter: RuntimeAdapter,
  headerPath?: string,
  cache: ProjectDiscoveryCache = defaultDiscoveryCache,
): Promise<string | undefined> {
  const canonicalSlug = canonicalizeLocalProjectSlug(slug);
  if (!canonicalSlug) return undefined;

  if (headerPath) {
    try {
      const normalizedPath = headerPath.trim();
      if (normalizedPath) {
        const absolutePath = resolve(cwd(), normalizedPath);
        const canonicalPath = adapter.fs.realPath
          ? resolve(await adapter.fs.realPath(absolutePath))
          : absolutePath;
        if (await isValidLocalProjectPath(canonicalPath, adapter)) {
          cache.projects.set(canonicalSlug, canonicalPath);
          return canonicalPath;
        }
      }
      logger.warn("Ignoring invalid x-project-path override");
      return undefined;
    } catch (error) {
      if (isFilesystemNotFoundError(error)) {
        logger.warn("Ignoring missing x-project-path override");
        return undefined;
      }
      logger.warn("Failed to validate x-project-path override", {
        errorName: getErrorName(error),
      });
      throw error;
    }
  }

  const cached = cache.projects.get(canonicalSlug);
  if (cached) return cached;

  for (const dir of standardProjectDirs) {
    try {
      const resolvedPath = await resolveContainedProjectPath(dir, canonicalSlug, adapter);
      if (!resolvedPath) continue;
      if (!await isValidLocalProjectPath(resolvedPath.validationPath, adapter)) continue;

      cache.projects.set(canonicalSlug, resolvedPath.cachePath);
      logger.debug("Discovered local project");
      return resolvedPath.cachePath;
    } catch (error) {
      if (isFilesystemNotFoundError(error)) continue;
      logger.warn("Failed to validate local project directory", {
        errorName: getErrorName(error),
      });
      throw error;
    }
  }

  return undefined;
}
