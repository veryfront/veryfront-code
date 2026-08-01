/****
 * Local filesystem module caching and path normalization.
 *
 * Handles writing transformed modules to the local cache directory
 * and normalizing module paths for consistent cache key generation.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/module-cache
 */

import { join, posix } from "#veryfront/compat/path";
import type { Logger } from "#veryfront/utils";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs, saveModulePathCache } from "../cache/index.ts";
import { hashString } from "../utils/hash.ts";
import { buildMdxEsmModuleFileName, buildMdxEsmPathCacheKey } from "../cache-format.ts";
import { hasUnresolvedImports } from "./nested-imports.ts";
import { recordModuleToSession } from "./render-sessions.ts";
import { ensureFilenameDefaultExport } from "#veryfront/modules/loader-shared/filename-default-export.ts";
import { tokenizeAllVeryFrontPaths } from "#veryfront/cache/paths.ts";
import { MAX_MDX_MODULE_CODE_BYTES, utf8ByteLength } from "./recovery-payload.ts";
import { getMdxModuleCacheVariant } from "./cache-keys.ts";
import { canonicalizeContainedModulePath, isVfModulePath } from "../resolution/module-path.ts";

const MAX_MODULE_PATH_LENGTH = 4096;

function invalidModulePath(): never {
  throw new TypeError("Module path must remain within the project module root");
}

function canonicalizeBoundedModulePath(value: string): string | null {
  if (value.length === 0 || value.length > MAX_MODULE_PATH_LENGTH) return null;
  return canonicalizeContainedModulePath(value);
}

/**
 * Normalize a module path, resolving relative paths if a parent is provided.
 */
export function normalizePath(modulePath: string, parentModulePath?: string): string {
  const relativeImport = modulePath.startsWith("./") || modulePath.startsWith("../");
  if (!parentModulePath || !relativeImport) {
    return canonicalizeBoundedModulePath(modulePath) ?? invalidModulePath();
  }

  const normalizedParent = canonicalizeBoundedModulePath(parentModulePath) ??
    invalidModulePath();
  const parentDir = posix.dirname(normalizedParent);
  const resolvedPath = canonicalizeBoundedModulePath(posix.join(parentDir, modulePath)) ??
    invalidModulePath();

  if (isVfModulePath(normalizedParent) && !isVfModulePath(resolvedPath)) {
    return invalidModulePath();
  }
  return isVfModulePath(resolvedPath) ? resolvedPath : `_vf_modules/${resolvedPath}`;
}

/**
 * Write module to cache and return the cache path.
 *
 * Skips caching if the module has unresolved imports (indicates incomplete
 * dependency resolution). Otherwise writes to the local filesystem cache
 * and updates the path cache map.
 */
export async function cacheModule(
  normalizedPath: string,
  moduleCode: string,
  esmCacheDir: string,
  pathCache: Map<string, string>,
  log: Logger,
  reactVersion = REACT_DEFAULT_VERSION,
  sourceContentHash?: string,
  importMapFingerprint?: string,
  dependencyPinningCacheKey = "off",
  moduleServerOrigin?: string,
): Promise<string | null> {
  moduleCode = ensureFilenameDefaultExport(normalizedPath, moduleCode);
  if (utf8ByteLength(moduleCode) > MAX_MDX_MODULE_CODE_BYTES) {
    throw new RangeError(`Transformed MDX module exceeds ${MAX_MDX_MODULE_CODE_BYTES} bytes`);
  }

  const unresolved = hasUnresolvedImports(moduleCode);
  if (unresolved.count > 0) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Module has ${unresolved.count} unresolved imports, skipping cache`,
      { path: normalizedPath, unresolved: unresolved.paths },
    );
    return null;
  }

  // Derive the artifact identity from portable code so every pod computes the
  // same filename after cache-path tokenization. This also lets distributed
  // recovery verify that the payload belongs to the requested filename.
  const portableCode = tokenizeAllVeryFrontPaths(moduleCode);
  const contentHash = hashString(normalizedPath + portableCode);
  const cachePath = join(esmCacheDir, buildMdxEsmModuleFileName(contentHash));
  const pathCacheKey = buildMdxEsmPathCacheKey(
    normalizedPath,
    reactVersion,
    sourceContentHash,
    importMapFingerprint,
    getMdxModuleCacheVariant(dependencyPinningCacheKey, moduleServerOrigin),
  );

  const localFs = getLocalFs();
  try {
    const stat = await localFs.stat(cachePath);
    if (stat?.isFile) {
      pathCache.set(pathCacheKey, cachePath);
      log.debug(`${LOG_PREFIX_MDX_LOADER} Content cache hit: ${normalizedPath}`);
      recordModuleToSession(normalizedPath);
      return cachePath;
    }
  } catch (_) {
    /* expected: cached file may not exist yet */
  }

  await localFs.mkdir(esmCacheDir, { recursive: true });
  await localFs.writeTextFile(cachePath, moduleCode);
  pathCache.set(pathCacheKey, cachePath);
  await saveModulePathCache(esmCacheDir);
  log.debug(`${LOG_PREFIX_MDX_LOADER} Cached vf_module: ${normalizedPath} -> ${cachePath}`);

  recordModuleToSession(normalizedPath);
  return cachePath;
}
