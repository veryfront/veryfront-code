/**
 * Local Project Discovery
 *
 * Handles discovery and caching of local project paths for the dev server.
 * Supports finding projects in standard directories (data/projects, projects, examples).
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

/** Cache of local adapters by project directory */
export const localAdapterCache = new LRUCache<string, RuntimeAdapter>({
  maxEntries: 50,
});

// Register cache for monitoring
registerLRUCache("local-adapter-cache", localAdapterCache);

/** Standard directories to search for local projects */
export const standardProjectDirs = ["data/projects", "projects", "examples"];

/** Cache of discovered local project paths by slug */
export const localProjectCache = new LRUCache<string, string>({
  maxEntries: 100,
});

// Register cache for monitoring
registerLRUCache("local-project-cache", localProjectCache);

async function isValidLocalProjectPath(path: string, adapter: RuntimeAdapter): Promise<boolean> {
  const stat = await adapter.fs.stat(path);
  if (!stat?.isDirectory) return false;

  const [hasApp, hasPages, hasComponents] = await Promise.all([
    adapter.fs.stat(`${path}/app`).then((s) => s?.isDirectory).catch(() => false),
    adapter.fs.stat(`${path}/pages`).then((s) => s?.isDirectory).catch(() => false),
    adapter.fs.stat(`${path}/components`).then((s) => s?.isDirectory).catch(() => false),
  ]);

  return hasApp || hasPages || hasComponents;
}

/**
 * Find the local filesystem path for a project by slug.
 *
 * @param slug - The project slug to find
 * @param adapter - The runtime adapter to use for filesystem operations
 * @param headerPath - Optional path from x-project-path header (takes precedence)
 * @returns The absolute path to the project, or undefined if not found
 */
export async function findLocalProjectPath(
  slug: string,
  adapter: RuntimeAdapter,
  headerPath?: string,
): Promise<string | undefined> {
  if (headerPath) {
    try {
      const normalizedPath = headerPath.trim();
      if (normalizedPath && await isValidLocalProjectPath(normalizedPath, adapter)) {
        const absolutePath = normalizedPath.startsWith("/")
          ? normalizedPath
          : `${cwd()}/${normalizedPath}`;
        localProjectCache.set(slug, absolutePath);
        return absolutePath;
      }
      logger.warn("Ignoring invalid x-project-path override", {
        slug,
        path: normalizedPath,
      });
    } catch {
      logger.warn("Failed to validate x-project-path override", {
        slug,
        path: headerPath,
      });
    }
  }

  const cached = localProjectCache.get(slug);
  if (cached) return cached;

  for (const dir of standardProjectDirs) {
    const projectPath = `${dir}/${slug}`;

    try {
      if (!await isValidLocalProjectPath(projectPath, adapter)) continue;

      const absolutePath = projectPath.startsWith("/") ? projectPath : `${cwd()}/${projectPath}`;
      localProjectCache.set(slug, absolutePath);
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
