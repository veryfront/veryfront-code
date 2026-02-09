/****
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

import { join } from "#veryfront/compat/path";
import * as posix from "#std/path/posix";
import { rendererLogger as globalLogger } from "#veryfront/utils";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "../../../esm-transform.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache";
import { cacheHttpImportsToLocal, ensureHttpBundlesExist } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import {
  createBundleManifest,
  storeBundleManifest,
  validateBundleGroup,
} from "../../../esm/bundle-manifest.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { FRAMEWORK_ROOT, LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { getLocalFs, getModulePathCache, saveModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import { getDistributedTransformBackend } from "#veryfront/transforms/esm/transform-cache.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";
import { findNestedImports, hasUnresolvedImports, processNestedImports } from "./nested-imports.ts";
import {
  findMissingFileDependenciesInCode,
  hasIncompatibleFrameworkPaths,
  validateCachedModule,
} from "./framework-validator.ts";
import { recordModuleToSession } from "./render-sessions.ts";

// Re-export extracted modules for backward compatibility
export { rewriteDntImports } from "./import-rewriter.ts";
export { endRenderSession, startRenderSession } from "./render-sessions.ts";

/** TTL for cached transforms (uses centralized config) */
const TRANSFORM_CACHE_TTL_SECONDS = TRANSFORM_DISTRIBUTED_TTL_SEC;

/**
 * Maximum time allowed for the entire transform tree (recursive module resolution).
 * If the cumulative time exceeds this, we fail fast instead of hanging indefinitely.
 * This prevents pods from getting stuck on deeply nested or slow transforms.
 */
const TRANSFORM_TREE_TIMEOUT_MS = 30_000;

/**
 * Error thrown when transform tree exceeds the timeout.
 */
export class TransformTreeTimeoutError extends Error {
  constructor(normalizedPath: string, elapsedMs: number) {
    super(
      `Transform tree timeout: Module resolution for "${normalizedPath}" exceeded ${TRANSFORM_TREE_TIMEOUT_MS}ms (elapsed: ${elapsedMs}ms). ` +
        `This may indicate deeply nested dependencies or slow network fetches.`,
    );
    this.name = "TransformTreeTimeoutError";
  }
}

/** Resolve the logger from context, falling back to global logger */
function getLog(context?: { logger?: Logger }): Logger {
  return context?.logger ?? globalLogger;
}

/**
 * Normalize a module path, resolving relative paths if a parent is provided.
 */
function normalizePath(modulePath: string, parentModulePath?: string): string {
  // Strip query parameters (e.g., ?ssr=true) as they're not part of the file path
  // and cause issues with cache key validation (? is not an allowed character)
  let normalizedPath = modulePath.replace(/\?.*$/, "").replace(/^\//, "");

  if (!parentModulePath) return normalizedPath;
  if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) return normalizedPath;

  const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
  normalizedPath = posix.normalize(posix.join(parentDir, modulePath));

  if (!normalizedPath.startsWith("_vf_modules/")) normalizedPath = `_vf_modules/${normalizedPath}`;
  return normalizedPath;
}

/**
 * Write module to cache and return the cache path.
 */
async function cacheModule(
  normalizedPath: string,
  moduleCode: string,
  esmCacheDir: string,
  pathCache: Map<string, string>,
  log: Logger,
): Promise<string | null> {
  const unresolved = hasUnresolvedImports(moduleCode);
  if (unresolved.count > 0) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.count} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.paths },
    );
    return null;
  }

  const contentHash = hashString(normalizedPath + moduleCode);
  const cachePath = join(esmCacheDir, `vfmod-v${VERSION}-${contentHash}.mjs`);

  const localFs = getLocalFs();
  try {
    const stat = await localFs.stat(cachePath);
    if (stat?.isFile) {
      pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
      log.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
      recordModuleToSession(normalizedPath);
      return cachePath;
    }
  } catch {
    // Not cached, write it
  }

  await localFs.mkdir(esmCacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(getVersionedPathCacheKey(normalizedPath), cachePath);
  await saveModulePathCache(esmCacheDir);
  log.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);

  recordModuleToSession(normalizedPath);
  return cachePath;
}

/**
 * Fetch module via HTTP as a fallback.
 */
async function fetchModuleViaHTTP(
  normalizedPath: string,
  adapter: RuntimeAdapter,
  fetchAndCacheModuleFn: (path: string, parent?: string) => Promise<string | null>,
  log: Logger,
  projectSlug?: string,
  isLocalProject?: boolean,
): Promise<string | null> {
  if (!isLocalProject) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`);

  const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  const host = projectSlug ? `${projectSlug}.lvh.me` : "localhost";
  const moduleUrl = `http://${host}:${port}/${normalizedPath}?ssr=true`;

  const response = await withSpan(
    SpanNames.HTTP_CLIENT_FETCH,
    () => fetch(moduleUrl),
    {
      "http.method": "GET",
      "http.url": moduleUrl,
      "http.target": `/${normalizedPath}`,
      "http.host": host,
      "mdx.module_path": normalizedPath,
    },
  );

  if (!response.ok) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`);
    return null;
  }

  let moduleCode = rewriteVeryfrontImports(await response.text());

  const { vfModules, relative } = findNestedImports(moduleCode);
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
  const log = getLog(context);
  const normalizedPath = normalizePath(modulePath, parentModulePath);
  const projectSlug = context.projectSlug || "unknown";

  const now = Date.now();
  context.transformDeadline ??= now + TRANSFORM_TREE_TIMEOUT_MS;

  if (now > context.transformDeadline) {
    const elapsedMs = TRANSFORM_TREE_TIMEOUT_MS + (now - context.transformDeadline);
    log.error(`${LOG_PREFIX_MDX_LOADER} Transform tree timeout exceeded`, {
      projectSlug,
      normalizedPath,
      parentModulePath,
      elapsedMs,
      timeoutMs: TRANSFORM_TREE_TIMEOUT_MS,
    });
    throw new TransformTreeTimeoutError(normalizedPath, elapsedMs);
  }

  const inFlight = context.inFlightModules;
  const existingPromise = inFlight?.get(normalizedPath);
  if (existingPromise) {
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] CIRCULAR IMPORT detected`, {
      projectSlug,
      normalizedPath,
      parentModulePath,
    });
    return existingPromise;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] START`, {
    projectSlug,
    modulePath,
    normalizedPath,
    parentModulePath,
  });

  const fetchAndCacheModuleFn = (path: string, parent?: string): Promise<string | null> =>
    fetchAndCacheModule(path, context, parent);

  const fetchPromise = doFetchAndCacheModule(
    normalizedPath,
    context,
    fetchAndCacheModuleFn,
    projectSlug,
    parentModulePath,
  );

  inFlight?.set(normalizedPath, fetchPromise);

  try {
    const result = await fetchPromise;
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] DONE`, {
      projectSlug,
      normalizedPath,
      hasResult: result !== null,
    });
    return result;
  } finally {
    inFlight?.delete(normalizedPath);
  }
}

/**
 * Internal implementation of module fetching.
 */
async function doFetchAndCacheModule(
  normalizedPath: string,
  context: ModuleFetcherContext,
  fetchAndCacheModuleFn: (path: string, parent?: string) => Promise<string | null>,
  projectSlug: string,
  parentModulePath?: string,
): Promise<string | null> {
  const log = getLog(context);
  const { esmCacheDir, adapter, projectDir, projectId } = context;

  const pathCache = await getModulePathCache(esmCacheDir);
  const versionedKey = getVersionedPathCacheKey(normalizedPath);
  const cachedPath = pathCache.get(versionedKey);

  if (cachedPath) {
    try {
      const stat = await getLocalFs().stat(cachedPath);
      if (stat?.isFile) {
        const cachedCode = await getLocalFs().readTextFile(cachedPath);
        if (
          await validateCachedModule(
            normalizedPath,
            cachedPath,
            cachedCode,
            log,
            pathCache,
            versionedKey,
          )
        ) {
          recordModuleToSession(normalizedPath);
          return cachedPath;
        }
      }
    } catch {
      pathCache.delete(versionedKey);
    }
  }

  try {
    const resolved = await resolveModuleFile(normalizedPath, adapter, projectDir);

    if (!resolved) {
      const moduleCode = await fetchModuleViaHTTP(
        normalizedPath,
        adapter,
        fetchAndCacheModuleFn,
        log,
        projectSlug,
        context.isLocalProject,
      );

      if (moduleCode) {
        return await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache, log);
      }

      if (context.strictMissingModules ?? true) {
        throw buildMissingModuleError({
          modulePath: normalizedPath,
          importer: parentModulePath,
          projectSlug,
        });
      }

      return null;
    }

    const { sourceCode, actualFilePath } = resolved;

    const contentHash = hashString(sourceCode);
    const transformCacheKey = getTransformCacheKey(projectId, normalizedPath, contentHash);

    let moduleCode: string | null = null;
    let needsDistributedCacheWrite = false;
    const distributedCache = await getDistributedTransformBackend();

    if (distributedCache) {
      try {
        const cached = await distributedCache.get(transformCacheKey);
        if (cached) {
          // Detokenize all cache paths for local environment
          moduleCode = detokenizeAllCachePaths(cached);
          log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed transform cache HIT`, {
            projectSlug,
            normalizedPath,
            cacheKey: transformCacheKey,
          });

          const bundleManifestKey = `${transformCacheKey}:bm`;
          const manifestId = await distributedCache.get(bundleManifestKey).catch(() => null);

          if (manifestId) {
            const cacheDir = getHttpBundleCacheDir();
            const validation = await validateBundleGroup(manifestId, cacheDir);
            if (!validation.valid) {
              log.warn(`${LOG_PREFIX_MDX_LOADER} Bundle manifest validation failed`, {
                normalizedPath,
                manifestId: manifestId.slice(0, 12),
                failedHashes: validation.failedHashes,
              });
              moduleCode = null;
            }
          } else {
            // Use detokenized code for bundle path extraction
            const bundlePaths = extractHttpBundlePaths(moduleCode);
            if (bundlePaths.length > 0) {
              const cacheDir = getHttpBundleCacheDir();
              const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
              if (failed.length > 0) {
                log.warn(`${LOG_PREFIX_MDX_LOADER} Some HTTP bundles could not be recovered`, {
                  normalizedPath,
                  failed,
                });
                moduleCode = null;
              }
            }
          }

          // Use detokenized code for framework path checks
          if (moduleCode && await hasIncompatibleFrameworkPaths(moduleCode, log)) {
            log.warn(`${LOG_PREFIX_MDX_LOADER} Cached code has incompatible framework paths`, {
              normalizedPath,
              frameworkRoot: FRAMEWORK_ROOT,
            });
            moduleCode = null;
          }

          // CRITICAL: Check for unresolved /_vf_modules/ imports.
          // Stale cache entries may have unresolved paths from before this fix.
          if (moduleCode) {
            const unresolved = hasUnresolvedImports(moduleCode);
            if (unresolved.count > 0) {
              log.warn(
                `${LOG_PREFIX_MDX_LOADER} Cached code has ${unresolved.count} unresolved imports, invalidating`,
                { normalizedPath, unresolved: unresolved.paths },
              );
              moduleCode = null;
            }
          }

          // CRITICAL: Check that all file:// paths (vfmod modules, etc.) exist locally.
          // Distributed cache may return code with file:// paths from other pods/runs
          // that don't exist on this machine.
          if (moduleCode) {
            const missingDeps = await findMissingFileDependenciesInCode(moduleCode, log);
            if (missingDeps.length > 0) {
              log.warn(
                `${LOG_PREFIX_MDX_LOADER} Cached code has ${missingDeps.length} missing file dependencies, invalidating`,
                { normalizedPath, missingDeps: missingDeps.slice(0, 5) },
              );
              moduleCode = null;
            }
          }

          // Safety net: Convert any remaining HTTP imports to local file:// paths.
          // New cache entries should already have file:// paths, but old entries might have HTTP URLs.
          // This is a no-op for properly cached entries and fixes legacy cache entries.
          if (moduleCode) {
            const importMap = await loadImportMap(projectDir);
            const cacheResult = await cacheHttpImportsToLocal(moduleCode, {
              cacheDir: getHttpBundleCacheDir(),
              importMap,
              reactVersion: context.reactVersion,
            });
            if (cacheResult.code !== moduleCode) {
              log.debug(`${LOG_PREFIX_MDX_LOADER} Converted HTTP imports from legacy cache entry`, {
                normalizedPath,
              });
              moduleCode = cacheResult.code;
            }
          }
        }
      } catch (error) {
        log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache get failed`, {
          normalizedPath,
          error,
        });
      }
    }

    if (!moduleCode) {
      log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM START`, {
        projectSlug,
        normalizedPath,
        actualFilePath,
        sourceLength: sourceCode.length,
      });

      // Rewrite veryfront/* imports to /_vf_modules/ paths BEFORE transform
      // so that ssrVfModulesPlugin can resolve them to file:// paths.
      // Cached files don't have access to import maps, so we need to do this mapping here.
      const preprocessedSource = rewriteVeryfrontImports(sourceCode);

      const transformStart = performance.now();
      try {
        moduleCode = await transformToESM(preprocessedSource, actualFilePath, projectDir, adapter, {
          projectId,
          dev: true,
          ssr: true,
          reactVersion: context.reactVersion,
        });
      } catch (transformError) {
        log.error(`${LOG_PREFIX_MDX_LOADER} Transform failed for module`, {
          normalizedPath,
          actualFilePath,
          sourceLength: sourceCode.length,
          sourcePreview: sourceCode.slice(0, 200),
          error: transformError instanceof Error ? transformError.message : String(transformError),
        });
        throw transformError;
      }

      log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM DONE`, {
        projectSlug,
        normalizedPath,
        transformMs: (performance.now() - transformStart).toFixed(1),
        outputLength: moduleCode.length,
      });

      // Rewrite _dnt.polyfills.js / _dnt.shims.js relative imports to absolute file:// paths
      moduleCode = rewriteDntImports(moduleCode, actualFilePath);

      // Cache HTTP imports (esm.sh URLs) to local file:// paths.
      // This ensures the same cache works for both compiled and non-compiled Deno.
      // Compiled binaries cannot do dynamic HTTP imports, but non-compiled Deno
      // also works fine with file:// paths, so we always cache for consistency.
      {
        log.debug(`${LOG_PREFIX_MDX_LOADER} Caching HTTP imports to local files`, {
          normalizedPath,
        });
        const importMap = await loadImportMap(projectDir);
        const cacheResult = await cacheHttpImportsToLocal(moduleCode, {
          cacheDir: getHttpBundleCacheDir(),
          importMap,
          reactVersion: context.reactVersion,
        });
        moduleCode = cacheResult.code;
      }

      // Mark for distributed cache write AFTER nested imports are resolved.
      // This ensures we don't cache code with unresolved /_vf_modules/ paths.
      needsDistributedCacheWrite = true;
    }

    const { vfModules, relative } = findNestedImports(moduleCode);
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] found nested imports`, {
      projectSlug,
      normalizedPath,
      vfModulesCount: vfModules.length,
      relativeCount: relative.length,
      vfModulePaths: vfModules.map((m) => m.path).slice(0, 5),
      relativePaths: relative.map((m) => m.path).slice(0, 5),
    });

    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules START`, {
      projectSlug,
      normalizedPath,
      count: vfModules.length,
    });
    const vfStart = performance.now();
    const nestedResults = await Promise.all(
      vfModules.map(async ({ original, path }) => ({
        original,
        nestedFilePath: await fetchAndCacheModuleFn(path, normalizedPath),
        nestedPath: path,
      })),
    );
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing vfModules DONE`, {
      projectSlug,
      normalizedPath,
      vfMs: (performance.now() - vfStart).toFixed(1),
    });
    moduleCode = await processNestedImports(
      moduleCode,
      nestedResults,
      esmCacheDir,
      context.strictMissingModules ?? true,
      normalizedPath,
      projectSlug,
    );

    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports START`, {
      projectSlug,
      normalizedPath,
      count: relative.length,
    });
    const relStart = performance.now();
    const relativeResults = await Promise.all(
      relative.map(async ({ original, path }) => ({
        original,
        nestedFilePath: await fetchAndCacheModuleFn(path, normalizedPath),
        relativePath: path,
      })),
    );
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] processing relative imports DONE`, {
      projectSlug,
      normalizedPath,
      relMs: (performance.now() - relStart).toFixed(1),
    });
    moduleCode = await processNestedImports(
      moduleCode,
      relativeResults,
      esmCacheDir,
      context.strictMissingModules ?? true,
      normalizedPath,
      projectSlug,
    );

    // Write to distributed cache AFTER nested imports are resolved.
    // This ensures other pods get fully-resolved code without /_vf_modules/ paths.
    if (needsDistributedCacheWrite && distributedCache) {
      // Tokenize all cache paths for cross-environment portability
      // Uses aggressive tokenization to catch paths from ANY environment (build server, other pods)
      const portableCode = tokenizeAllVeryFrontPaths(moduleCode);

      // Store transformed code in distributed cache
      distributedCache
        .set(transformCacheKey, portableCode, TRANSFORM_CACHE_TTL_SECONDS)
        .catch((error) => {
          log.debug(`${LOG_PREFIX_MDX_LOADER} Distributed cache set failed`, {
            normalizedPath,
            error,
          });
        });

      // Create and store bundle manifest companion key for atomic validation
      const bundlePaths = extractHttpBundlePaths(moduleCode);
      if (bundlePaths.length > 0) {
        const entries = bundlePaths.map((b) => ({ hash: b.hash, url: "", sizeBytes: 0 }));
        createBundleManifest(entries).then(async (manifest) => {
          await storeBundleManifest(manifest);
          const bundleManifestKey = `${transformCacheKey}:bm`;
          await distributedCache.set(
            bundleManifestKey,
            manifest.manifestId,
            TRANSFORM_CACHE_TTL_SECONDS,
          );
        }).catch((error) => {
          log.debug(`${LOG_PREFIX_MDX_LOADER} Bundle manifest creation failed`, {
            normalizedPath,
            error,
          });
        });
      }
    }

    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule START`, {
      projectSlug,
      normalizedPath,
    });
    const cacheStart = performance.now();
    const finalCachedPath = await cacheModule(
      normalizedPath,
      moduleCode,
      esmCacheDir,
      pathCache,
      log,
    );
    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule DONE`, {
      projectSlug,
      normalizedPath,
      cacheMs: (performance.now() - cacheStart).toFixed(1),
    });

    return finalCachedPath;
  } catch (error) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
    if (error instanceof Error && error.name === "MissingModuleError") throw error;
    return null;
  }
}

/**
 * Create a module fetcher context.
 */
export function createModuleFetcherContext(
  esmCacheDir: string,
  adapter: RuntimeAdapter,
  projectDir: string,
  projectId: string,
  options?: {
    isLocalProject?: boolean;
    projectSlug?: string;
    reactVersion?: string;
    logger?: Logger;
    strictMissingModules?: boolean;
  },
): ModuleFetcherContext {
  return {
    esmCacheDir,
    adapter,
    projectDir,
    projectId,
    ...options,
    // Initialize in-flight tracking for circular import detection
    inFlightModules: new Map(),
  };
}
