import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isAbsolute, join, normalize } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { MAX_PROJECT_SLUG_CODE_UNITS } from "#veryfront/utils/constants/project-identity.ts";
import { getErrorMessage } from "#veryfront/errors";

const MAX_CONFIGURED_LOCAL_PROJECTS = 1_000;
const LOCAL_PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

interface LocalProjectFileSystem {
  exists(path: string): Promise<boolean> | boolean;
}

interface LocalProjectLogger {
  debug(message: string, extra?: Record<string, unknown>): void;
  warn?(message: string, extra?: Record<string, unknown>): void;
}

export interface LocalProjectResolverOptions {
  localProjects?: Record<string, string>;
  fs?: LocalProjectFileSystem;
  basePath?: () => string;
  logger?: LocalProjectLogger;
  allowDiscovery?: boolean;
}

export interface LocalProjectResolver {
  readonly localProjects: Readonly<Record<string, string>>;
  find(slug: string): Promise<string | undefined>;
  clear(): void;
}

function isCanonicalLocalProjectSlug(slug: string): boolean {
  return slug.length > 0 &&
    slug.length <= MAX_PROJECT_SLUG_CODE_UNITS &&
    LOCAL_PROJECT_SLUG_PATTERN.test(slug);
}

function snapshotConfiguredProjects(
  input: Record<string, string> | undefined,
): Readonly<Record<string, string>> {
  const result = Object.create(null) as Record<string, string>;
  if (!input) return Object.freeze(result);

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const entries = Object.entries(descriptors);
  if (entries.length > MAX_CONFIGURED_LOCAL_PROJECTS) {
    throw new RangeError(
      `Local project configuration cannot exceed ${MAX_CONFIGURED_LOCAL_PROJECTS} entries`,
    );
  }

  for (const [slug, descriptor] of entries) {
    if (!descriptor.enumerable) continue;
    const path = "value" in descriptor ? descriptor.value : undefined;
    if (
      !isCanonicalLocalProjectSlug(slug) ||
      typeof path !== "string" ||
      !isAbsolute(path) ||
      normalize(path) !== path
    ) {
      throw new TypeError(`Invalid configured local project entry: ${slug}`);
    }
    Object.defineProperty(result, slug, {
      configurable: false,
      enumerable: true,
      value: path,
      writable: false,
    });
  }
  return Object.freeze(result);
}

export function createLocalProjectResolver(
  options: LocalProjectResolverOptions,
): LocalProjectResolver {
  const localProjects = snapshotConfiguredProjects(options.localProjects);
  const fs = options.fs ?? createFileSystem();
  const getBasePath = options.basePath ?? cwd;
  const logger = options.logger;
  const allowDiscovery = options.allowDiscovery ?? true;
  const discoveredLocalProjects = new LRUCache<string, string>({ maxEntries: 100 });

  async function exists(path: string): Promise<boolean> {
    try {
      return await fs.exists(path);
    } catch (error) {
      logger?.warn?.("Local project discovery filesystem check failed", {
        path,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async function find(slug: string): Promise<string | undefined> {
    if (!isCanonicalLocalProjectSlug(slug)) return undefined;
    const mapped = Object.hasOwn(localProjects, slug) ? localProjects[slug] : undefined;
    if (mapped) return mapped;
    if (!allowDiscovery) return undefined;

    const projectDirs = ["projects", "data/projects", "examples"];
    const basePath = getBasePath();
    if (!isAbsolute(basePath) || normalize(basePath) !== basePath) {
      throw new TypeError("Local project discovery base path must be canonical and absolute");
    }
    const cacheKey = `${basePath}\0${slug}`;

    const cached = discoveredLocalProjects.get(cacheKey);
    if (cached) return cached;

    const candidatePaths = projectDirs.map((dir) => join(basePath, dir, slug));

    const existingPaths = await Promise.all(
      candidatePaths.map(async (projectPath) => (await exists(projectPath)) ? projectPath : null),
    );

    for (const projectPath of existingPaths) {
      if (!projectPath) continue;

      const [hasApp, hasPages, hasComponents, ...configMarkers] = await Promise.all([
        exists(join(projectPath, "app")),
        exists(join(projectPath, "pages")),
        exists(join(projectPath, "components")),
        ...VERYFRONT_CONFIG_FILES.map((file) => exists(join(projectPath, file))),
      ]);

      if (!hasApp && !hasPages && !hasComponents && !configMarkers.some(Boolean)) continue;

      discoveredLocalProjects.set(cacheKey, projectPath);
      logger?.debug("Dynamically discovered local project", { slug, projectPath });
      return projectPath;
    }

    return undefined;
  }

  return {
    localProjects,
    find,
    clear: () => discoveredLocalProjects.clear(),
  };
}
