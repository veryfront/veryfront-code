/**
 * Distributed recovery for missing MDX ESM module dependencies.
 *
 * Restores missing vfmod files on fresh pods from the distributed transform
 * cache, scoped to the current project and content source.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery
 */

import { basename, dirname, resolve } from "#veryfront/compat/path/index.ts";
import { detokenizeAllCachePaths } from "#veryfront/cache/paths.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import type { Logger } from "#veryfront/utils";
import { getDistributedTransformBackend } from "#veryfront/transforms/esm/transform-cache.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs } from "../cache/local-fs.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";
import { getMdxEsmSsrCacheDir } from "../cache-paths.ts";
import {
  MAX_MDX_MODULE_CODE_BYTES,
  MAX_MDX_RECOVERY_DEPTH,
  MAX_MDX_RECOVERY_MODULES,
  MAX_MDX_RECOVERY_TOTAL_BYTES,
  parseMdxModuleRecoveryPayload,
  utf8ByteLength,
} from "./recovery-payload.ts";

// Captures the filesystem path from `file://` URLs that point to veryfront-mdx-esm
// cache entries.  The character class excludes only quote characters (the
// delimiters used in JS source) so that paths containing spaces — e.g. under a
// home directory like `/Users/John Doe/…` — are captured in full.
const MDX_VFMOD_FILE_URL_PATTERN_SOURCE = /file:\/\/([^"']+veryfront-mdx-esm\/[^"']+\.mjs)/gi
  .source;

interface EnsureMdxModuleDependenciesOptions {
  projectId: string;
  contentSourceId: string;
  log: Logger;
  distributedCache?: CacheBackend | null;
}

interface EnsureMdxModuleDependenciesResult {
  recovered: string[];
  missing: string[];
}

interface RecoveryState {
  visited: Set<string>;
  recovered: Set<string>;
  recoveredBytes: number;
}

function extractMdxModuleDependencyPaths(code: string): string[] {
  if (utf8ByteLength(code) > MAX_MDX_MODULE_CODE_BYTES) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(MDX_VFMOD_FILE_URL_PATTERN_SOURCE, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const cleanPath = rawPath.replace(/\?.*$/, "");
    if (seen.has(cleanPath)) continue;
    seen.add(cleanPath);
    paths.push(cleanPath);
    if (paths.length > MAX_MDX_RECOVERY_MODULES) break;
  }
  return paths;
}

function isOwnedModulePath(absolutePath: string, tenantCacheDir: string): boolean {
  if (absolutePath.split(/[\\/]/).some((segment) => segment === "." || segment === "..")) {
    return false;
  }
  const resolvedPath = resolve(absolutePath);
  const resolvedTenantDir = resolve(tenantCacheDir);
  return dirname(resolvedPath) === resolvedTenantDir && basename(resolvedPath) === basename(absolutePath);
}

async function ensureHttpBundleDependencies(code: string, log: Logger): Promise<boolean> {
  const bundlePaths = extractHttpBundlePaths(code);
  if (bundlePaths.length === 0) return true;

  const failed = await ensureHttpBundlesExist(bundlePaths, getHttpBundleCacheDir());
  if (failed.length === 0) return true;

  log.warn(`${LOG_PREFIX_MDX_LOADER} Failed to recover HTTP bundles for vfmod dependency`, {
    failed,
    totalBundles: bundlePaths.length,
  });
  return false;
}

async function ensureModuleFileAndDeps(
  absolutePath: string,
  tenantCacheDir: string,
  distributedCache: CacheBackend,
  options: EnsureMdxModuleDependenciesOptions,
  state: RecoveryState,
  depth: number,
): Promise<boolean> {
  if (depth > MAX_MDX_RECOVERY_DEPTH) return false;
  if (!isOwnedModulePath(absolutePath, tenantCacheDir)) {
    options.log.warn(`${LOG_PREFIX_MDX_LOADER} Rejected out-of-namespace vfmod recovery path`, {
      dependencyPath: absolutePath,
      tenantCacheDir,
    });
    return false;
  }

  const resolvedPath = resolve(absolutePath);
  if (state.visited.has(resolvedPath)) return true;
  if (state.visited.size >= MAX_MDX_RECOVERY_MODULES) return false;
  state.visited.add(resolvedPath);

  const localFs = getLocalFs();

  try {
    const lstat = localFs.lstat ? await localFs.lstat(resolvedPath) : await localFs.stat(resolvedPath);
    if (lstat?.isSymlink) return false;
    if (lstat?.isFile) {
      if ((lstat.size ?? 0) > MAX_MDX_MODULE_CODE_BYTES) return false;
      const existingCode = await localFs.readTextFile(resolvedPath);
      if (utf8ByteLength(existingCode) > MAX_MDX_MODULE_CODE_BYTES) return false;
      if (!(await ensureHttpBundleDependencies(existingCode, options.log))) return false;

      for (const nestedPath of extractMdxModuleDependencyPaths(existingCode)) {
        if (
          !(await ensureModuleFileAndDeps(
            nestedPath,
            tenantCacheDir,
            distributedCache,
            options,
            state,
            depth + 1,
          ))
        ) {
          return false;
        }
      }

      return true;
    }
  } catch (_) {
    /* expected: dependency may not exist on this pod yet */
  }

  const recoveryKey = buildMdxEsmModuleRecoveryCacheKey(
    options.projectId,
    options.contentSourceId,
    basename(resolvedPath),
  );

  const serializedPayload = await distributedCache.get(recoveryKey);
  if (!serializedPayload) {
    options.log.debug(`${LOG_PREFIX_MDX_LOADER} No distributed vfmod recovery entry`, {
      dependencyPath: absolutePath,
      recoveryKey,
    });
    return false;
  }

  const payload = parseMdxModuleRecoveryPayload(serializedPayload, {
    projectId: options.projectId,
    contentSourceId: options.contentSourceId,
    fileName: basename(resolvedPath),
  });
  if (!payload) {
    options.log.warn(`${LOG_PREFIX_MDX_LOADER} Rejected invalid vfmod recovery payload`, {
      dependencyPath: resolvedPath,
      recoveryKey,
    });
    return false;
  }

  const recoveredCode = detokenizeAllCachePaths(payload.portableCode);
  const recoveredBytes = utf8ByteLength(recoveredCode);
  if (
    recoveredBytes > MAX_MDX_MODULE_CODE_BYTES ||
    state.recoveredBytes + recoveredBytes > MAX_MDX_RECOVERY_TOTAL_BYTES
  ) {
    return false;
  }
  if (!(await ensureHttpBundleDependencies(recoveredCode, options.log))) return false;

  for (const nestedPath of extractMdxModuleDependencyPaths(recoveredCode)) {
    if (
      !(await ensureModuleFileAndDeps(
        nestedPath,
        tenantCacheDir,
        distributedCache,
        options,
        state,
        depth + 1,
      ))
    ) {
      return false;
    }
  }

  await localFs.mkdir(tenantCacheDir, { recursive: true });
  await localFs.writeTextFile(resolvedPath, recoveredCode);
  state.recovered.add(resolvedPath);
  state.recoveredBytes += recoveredBytes;

  options.log.debug(`${LOG_PREFIX_MDX_LOADER} Recovered vfmod dependency from distributed cache`, {
    dependencyPath: resolvedPath,
    recoveryKey,
  });

  return true;
}

export async function ensureMdxModuleDependencies(
  code: string,
  options: EnsureMdxModuleDependenciesOptions,
): Promise<EnsureMdxModuleDependenciesResult> {
  const distributedCache = options.distributedCache ?? (await getDistributedTransformBackend());
  if (!distributedCache) return { recovered: [], missing: extractMdxModuleDependencyPaths(code) };

  if (utf8ByteLength(code) > MAX_MDX_MODULE_CODE_BYTES) {
    options.log.warn(`${LOG_PREFIX_MDX_LOADER} Skipped recovery for oversized module code`);
    return { recovered: [], missing: [] };
  }

  const tenantCacheDir = getMdxEsmSsrCacheDir(options.projectId, options.contentSourceId);
  const state: RecoveryState = {
    visited: new Set<string>(),
    recovered: new Set<string>(),
    recoveredBytes: 0,
  };
  const missing: string[] = [];

  for (const dependencyPath of extractMdxModuleDependencyPaths(code)) {
    const ok = await ensureModuleFileAndDeps(
      dependencyPath,
      tenantCacheDir,
      distributedCache,
      options,
      state,
      0,
    );
    if (!ok) missing.push(dependencyPath);
  }

  return {
    recovered: [...state.recovered],
    missing,
  };
}
