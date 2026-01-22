/**
 * Module Fetcher
 *
 * Fetches and caches ESM modules for MDX rendering.
 * Handles direct file reads, HTTP fallback, and recursive dependency resolution.
 *
 * Features:
 * - Distributed transform cache for cross-pod sharing (Redis/API)
 * - Local filesystem cache for fast repeated access
 * - Parallel nested import resolution
 *
 * @module build/transforms/mdx/esm-module-loader/module-fetcher
 */

import { join, posix } from "#std/path.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import { transformToESM } from "../../../esm-transform.ts";
import { TRANSFORM_CACHE_VERSION } from "../../../esm/package-registry.ts";
import {
  LOG_PREFIX_MDX_LOADER,
  RELATIVE_IMPORT_PATTERN,
  UNRESOLVED_VF_MODULES_PATTERN,
  VF_MODULE_IMPORT_PATTERN,
} from "../constants.ts";
import type { ModuleFetcherContext, NestedImportResult } from "../types.ts";
import { getLocalFs, getModulePathCache, saveModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { createStubModule } from "../utils/stub-module.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import { recordSSRModules } from "../../../../modules/manifest/route-module-manifest.ts";

/**
 * Distributed transform cache for cross-pod sharing.
 * Caches transformed module code in Redis/API so other pods don't need to re-transform.
 */
let distributedTransformCache: CacheBackend | null | undefined;
const distributedCacheInit = new Singleflight<CacheBackend | null>();

/** TTL for cached transforms (24 hours) */
const TRANSFORM_CACHE_TTL_SECONDS = 86400;

function getDistributedTransformCache(): Promise<CacheBackend | null> {
  if (distributedTransformCache !== undefined) {
    return Promise.resolve(distributedTransformCache);
  }

  return distributedCacheInit.do("init", async () => {
    try {
      const { CacheBackends } = await import("#veryfront/cache/backend.ts");
      const backend = await CacheBackends.transform();
      // Only use distributed cache if API or Redis (not memory - that's per-process)
      if (backend.type === "memory") {
        distributedTransformCache = null;
        logger.debug(`${LOG_PREFIX_MDX_LOADER} No distributed transform cache (memory only)`);
        return null;
      }
      distributedTransformCache = backend;
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache initialized`, {
        type: backend.type,
      });
      return backend;
    } catch (error) {
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to init distributed transform cache`, {
        error,
      });
      distributedTransformCache = null;
      return null;
    }
  });
}

/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 */
function getTransformCacheKey(
  projectId: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return `v${TRANSFORM_CACHE_VERSION}:${projectId}:${normalizedPath}:${contentHash}`;
}

/**
 * Map veryfront/* bare specifiers to /_vf_modules/ paths for MDX module loading.
 * These need to be resolved to file paths because the cached .mjs files are
 * dynamically imported and don't have access to deno.json import maps.
 */
const VERYFRONT_IMPORT_MAP: Record<string, string> = {
  "veryfront/head": "/_vf_modules/react/components/Head.js",
  "veryfront/router": "/_vf_modules/react/router/index.js",
  "veryfront/context": "/_vf_modules/react/context/index.js",
  "veryfront/fonts": "/_vf_modules/react/fonts/index.js",
};

/**
 * Rewrite veryfront/* imports to /_vf_modules/ paths for MDX module loading.
 */
function rewriteVeryfrontImports(code: string): string {
  return code.replace(
    /from\s+["'](veryfront\/[^"']+)["']/g,
    (_match, specifier: string) => {
      const mapped = VERYFRONT_IMPORT_MAP[specifier];
      if (mapped) {
        return `from "${mapped}"`;
      }
      // For unmapped veryfront/* imports, keep as-is (will fail if not resolvable)
      return `from "${specifier}"`;
    },
  );
}

function getVersionedPathCacheKey(normalizedPath: string): string {
  return `v${TRANSFORM_CACHE_VERSION}:${normalizedPath}`;
}

/**
 * Render session state for module tracking.
 */
interface RenderSession {
  modules: Set<string>;
  projectSlug?: string;
  route?: string;
}

/**
 * Track modules loaded during current render for manifest recording.
 * Key: renderSessionId, Value: RenderSession
 */
const renderSessions = new Map<string, RenderSession>();

/**
 * Start a render session to track module loading.
 * Call this before rendering a page.
 */
export function startRenderSession(
  sessionId: string,
  projectSlug?: string,
  route?: string,
): void {
  renderSessions.set(sessionId, {
    modules: new Set(),
    projectSlug,
    route,
  });
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Started render session`, {
    sessionId,
    projectSlug,
    route,
  });
}

/**
 * End a render session and record loaded modules to the manifest.
 */
export function endRenderSession(sessionId: string): void {
  const session = renderSessions.get(sessionId);
  if (!session) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} End session called but no session found`, { sessionId });
    return;
  }

  const modulePaths = Array.from(session.modules);
  logger.debug(`${LOG_PREFIX_MDX_LOADER} End render session`, {
    sessionId,
    moduleCount: modulePaths.length,
    projectSlug: session.projectSlug,
    route: session.route,
    sampleModules: modulePaths.slice(0, 5),
  });

  // Record to manifest
  if (session.projectSlug !== undefined && session.route !== undefined) {
    if (modulePaths.length > 0) {
      recordSSRModules(session.projectSlug, session.route, modulePaths);
    }
  } else {
    // This is normal in local dev/tests where projectSlug isn't set
    // The manifest is an optimization for production, not required
    logger.debug(
      `${LOG_PREFIX_MDX_LOADER} Cannot record to manifest - missing projectSlug or route`,
      {
        projectSlug: session.projectSlug,
        route: session.route,
      },
    );
  }

  renderSessions.delete(sessionId);
}

/**
 * Get the current active render session (if any).
 * Used to record modules during fetch and for per-session in-flight deduplication.
 */
function getCurrentSession(): RenderSession | null {
  // Return the first session (there should only be one per request)
  const firstSession = renderSessions.values().next();
  return firstSession.done ? null : firstSession.value;
}

/**
 * Normalize a module path, resolving relative paths if a parent is provided.
 */
function normalizePath(modulePath: string, parentModulePath?: string): string {
  let normalizedPath = modulePath.replace(/^\//, "");

  // If it's a relative import and we have a parent, resolve it relative to parent
  if (parentModulePath && (modulePath.startsWith("./") || modulePath.startsWith("../"))) {
    // Get the directory of the parent module
    const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
    // Use posix.join and posix.normalize to properly resolve all ../ segments
    const joinedPath = posix.join(parentDir, modulePath);
    normalizedPath = posix.normalize(joinedPath);
    // Ensure it has _vf_modules prefix
    if (!normalizedPath.startsWith("_vf_modules/")) {
      normalizedPath = `_vf_modules/${normalizedPath}`;
    }
  }

  return normalizedPath;
}

/**
 * Find nested module imports in code.
 */
function findNestedImports(
  moduleCode: string,
): {
  vfModules: Array<{ original: string; path: string }>;
  relative: Array<{ original: string; path: string }>;
} {
  const vfModules: Array<{ original: string; path: string }> = [];
  const relative: Array<{ original: string; path: string }> = [];

  // Find /_vf_modules/ imports
  const vfPattern = new RegExp(VF_MODULE_IMPORT_PATTERN.source, "g");
  let match;
  while ((match = vfPattern.exec(moduleCode)) !== null) {
    if (match[1]) {
      vfModules.push({ original: match[0], path: match[1].replace(/^\//, "") });
    }
  }

  // Find relative imports
  const relativePattern = new RegExp(RELATIVE_IMPORT_PATTERN.source, "g");
  while ((match = relativePattern.exec(moduleCode)) !== null) {
    if (match[1]) {
      relative.push({ original: match[0], path: match[1] });
    }
  }

  return { vfModules, relative };
}

/**
 * Check for unresolved /_vf_modules/ imports.
 */
function hasUnresolvedImports(moduleCode: string): { count: number; paths: string[] } {
  const pattern = new RegExp(UNRESOLVED_VF_MODULES_PATTERN.source, "g");
  const matches = [...moduleCode.matchAll(pattern)];
  return {
    count: matches.length,
    paths: matches.map((m) => m[1]).filter((p): p is string => p !== undefined).slice(0, 5),
  };
}

/**
 * Process nested imports by replacing them with file:// paths or stub modules.
 */
async function processNestedImports(
  moduleCode: string,
  results: NestedImportResult[],
  esmCacheDir: string,
): Promise<string> {
  let result = moduleCode;

  for (const { original, nestedFilePath, nestedPath, relativePath } of results) {
    const modulePath = nestedPath || relativePath || "";

    if (nestedFilePath) {
      result = result.replace(original, `from "file://${nestedFilePath}"`);
    } else {
      // Create stub module for missing files
      const stubPath = await createStubModule(modulePath, result, original, esmCacheDir);
      if (stubPath) {
        result = result.replace(original, `from "file://${stubPath}"`);
      }
    }
  }

  return result;
}

/**
 * Write module to cache and return the cache path.
 */
async function cacheModule(
  normalizedPath: string,
  moduleCode: string,
  esmCacheDir: string,
  pathCache: Map<string, string>,
): Promise<string | null> {
  // Check for unresolved imports
  const unresolved = hasUnresolvedImports(moduleCode);
  if (unresolved.count > 0) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.count} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.paths },
    );
    return null;
  }

  // Use content-based cache key so unchanged files stay cached
  // Include transform version to invalidate on transform logic changes
  const contentHash = hashString(normalizedPath + moduleCode);
  const cachePath = join(esmCacheDir, `vfmod-v${TRANSFORM_CACHE_VERSION}-${contentHash}.mjs`);

  // Check if this exact content is already cached
  const localFs = getLocalFs();
  try {
    const stat = await localFs.stat(cachePath);
    if (stat?.isFile) {
      pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
      return cachePath;
    }
  } catch {
    // Not cached, write it
  }

  // Ensure cache directory exists before writing
  await localFs.mkdir(esmCacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
  await saveModulePathCache(esmCacheDir);
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);

  // Record this module to the current render session for manifest tracking
  const session = getCurrentSession();
  if (session) {
    // Normalize path to module URL format (e.g., "pages/index.js")
    const moduleUrlPath = normalizedPath
      .replace(/^_vf_modules\//, "")
      .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
    session.modules.add(moduleUrlPath);
  }

  return cachePath;
}

/**
 * Fetch module via HTTP as a fallback.
 */
async function fetchModuleViaHTTP(
  normalizedPath: string,
  adapter: RuntimeAdapter,
  fetchAndCacheModuleFn: (path: string, parent?: string) => Promise<string | null>,
  projectSlug?: string,
  isLocalDev?: boolean,
): Promise<string | null> {
  // In production environment, HTTP fallback to localhost won't work
  if (!isLocalDev) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`,
  );

  const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  // In multi-project mode, use project subdomain; otherwise use localhost
  const host = projectSlug ? `${projectSlug}.lvh.me` : "localhost";
  const moduleUrl = `http://${host}:${port}/${normalizedPath}?ssr=true`;

  const response = await fetch(moduleUrl);
  if (!response.ok) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`,
    );
    return null;
  }

  let moduleCode = await response.text();

  // Rewrite veryfront/* imports to /_vf_modules/ paths (in case HTTP response has bare specifiers)
  moduleCode = rewriteVeryfrontImports(moduleCode);

  // Find and recursively process nested imports
  const { vfModules, relative } = findNestedImports(moduleCode);

  // Process all nested imports in parallel (both vf_modules and relative)
  const allImports = [
    ...vfModules.map(({ original, path }) => ({ original, path, key: "nestedPath" as const })),
    ...relative.map(({ original, path }) => ({ original, path, key: "relativePath" as const })),
  ];

  const results = await Promise.all(
    allImports.map(async ({ original, path, key }) => {
      const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
      return { original, nestedFilePath, [key]: path };
    }),
  );

  for (const { original, nestedFilePath } of results) {
    if (nestedFilePath) {
      moduleCode = moduleCode.replace(original, `from "file://${nestedFilePath}"`);
    }
  }

  return moduleCode;
}

/**
 * Fetch and cache a module.
 * This is the main entry point for module fetching operations.
 */
export async function fetchAndCacheModule(
  modulePath: string,
  context: ModuleFetcherContext,
  parentModulePath?: string,
): Promise<string | null> {
  const normalizedPath = normalizePath(modulePath, parentModulePath);
  const projectSlug = context.projectSlug || "unknown";

  // NOTE: In-flight deduplication is DISABLED.
  // It caused deadlocks even within a single request because page + layout
  // modules are fetched in parallel and share state. Layout's Footer.js would
  // wait on page's Footer.js which was still processing nested imports.
  // The file cache handles deduplication anyway - parallel fetches write to same path.

  logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] START`, {
    projectSlug,
    modulePath,
    normalizedPath,
    parentModulePath,
  });

  // Recursive fetch function for nested imports
  const fetchAndCacheModuleFn = (path: string, parent?: string): Promise<string | null> => {
    return fetchAndCacheModule(path, context, parent);
  };

  // Now do the actual fetch
  const result = await (async (): Promise<string | null> => {
    const { esmCacheDir, adapter, projectDir, projectId, projectSlug } = context;

    // Check persistent module path cache first (per-pod filesystem cache).
    // NOTE: This cache uses path + version key (no content hash), but this is safe
    // because poke invalidation calls clearModulePathCache() which clears this cache.
    // The distributed transform cache (below) uses content hash for cross-pod sharing.
    const pathCache = await getModulePathCache(esmCacheDir);
    const versionedKey = getVersionedPathCacheKey(normalizedPath);
    const cachedPath = pathCache.get(versionedKey);
    if (cachedPath) {
      // Verify the file still exists
      try {
        const localFs = getLocalFs();
        const stat = await localFs.stat(cachedPath);
        if (stat?.isFile) {
          // Record to session even when returning from cache
          // This ensures manifest tracks all modules loaded per render
          const session = getCurrentSession();
          if (session) {
            const moduleUrlPath = normalizedPath
              .replace(/^_vf_modules\//, "")
              .replace(/\.(tsx|ts|jsx|mdx)$/, ".js");
            session.modules.add(moduleUrlPath);
          }
          return cachedPath;
        }
      } catch {
        // Cache entry is stale, remove it
        pathCache.delete(versionedKey);
      }
    }

    // Try to find and read the source file directly
    try {
      const resolved = await resolveModuleFile(normalizedPath, adapter, projectDir);

      if (!resolved) {
        // Fallback to HTTP fetch if direct file read fails
        const moduleCode = await fetchModuleViaHTTP(
          normalizedPath,
          adapter,
          fetchAndCacheModuleFn,
          projectSlug,
          context.isLocalDev,
        );
        if (moduleCode) {
          return await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache);
        }
        return null;
      }

      const { sourceCode, actualFilePath } = resolved;

      // Compute content hash for distributed cache key
      const contentHash = hashString(sourceCode);
      const transformCacheKey = getTransformCacheKey(projectId, normalizedPath, contentHash);

      // Check distributed transform cache first (cross-pod sharing)
      let moduleCode: string | null = null;
      const distributedCache = await getDistributedTransformCache();
      if (distributedCache) {
        try {
          const cached = await distributedCache.get(transformCacheKey);
          if (cached) {
            moduleCode = cached;
            logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache HIT`, {
              projectSlug,
              normalizedPath,
              cacheKey: transformCacheKey,
            });
          }
        } catch (error) {
          logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache get failed`, {
            normalizedPath,
            error,
          });
        }
      }

      // If not in distributed cache, transform the source code
      if (!moduleCode) {
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM START`, {
          projectSlug,
          normalizedPath,
          actualFilePath,
          sourceLength: sourceCode.length,
        });
        const transformStart = performance.now();
        try {
          moduleCode = await transformToESM(
            sourceCode,
            actualFilePath,
            projectDir,
            adapter as RuntimeAdapter,
            { projectId, dev: true, ssr: true },
          );
        } catch (transformError) {
          logger.error(`${LOG_PREFIX_MDX_LOADER} Transform failed for module`, {
            normalizedPath,
            actualFilePath,
            sourceLength: sourceCode.length,
            sourcePreview: sourceCode.slice(0, 200),
            error: transformError instanceof Error ? transformError.message : String(transformError),
          });
          throw transformError;
        }
        logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM DONE`, {
          projectSlug,
          normalizedPath,
          transformMs: (performance.now() - transformStart).toFixed(1),
          outputLength: moduleCode.length,
        });

        // Rewrite veryfront/* imports to /_vf_modules/ paths so they can be resolved
        // This is needed because cached .mjs files don't have access to deno.json import maps
        moduleCode = rewriteVeryfrontImports(moduleCode);

        // Store in distributed cache (fire-and-forget for performance)
        if (distributedCache) {
          distributedCache.set(transformCacheKey, moduleCode, TRANSFORM_CACHE_TTL_SECONDS).catch(
            (error) => {
              logger.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache set failed`, {
                normalizedPath,
                error,
              });
            },
          );
        }
      }

      // Find and recursively process nested imports
      const { vfModules, relative } = findNestedImports(moduleCode);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] found nested imports`, {
        projectSlug,
        normalizedPath,
        vfModulesCount: vfModules.length,
        relativeCount: relative.length,
        vfModulePaths: vfModules.map((m) => m.path).slice(0, 5),
        relativePaths: relative.map((m) => m.path).slice(0, 5),
      });

      // Process nested /_vf_modules/ imports recursively in parallel
      logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules START`, {
        projectSlug,
        normalizedPath,
        count: vfModules.length,
      });
      const vfStart = performance.now();
      const nestedResults = await Promise.all(
        vfModules.map(async ({ original, path }) => {
          const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
          return { original, nestedFilePath, nestedPath: path };
        }),
      );
      logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules DONE`, {
        projectSlug,
        normalizedPath,
        vfMs: (performance.now() - vfStart).toFixed(1),
      });
      moduleCode = await processNestedImports(moduleCode, nestedResults, esmCacheDir);

      // Process relative imports in parallel
      logger.debug(
        `${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports START`,
        {
          projectSlug,
          normalizedPath,
          count: relative.length,
        },
      );
      const relStart = performance.now();
      const relativeResults = await Promise.all(
        relative.map(async ({ original, path }) => {
          const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
          return { original, nestedFilePath, relativePath: path };
        }),
      );
      logger.debug(
        `${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports DONE`,
        {
          projectSlug,
          normalizedPath,
          relMs: (performance.now() - relStart).toFixed(1),
        },
      );
      moduleCode = await processNestedImports(moduleCode, relativeResults, esmCacheDir);

      logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule START`, {
        projectSlug,
        normalizedPath,
      });
      const cacheStart = performance.now();
      const cachedPath = await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule DONE`, {
        projectSlug,
        normalizedPath,
        cacheMs: (performance.now() - cacheStart).toFixed(1),
      });
      return cachedPath;
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
      return null;
    }
  })();

  logger.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] DONE`, {
    projectSlug,
    normalizedPath,
    hasResult: result !== null,
  });
  return result;
}

/**
 * Create a module fetcher context.
 */
export function createModuleFetcherContext(
  esmCacheDir: string,
  adapter: RuntimeAdapter,
  projectDir: string,
  projectId: string,
  options?: { isLocalDev?: boolean; projectSlug?: string },
): ModuleFetcherContext {
  return { esmCacheDir, adapter, projectDir, projectId, ...options };
}
