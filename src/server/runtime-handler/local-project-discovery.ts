/**
 * Local Project Discovery
 *
 * Handles discovery and caching of local project paths for the dev server.
 * Supports finding projects in standard directories (data/projects, projects).
 *
 * @module server/runtime-handler/local-project-discovery
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("runtime-handler");

/**
 * Injectable cache container for project discovery state.
 *
 * Wraps both the project-path cache (slug → absolute path) and the
 * adapter cache (project dir → RuntimeAdapter) so that callers — especially
 * tests — can supply an isolated instance instead of sharing global state.
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

/**
 * @deprecated Use `defaultDiscoveryCache.adapters` instead.
 * Kept for backward compatibility with existing consumers.
 */
export const localAdapterCache = defaultDiscoveryCache.adapters;

/**
 * @deprecated Use `defaultDiscoveryCache.projects` instead.
 * Kept for backward compatibility with existing consumers.
 */
export const localProjectCache = defaultDiscoveryCache.projects;

/** Standard directories to search for local projects */
export const standardProjectDirs = ["data/projects", "projects"];

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return msg.includes("ENOENT") || msg.includes("No such file") || msg.includes("not found") ||
    msg.includes("No request context available") ||
    (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function isValidLocalProjectPath(path: string, adapter: RuntimeAdapter): Promise<boolean> {
  try {
    const stat = await adapter.fs.stat(path);
    if (!stat?.isDirectory) return false;
  } catch (error) {
    // Directory doesn't exist — not a valid project path (expected for most lookups)
    if (isNotFoundError(error)) return false;
    throw error; // Unexpected errors (permissions, I/O) propagate to caller
  }

  const checkDir = async (subPath: string): Promise<boolean> => {
    try {
      const s = await adapter.fs.stat(subPath);
      return s?.isDirectory ?? false;
    } catch {
      return false;
    }
  };

  const [hasApp, hasPages, hasComponents] = await Promise.all([
    checkDir(`${path}/app`),
    checkDir(`${path}/pages`),
    checkDir(`${path}/components`),
  ]);

  return hasApp || hasPages || hasComponents;
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
  if (headerPath) {
    try {
      const normalizedPath = headerPath.trim();
      if (normalizedPath && await isValidLocalProjectPath(normalizedPath, adapter)) {
        const absolutePath = normalizedPath.startsWith("/")
          ? normalizedPath
          : `${cwd()}/${normalizedPath}`;
        cache.projects.set(slug, absolutePath);
        return absolutePath;
      }
      logger.warn("Ignoring invalid x-project-path override", {
        slug,
        path: normalizedPath,
      });
    } catch (error) {
      logger.warn("Failed to validate x-project-path override", {
        error,
        slug,
        path: headerPath,
      });
    }
  }

  const cached = cache.projects.get(slug);
  if (cached) return cached;

  for (const dir of standardProjectDirs) {
    const projectPath = `${dir}/${slug}`;

    try {
      if (!await isValidLocalProjectPath(projectPath, adapter)) continue;

      const absolutePath = projectPath.startsWith("/") ? projectPath : `${cwd()}/${projectPath}`;
      cache.projects.set(slug, absolutePath);
      logger.debug("Discovered local project", { slug, path: absolutePath });
      return absolutePath;
    } catch (error) {
      logger.warn("Failed to validate local project directory", {
        slug,
        path: projectPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return undefined;
}
