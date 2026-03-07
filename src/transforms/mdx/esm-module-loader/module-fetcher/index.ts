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

import { rendererLogger as globalLogger } from "#veryfront/utils";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "../../../esm-transform.ts";
import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { getLocalFs, getModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";
import { findNestedImports, processNestedImports } from "./nested-imports.ts";
import { validateCachedModule } from "./framework-validator.ts";
import { recordModuleToSession } from "./render-sessions.ts";
import { readDistributedCache, writeDistributedCache } from "./distributed-cache.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { cacheModule, normalizePath } from "./module-cache.ts";

// Re-export extracted modules for backward compatibility
export { rewriteDntImports } from "./import-rewriter.ts";
export { endRenderSession, startRenderSession } from "./render-sessions.ts";

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

/**
 * Error thrown when a circular module dependency is detected in the current fetch chain.
 */
export class CircularModuleDependencyError extends Error {
  constructor(pathChain: string) {
    super(`Circular module dependency detected: ${pathChain}`);
    this.name = "CircularModuleDependencyError";
  }
}

/** Resolve the logger from context, falling back to global logger */
function getLog(context?: { logger?: Logger }): Logger {
  return context?.logger ?? globalLogger;
}

function isFatalModuleFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "MissingModuleError" ||
    error instanceof TransformTreeTimeoutError ||
    error instanceof CircularModuleDependencyError;
}

/**
 * Fetch and cache a module.
 * This is the main entry point for module fetching operations.
 */
export async function fetchAndCacheModule(
  modulePath: string,
  context: ModuleFetcherContext,
  parentModulePath?: string,
  lineage: Set<string> = new Set(),
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
    if (lineage.has(normalizedPath)) {
      const cycleChain = [...lineage, normalizedPath].join(" -> ");
      const cycleError = new CircularModuleDependencyError(cycleChain);

      if (context.strictMissingModules ?? true) {
        log.error(`${LOG_PREFIX_MDX_LOADER} Circular module dependency`, {
          projectSlug,
          normalizedPath,
          parentModulePath,
          cycleChain,
        });
        throw cycleError;
      }

      log.warn(`${LOG_PREFIX_MDX_LOADER} Circular module dependency (using stub fallback)`, {
        projectSlug,
        normalizedPath,
        parentModulePath,
        cycleChain,
      });
      return null;
    }

    log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] Waiting for in-flight module`, {
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

  const nextLineage = new Set(lineage);
  nextLineage.add(normalizedPath);

  const fetchAndCacheModuleFn = (path: string, parent?: string): Promise<string | null> =>
    fetchAndCacheModule(path, context, parent, nextLineage);

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
    } catch (_) {
      /* expected: cached file may no longer exist on disk */
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

    // Try distributed cache read with full validation.
    // Returns null only if no distributed backend is configured.
    // Otherwise returns { code, distributedCache } where code may be null (miss).
    const distResult = await readDistributedCache(
      transformCacheKey,
      normalizedPath,
      projectSlug,
      projectDir,
      context.reactVersion,
      log,
    );
    if (distResult?.code) {
      moduleCode = distResult.code;
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
    if (needsDistributedCacheWrite && distResult?.distributedCache) {
      writeDistributedCache(
        distResult.distributedCache,
        transformCacheKey,
        moduleCode,
        normalizedPath,
        log,
      );
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
    if ((context.strictMissingModules ?? true) || isFatalModuleFetchError(error)) {
      throw (error instanceof Error) ? error : new Error(String(error));
    }
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
