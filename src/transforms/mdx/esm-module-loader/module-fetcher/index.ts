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

import { rendererLogger as globalLogger, type Logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { getModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { resolveNestedModuleImports } from "./nested-imports.ts";
import { readDistributedCache } from "./distributed-cache.ts";
import { resolveUnresolvedModuleViaHttpFallback } from "./http-fallback.ts";
import { normalizePath } from "./module-cache.ts";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";
import { persistResolvedModule } from "./persistence.ts";
import { transformResolvedModuleSource } from "./source-transform.ts";

// Re-export extracted modules for backward compatibility
export { rewriteDntImports } from "./import-rewriter.ts";
export {
  endRenderSession,
  hasRenderSession,
  runInRenderSession,
  startRenderSession,
} from "./render-sessions.ts";

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
  const { esmCacheDir, adapter, projectDir, projectId, contentSourceId } = context;
  const effectiveReactVersion = context.reactVersion ?? REACT_DEFAULT_VERSION;

  const pathCache = await getModulePathCache(esmCacheDir);
  const versionedKey = getVersionedPathCacheKey(normalizedPath, effectiveReactVersion);
  const cachedPath = await readValidCachedModulePath({
    normalizedPath,
    pathCache,
    versionedKey,
    log,
    recoveryOptions: context.contentSourceId
      ? {
        projectId: context.projectId,
        contentSourceId: context.contentSourceId,
      }
      : undefined,
  });
  if (cachedPath) return cachedPath;

  try {
    const resolved = await resolveModuleFile(normalizedPath, adapter, projectDir);

    if (!resolved) {
      return await resolveUnresolvedModuleViaHttpFallback({
        normalizedPath,
        adapter,
        fetchAndCacheModule: fetchAndCacheModuleFn,
        log,
        projectSlug,
        isLocalProject: context.isLocalProject,
        strictMissingModules: context.strictMissingModules ?? true,
        esmCacheDir,
        pathCache,
        reactVersion: effectiveReactVersion,
        parentModulePath,
      });
    }

    const { sourceCode, actualFilePath } = resolved;

    const contentHash = hashString(sourceCode);
    const transformCacheKey = contentSourceId
      ? getTransformCacheKey(
        projectId,
        contentSourceId,
        effectiveReactVersion,
        normalizedPath,
        contentHash,
      )
      : null;

    let moduleCode: string | null = null;
    let needsDistributedCacheWrite = false;

    // Try distributed cache read with full validation.
    // Returns null only if no distributed backend is configured.
    // Otherwise returns { code, distributedCache } where code may be null (miss).
    const distResult = transformCacheKey
      ? await readDistributedCache(
        transformCacheKey,
        projectId,
        contentSourceId,
        normalizedPath,
        projectSlug,
        projectDir,
        effectiveReactVersion,
        log,
      )
      : null;
    if (distResult?.code) {
      moduleCode = distResult.code;
    }

    if (!moduleCode) {
      moduleCode = await transformResolvedModuleSource({
        sourceCode,
        actualFilePath,
        projectDir,
        projectId,
        normalizedPath,
        projectSlug,
        reactVersion: context.reactVersion,
        adapter,
        log,
      });

      // Mark for distributed cache write AFTER nested imports are resolved.
      // This ensures we don't cache code with unresolved /_vf_modules/ paths.
      needsDistributedCacheWrite = true;
    }

    moduleCode = await resolveNestedModuleImports({
      moduleCode,
      esmCacheDir,
      normalizedPath,
      strictMissingModules: context.strictMissingModules ?? true,
      projectSlug,
      fetchAndCacheModule: fetchAndCacheModuleFn,
      log,
    });

    return await persistResolvedModule({
      normalizedPath,
      moduleCode,
      esmCacheDir,
      pathCache,
      log,
      projectSlug,
      reactVersion: effectiveReactVersion,
      distributedCacheWrite:
        needsDistributedCacheWrite && distResult?.distributedCache && transformCacheKey &&
          contentSourceId
          ? {
            distributedCache: distResult.distributedCache,
            transformCacheKey,
            projectId,
            contentSourceId,
          }
          : undefined,
    });
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
    contentSourceId?: string;
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
