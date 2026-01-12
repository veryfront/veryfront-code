/**
 * Module Fetcher
 *
 * Fetches and caches ESM modules for MDX rendering.
 * Handles direct file reads, HTTP fallback, and recursive dependency resolution.
 *
 * @module build/transforms/mdx/esm-module-loader/module-fetcher
 */

import { join, posix } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "../../../esm-transform.ts";
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
import { recordSSRModules } from "../../../../../module-system/manifest/route-module-manifest.ts";

/**
 * In-flight tracking to prevent duplicate parallel fetches.
 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Track modules loaded during current render for manifest recording.
 * Key: renderSessionId, Value: Set of normalized module paths
 */
const renderSessions = new Map<string, {
  modules: Set<string>;
  projectSlug?: string;
  route?: string;
}>();

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
  logger.info(`${LOG_PREFIX_MDX_LOADER} End render session`, {
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
 * Used to record modules during fetch.
 */
function getCurrentSession():
  | { modules: Set<string>; projectSlug?: string; route?: string }
  | null {
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
  const contentHash = hashString(normalizedPath + moduleCode);
  const cachePath = join(esmCacheDir, `vfmod-${contentHash}.mjs`);

  // Check if this exact content is already cached
  const localFs = getLocalFs();
  try {
    const stat = await localFs.stat(cachePath);
    if (stat?.isFile) {
      pathCache.set(normalizedPath, cachePath);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
      return cachePath;
    }
  } catch {
    // Not cached, write it
  }

  // Ensure cache directory exists before writing
  await localFs.mkdir(esmCacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(normalizedPath, cachePath);
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
): Promise<string | null> {
  // In proxy mode, HTTP fallback to localhost won't work (self-referential request)
  const isProxyMode = adapter.env.get("PROXY_MODE") === "1";
  if (isProxyMode) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in proxy mode (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`,
  );

  const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  const moduleUrl = `http://localhost:${port}/${normalizedPath}?ssr=true`;

  const response = await fetch(moduleUrl);
  if (!response.ok) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`,
    );
    return null;
  }

  let moduleCode = await response.text();

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

  // Check if this module is already being fetched (prevent race conditions)
  const existingFetch = inFlight.get(normalizedPath);
  if (existingFetch) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Waiting for in-flight fetch: ${normalizedPath}`);
    return existingFetch;
  }

  // Create a deferred promise to track this fetch
  let resolveDeferred: (value: string | null) => void;
  const fetchPromise = new Promise<string | null>((resolve) => {
    resolveDeferred = resolve;
  });

  // Register BEFORE starting fetch to prevent race conditions
  inFlight.set(normalizedPath, fetchPromise);

  // Recursive fetch function for nested imports
  const fetchAndCacheModuleFn = (path: string, parent?: string): Promise<string | null> => {
    return fetchAndCacheModule(path, context, parent);
  };

  // Now do the actual fetch
  const result = await (async (): Promise<string | null> => {
    const { esmCacheDir, adapter, projectDir, projectId } = context;

    // Check persistent module path cache first
    const pathCache = await getModulePathCache(esmCacheDir);
    const cachedPath = pathCache.get(normalizedPath);
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
        pathCache.delete(normalizedPath);
      }
    }

    // Try to find and read the source file directly
    try {
      const resolved = await resolveModuleFile(normalizedPath, adapter);

      if (!resolved) {
        // Fallback to HTTP fetch if direct file read fails
        const moduleCode = await fetchModuleViaHTTP(normalizedPath, adapter, fetchAndCacheModuleFn);
        if (moduleCode) {
          return await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache);
        }
        return null;
      }

      const { sourceCode, actualFilePath } = resolved;

      // Transform the source code directly (SSR mode)
      let moduleCode: string;
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

      // Find and recursively process nested imports
      const { vfModules, relative } = findNestedImports(moduleCode);

      // Process nested /_vf_modules/ imports recursively in parallel
      const nestedResults = await Promise.all(
        vfModules.map(async ({ original, path }) => {
          const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
          return { original, nestedFilePath, nestedPath: path };
        }),
      );
      moduleCode = await processNestedImports(moduleCode, nestedResults, esmCacheDir);

      // Process relative imports in parallel
      const relativeResults = await Promise.all(
        relative.map(async ({ original, path }) => {
          const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
          return { original, nestedFilePath, relativePath: path };
        }),
      );
      moduleCode = await processNestedImports(moduleCode, relativeResults, esmCacheDir);

      return await cacheModule(normalizedPath, moduleCode, esmCacheDir, pathCache);
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
      return null;
    }
  })();

  // Resolve the deferred promise and clean up
  resolveDeferred!(result);
  inFlight.delete(normalizedPath);
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
): ModuleFetcherContext {
  return { esmCacheDir, adapter, projectDir, projectId };
}
