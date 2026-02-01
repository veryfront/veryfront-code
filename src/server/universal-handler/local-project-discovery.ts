/**
 * Local Project Discovery
 *
 * Handles discovery and caching of local project paths for the dev server.
 * Supports finding projects in standard directories (data/projects, projects, examples).
 *
 * @module server/universal-handler/local-project-discovery
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

const logger = getBaseLogger("SERVER");

/** Cache of local adapters by project directory */
export const localAdapterCache = new Map<string, RuntimeAdapter>();

/** Standard directories to search for local projects */
export const standardProjectDirs = ["data/projects", "projects", "examples"];

/** Cache of discovered local project paths by slug */
export const localProjectCache = new Map<string, string>();

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
    localProjectCache.set(slug, headerPath);
    return headerPath;
  }

  const cached = localProjectCache.get(slug);
  if (cached) return cached;

  for (const dir of standardProjectDirs) {
    const projectPath = `${dir}/${slug}`;

    try {
      const stat = await adapter.fs.stat(projectPath);
      if (!stat?.isDirectory) continue;

      const [hasApp, hasPages, hasComponents] = await Promise.all([
        adapter.fs.stat(`${projectPath}/app`).then((s) => s?.isDirectory).catch(() => false),
        adapter.fs.stat(`${projectPath}/pages`).then((s) => s?.isDirectory).catch(() => false),
        adapter.fs.stat(`${projectPath}/components`).then((s) => s?.isDirectory).catch(() => false),
      ]);

      if (!hasApp && !hasPages && !hasComponents) continue;

      const absolutePath = projectPath.startsWith("/") ? projectPath : `${cwd()}/${projectPath}`;
      localProjectCache.set(slug, absolutePath);
      logger.debug("[universal] Discovered local project", { slug, path: absolutePath });
      return absolutePath;
    } catch {
      // Directory doesn't exist, continue
    }
  }

  return undefined;
}
