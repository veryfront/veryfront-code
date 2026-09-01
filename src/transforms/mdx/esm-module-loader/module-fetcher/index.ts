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

import { type Logger, rendererLogger as globalLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { defineError, VeryfrontError } from "#veryfront/errors";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { ModuleFetcherContext } from "../types.ts";
import { getModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { resolveModuleFile } from "../resolution/file-finder.ts";
import {
  canonicalizeContainedModulePath,
  frameworkSourceKeyOf,
} from "../resolution/module-path.ts";
import {
  isPublicFrameworkSourceKey,
} from "#veryfront/platform/compat/framework-source-resolver.ts";
import { getTransformCacheKey, getVersionedPathCacheKey } from "./cache-keys.ts";
import { resolveNestedImportBase, resolveNestedModuleImports } from "./nested-imports.ts";
import { readDistributedCache } from "./distributed-cache.ts";
import { resolveUnresolvedModuleViaHttpFallback } from "./http-fallback.ts";
import { normalizePath } from "./module-cache.ts";
import { readValidCachedModulePath } from "./path-cache-lookup.ts";
import { persistResolvedModule } from "./persistence.ts";
import { transformResolvedModuleSource } from "./source-transform.ts";
import { extractDependencyPinningPathKey } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import {
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_MODULE_GRAPH_ENTRIES,
  ModuleGraphLimitError,
  ModuleImportLimitError,
  ModuleSourceLimitError,
  utf8ByteLength,
} from "./limits.ts";

export {
  MAX_MDX_MODULE_GRAPH_ENTRIES,
  ModuleGraphLimitError,
  ModuleImportLimitError,
  ModuleSourceLimitError,
} from "./limits.ts";

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

const MALFORMED_DEPENDENCY_PIN = defineError({
  slug: "dependency-pin-malformed",
  category: "MODULE",
  status: 400,
  title: "Dependency snapshot module path is malformed",
  suggestion: "Use a valid dependency snapshot module path",
});

const DEPENDENCY_PIN_MISMATCH = defineError({
  slug: "dependency-pin-mismatch",
  category: "MODULE",
  status: 400,
  title: "Dependency snapshot module path does not match the request",
  suggestion: "Use the dependency snapshot path for the active request",
});

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
  if (
    error instanceof VeryfrontError &&
    (error.slug === "dependency-pin-malformed" || error.slug === "dependency-pin-mismatch")
  ) {
    return true;
  }
  return error.name === "MissingModuleError" ||
    error instanceof TransformTreeTimeoutError ||
    error instanceof CircularModuleDependencyError ||
    error instanceof ModuleGraphLimitError ||
    error instanceof ModuleImportLimitError ||
    error instanceof ModuleSourceLimitError;
}

function unwrapDependencyPinningPath(
  modulePath: string,
  expectedCacheKey?: string,
): string {
  const separatorIndex = modulePath.search(/[?#]/);
  const pathname = separatorIndex === -1 ? modulePath : modulePath.slice(0, separatorIndex);
  const extracted = extractDependencyPinningPathKey(
    pathname.startsWith("/") ? pathname : `/${pathname}`,
  );

  if (extracted.malformed) {
    throw MALFORMED_DEPENDENCY_PIN.create({
      detail: "Malformed dependency snapshot module path",
    });
  }
  if (!extracted.found) return modulePath;
  if (extracted.cacheKey !== expectedCacheKey) {
    throw DEPENDENCY_PIN_MISMATCH.create({
      detail: "Dependency snapshot module path does not match the request snapshot",
    });
  }

  // Deliberately asymmetric with the unpinned branch above: a pinned path's
  // query/fragment (`?ssr=true`, hashes) is dropped because this loader
  // implies SSR and the cache variant comes from the context's snapshot key,
  // not from the URL. An unpinned path keeps its query untouched.
  return extracted.pathname;
}

/**
 * Return whether a tenant requested a framework module outside public exports.
 *
 * Privileged implementation modules (the host process env seam) may only be
 * fetched as transitive dependencies of framework source — a fetch whose
 * parent is itself a framework module. A fetch reached from tenant code
 * (project module parent, or no parent at all) is refused before any cache
 * lookup, so a copy cached for the framework graph is never handed to a
 * tenant-requested import.
 */
function isRefusedTenantFrameworkModuleFetch(
  normalizedPath: string,
  parentModulePath: string | undefined,
  expectedCacheKey: string | undefined,
): boolean {
  const frameworkKey = frameworkSourceKeyOf(normalizedPath);
  if (frameworkKey === null) return false;

  if (parentModulePath === undefined) {
    return !isPublicFrameworkSourceKey(frameworkKey);
  }
  const normalizedParent = canonicalizeContainedModulePath(
    unwrapDependencyPinningPath(parentModulePath, expectedCacheKey),
  );
  if (normalizedParent === null) return true;
  if (frameworkSourceKeyOf(normalizedParent) !== null) return false;
  return !isPublicFrameworkSourceKey(frameworkKey);
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
  const expectedCacheKey = context.dependencyPinningCacheKey;
  const normalizedPath = normalizePath(
    unwrapDependencyPinningPath(modulePath, expectedCacheKey),
    parentModulePath ? unwrapDependencyPinningPath(parentModulePath, expectedCacheKey) : undefined,
  );
  const projectSlug = context.projectSlug || "unknown";

  if (isRefusedTenantFrameworkModuleFetch(normalizedPath, parentModulePath, expectedCacheKey)) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} Refusing non-public framework module for tenant import`, {
      projectSlug,
      normalizedPath,
      parentModulePath,
    });
    return null;
  }

  const moduleGraph = context.moduleGraph ??= new Set<string>();
  if (!moduleGraph.has(normalizedPath)) {
    if (moduleGraph.size >= MAX_MDX_MODULE_GRAPH_ENTRIES) {
      throw new ModuleGraphLimitError(normalizedPath);
    }
    moduleGraph.add(normalizedPath);
  }

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
  const dev = context.dev === true;
  const dependencyPinningCacheKey = context.dependencyPinningCacheKey ?? "off";
  const moduleServerOrigin = dependencyPinningCacheKey.startsWith("on:")
    ? context.moduleServerOrigin
    : undefined;

  const pathCache = await getModulePathCache(esmCacheDir);
  const versionedKey = getVersionedPathCacheKey(
    normalizedPath,
    effectiveReactVersion,
    dependencyPinningCacheKey,
    moduleServerOrigin,
    context.serverExternalPackages,
    dev,
  );
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
        dependencyPinningCacheKey,
        moduleServerOrigin,
        serverExternalPackages: context.serverExternalPackages,
        dev,
        parentModulePath,
      });
    }

    const { sourceCode, actualFilePath } = resolved;
    const sourceSizeBytes = utf8ByteLength(sourceCode);
    if (sourceSizeBytes > MAX_MDX_MODULE_CODE_BYTES) {
      throw new ModuleSourceLimitError(
        normalizedPath,
        sourceSizeBytes,
        MAX_MDX_MODULE_CODE_BYTES,
      );
    }

    const contentHash = hashString(sourceCode);
    const transformCacheKey = contentSourceId
      ? getTransformCacheKey(
        projectId,
        contentSourceId,
        effectiveReactVersion,
        normalizedPath,
        contentHash,
        dependencyPinningCacheKey,
        moduleServerOrigin,
        context.serverExternalPackages,
        dev,
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
        context.serverExternalPackages,
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
        serverExternalPackages: context.serverExternalPackages,
        moduleServerOrigin,
        dependencyPinningCacheKey,
        dependencyPinningDependencies: context.dependencyPinningDependencies,
        dependencyPinningSource: context.dependencyPinningSource,
        adapter,
        log,
        dev,
      });

      // Mark for distributed cache write AFTER nested imports are resolved.
      // This ensures we don't cache code with unresolved /_vf_modules/ paths.
      needsDistributedCacheWrite = true;
    }

    moduleCode = await resolveNestedModuleImports({
      moduleCode,
      esmCacheDir,
      normalizedPath,
      parentBasePath: resolveNestedImportBase(normalizedPath, actualFilePath),
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
      dependencyPinningCacheKey,
      moduleServerOrigin,
      serverExternalPackages: context.serverExternalPackages,
      dev,
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
    /** Compile fetched modules in development mode. Defaults to false. */
    dev?: boolean;
    reactVersion?: string;
    moduleServerOrigin?: string;
    dependencyPinningCacheKey?: string;
    dependencyPinningDependencies?: Readonly<Record<string, string>>;
    dependencyPinningSource?: ModuleFetcherContext["dependencyPinningSource"];
    serverExternalPackages?: readonly string[];
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
    moduleGraph: new Set(),
  };
}
