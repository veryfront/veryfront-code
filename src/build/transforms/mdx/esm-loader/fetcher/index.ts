/**
 * Module Fetcher
 *
 * Main module fetching and caching functionality.
 *
 * @module build/transforms/mdx/esm-loader/fetcher
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { transformToESM } from "../../esm-transform.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { hashString } from "../cache/keys.ts";
import { getModulePathCache, saveModulePathCache } from "../cache/persistent.ts";
import { getLocalFs } from "../local-fs.ts";
import { createStubModule, extractNamedExports } from "../processor/stubs.ts";
import type { ModuleFetchContext } from "../types.ts";
import { resolveModuleSource } from "./direct.ts";
import { extractNestedImports, fetchModuleViaHttp, getUnresolvedImports } from "./http.ts";
import { normalizeModulePath } from "./resolver.ts";

export { normalizeModulePath, type ResolvedFile, resolveFileWithExtensions } from "./resolver.ts";
export { resolveModuleSource } from "./direct.ts";
export { extractNestedImports, fetchModuleViaHttp, getUnresolvedImports } from "./http.ts";

/**
 * Fetch and cache a module, including all its nested imports.
 *
 * @param modulePath - The module path to fetch
 * @param context - Module fetch context
 * @param parentModulePath - Parent module path for relative resolution
 * @returns Path to cached module file or null if not found
 */
export async function fetchAndCacheModule(
  modulePath: string,
  context: ModuleFetchContext,
  parentModulePath?: string,
): Promise<string | null> {
  const normalizedPath = normalizeModulePath(modulePath, parentModulePath);

  // Check if this module is already being fetched (prevent race conditions)
  const existingFetch = context.inFlight.get(normalizedPath);
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
  context.inFlight.set(normalizedPath, fetchPromise);

  // Now do the actual fetch
  const result = await doFetch(normalizedPath, context);

  // Resolve the deferred promise and clean up
  resolveDeferred!(result);
  context.inFlight.delete(normalizedPath);
  return result;
}

/**
 * Internal fetch implementation.
 */
async function doFetch(
  normalizedPath: string,
  context: ModuleFetchContext,
): Promise<string | null> {
  const { esmCacheDir, adapter } = context;

  // Check persistent module path cache first
  const pathCache = await getModulePathCache(esmCacheDir);
  const cachedPath = pathCache.get(normalizedPath);
  if (cachedPath) {
    // Verify the file still exists
    try {
      const localFs = getLocalFs();
      const stat = await localFs.stat(cachedPath);
      if (stat?.isFile) {
        return cachedPath;
      }
    } catch {
      // Cache entry is stale, remove it
      pathCache.delete(normalizedPath);
    }
  }

  try {
    // Try to resolve source file directly
    const resolved = await resolveModuleSource(normalizedPath, adapter.fs);

    if (resolved) {
      // Transform the source code directly (SSR mode)
      return await processResolvedModule(
        normalizedPath,
        resolved.content,
        resolved.path,
        context,
      );
    }

    // Fallback to HTTP fetch
    const httpContent = await fetchModuleViaHttp(normalizedPath, adapter);
    if (httpContent) {
      return await processHttpModule(normalizedPath, httpContent, context);
    }

    return null;
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to process ${normalizedPath}`, error);
    return null;
  }
}

/**
 * Process a resolved local module.
 */
async function processResolvedModule(
  normalizedPath: string,
  sourceCode: string,
  actualFilePath: string,
  context: ModuleFetchContext,
): Promise<string | null> {
  const { esmCacheDir, adapter, projectDir, projectId } = context;

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

  // Process nested imports
  moduleCode = await processNestedImports(moduleCode, normalizedPath, context);

  // Check for unresolved imports
  const unresolved = getUnresolvedImports(moduleCode);
  if (unresolved.length > 0) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.length} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.slice(0, 3) },
    );
    return null;
  }

  // Cache the module
  return await cacheModuleCode(normalizedPath, moduleCode, esmCacheDir);
}

/**
 * Process a module fetched via HTTP.
 */
async function processHttpModule(
  normalizedPath: string,
  moduleCode: string,
  context: ModuleFetchContext,
): Promise<string | null> {
  // Process nested imports
  const code = await processNestedImports(moduleCode, normalizedPath, context);

  // Check for unresolved imports
  const unresolved = getUnresolvedImports(code);
  if (unresolved.length > 0) {
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.length} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.slice(0, 3) },
    );
    return null;
  }

  // Cache the module
  return await cacheModuleCode(normalizedPath, code, context.esmCacheDir);
}

/**
 * Process nested imports in module code.
 */
async function processNestedImports(
  moduleCode: string,
  normalizedPath: string,
  context: ModuleFetchContext,
): Promise<string> {
  const { vfModules, relative } = extractNestedImports(moduleCode);
  let code = moduleCode;

  // Process nested /_vf_modules/ imports IN PARALLEL
  const nestedResults = await Promise.all(
    vfModules.map(async ({ original, path: nestedPath }) => {
      const nestedFilePath = await fetchAndCacheModule(nestedPath, context, normalizedPath);
      return { original, nestedFilePath, nestedPath };
    }),
  );

  for (const { original, nestedFilePath, nestedPath } of nestedResults) {
    if (nestedFilePath) {
      code = code.replace(original, `from "file://${nestedFilePath}"`);
    } else {
      // Create stub module for missing files
      const namedExports = extractNamedExports(code, original, nestedPath);
      try {
        const stubPath = await createStubModule(nestedPath, namedExports, context.esmCacheDir);
        code = code.replace(original, `from "file://${stubPath}"`);
      } catch {
        // Stub creation failed, leave import as-is
      }
    }
  }

  // Process relative imports IN PARALLEL
  const relativeResults = await Promise.all(
    relative.map(async ({ original, path: relativePath }) => {
      const nestedFilePath = await fetchAndCacheModule(relativePath, context, normalizedPath);
      return { original, nestedFilePath, relativePath };
    }),
  );

  for (const { original, nestedFilePath, relativePath } of relativeResults) {
    if (nestedFilePath) {
      code = code.replace(original, `from "file://${nestedFilePath}"`);
    } else {
      // Create stub module for missing files
      const namedExports = extractNamedExports(code, original, relativePath);
      try {
        const stubPath = await createStubModule(relativePath, namedExports, context.esmCacheDir);
        code = code.replace(original, `from "file://${stubPath}"`);
      } catch {
        // Stub creation failed, leave import as-is
      }
    }
  }

  return code;
}

/**
 * Cache module code to disk.
 */
async function cacheModuleCode(
  normalizedPath: string,
  moduleCode: string,
  cacheDir: string,
): Promise<string> {
  const contentHash = hashString(normalizedPath + moduleCode);
  const cachePath = join(cacheDir, `vfmod-${contentHash}.mjs`);

  const localFs = getLocalFs();
  const pathCache = await getModulePathCache(cacheDir);

  // Check if this exact content is already cached
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
  await localFs.mkdir(cacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(normalizedPath, cachePath);
  await saveModulePathCache(cacheDir);
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);
  return cachePath;
}
