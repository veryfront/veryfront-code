import { registerLRUCache } from "#veryfront/cache";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";

interface LocalProjectFileSystem {
  exists(path: string): Promise<boolean> | boolean;
}

interface LocalProjectLogger {
  debug(message: string, extra?: Record<string, unknown>): void;
}

export interface LocalProjectResolverOptions {
  localProjects?: Record<string, string>;
  fs?: LocalProjectFileSystem;
  basePath?: () => string;
  logger?: LocalProjectLogger;
}

export interface LocalProjectResolver {
  find(slug: string): Promise<string | undefined>;
}

const MAX_LOCAL_PROJECT_SLUG_LENGTH = 128;

function isSafeDynamicProjectSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_LOCAL_PROJECT_SLUG_LENGTH && slug !== "." &&
    slug !== ".." && !slug.includes("/") && !slug.includes("\\") && !slug.includes("\0");
}

function snapshotLocalProjects(input: Record<string, string> | undefined): Map<string, string> {
  const projects = new Map<string, string>();
  if (!input) return projects;

  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    throw new TypeError("Local project mappings must be a plain data record");
  }

  for (const [slug, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get || descriptor.set || typeof descriptor.value !== "string") {
      throw new TypeError("Local project mappings must contain only string data properties");
    }
    if (!descriptor.value) {
      throw new TypeError("Local project paths must not be empty");
    }
    projects.set(slug, descriptor.value);
  }
  return projects;
}

/**
 * Bounded cache for project paths discovered dynamically at request time
 * (slug -> absolute path). Configured `localProjects` are never written here,
 * so `ProxyHandler.localProjects` continues to expose only configured projects.
 */
const discoveredLocalProjects = new LRUCache<string, string>({ maxEntries: 100 });
registerLRUCache("proxy-discovered-local-projects", discoveredLocalProjects);

export function createLocalProjectResolver(
  options: LocalProjectResolverOptions,
): LocalProjectResolver {
  const localProjects = snapshotLocalProjects(options.localProjects);
  const fs = options.fs ?? createFileSystem();
  const getBasePath = options.basePath ?? cwd;
  const logger = options.logger;

  async function find(slug: string): Promise<string | undefined> {
    const mapped = localProjects.get(slug);
    if (mapped) return mapped;
    if (!isSafeDynamicProjectSlug(slug)) return undefined;

    const projectDirs = ["projects", "data/projects", "examples"];
    const basePath = getBasePath();
    // Key the discovery cache by the filesystem root as well as the slug: the
    // cache is process-wide, so the same slug can resolve to different paths
    // across handlers/workspaces or after a cwd change. Keying by basePath
    // prevents a stale entry from one root being proxied for another.
    const cacheKey = `${basePath}\0${slug}`;

    const cached = discoveredLocalProjects.get(cacheKey);
    if (cached) return cached;

    const candidatePaths = projectDirs.map((dir) => join(basePath, dir, slug));

    const existingPaths = await Promise.all(
      candidatePaths.map(async (projectPath) => {
        try {
          return (await fs.exists(projectPath)) ? projectPath : null;
        } catch (_) {
          return null;
        }
      }),
    );

    for (const projectPath of existingPaths) {
      if (!projectPath) continue;

      try {
        const [hasApp, hasPages, hasComponents, ...configMarkers] = await Promise.all([
          fs.exists(join(projectPath, "app")),
          fs.exists(join(projectPath, "pages")),
          fs.exists(join(projectPath, "components")),
          ...VERYFRONT_CONFIG_FILES.map((file) => fs.exists(join(projectPath, file))),
        ]);

        if (!hasApp && !hasPages && !hasComponents && !configMarkers.some(Boolean)) continue;

        discoveredLocalProjects.set(cacheKey, projectPath);
        logger?.debug("Dynamically discovered local project", { slug });
        return projectPath;
      } catch (_) {
        // expected: filesystem check may fail
      }
    }

    return undefined;
  }

  return { find };
}
