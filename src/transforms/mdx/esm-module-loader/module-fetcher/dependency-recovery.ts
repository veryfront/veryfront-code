/**
 * Distributed recovery for missing MDX ESM module dependencies.
 *
 * Restores missing vfmod files on fresh pods from the distributed transform
 * cache, scoped to the current project and content source.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery
 */

import { basename, dirname } from "#veryfront/compat/path/index.ts";
import { detokenizeAllCachePaths } from "#veryfront/cache";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { getDistributedTransformBackend } from "#veryfront/transforms/esm/transform-cache.ts";
import { ensureHttpBundlesExist } from "#veryfront/transforms/esm/http-cache.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { getLocalFs } from "../cache/index.ts";
import { buildMdxEsmModuleRecoveryCacheKey } from "../cache-format.ts";

const MDX_VFMOD_FILE_URL_PATTERN = /file:\/\/([^"'\s]+veryfront-mdx-esm\/[^"'\s]+\.mjs)/gi;

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

function extractMdxModuleDependencyPaths(code: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MDX_VFMOD_FILE_URL_PATTERN.exec(code)) !== null) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const cleanPath = rawPath.replace(/\?.*$/, "");
    if (seen.has(cleanPath)) continue;
    seen.add(cleanPath);
    paths.push(cleanPath);
  }
  return paths;
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
  distributedCache: CacheBackend,
  options: EnsureMdxModuleDependenciesOptions,
  visited: Set<string>,
  recovered: Set<string>,
): Promise<boolean> {
  if (visited.has(absolutePath)) return true;
  visited.add(absolutePath);

  const localFs = getLocalFs();

  try {
    const stat = await localFs.stat(absolutePath);
    if (stat?.isFile) {
      const existingCode = await localFs.readTextFile(absolutePath);
      if (!(await ensureHttpBundleDependencies(existingCode, options.log))) return false;

      for (const nestedPath of extractMdxModuleDependencyPaths(existingCode)) {
        if (
          !(await ensureModuleFileAndDeps(
            nestedPath,
            distributedCache,
            options,
            visited,
            recovered,
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
    basename(absolutePath),
  );

  const portableCode = await distributedCache.get(recoveryKey);
  if (!portableCode) {
    options.log.debug(`${LOG_PREFIX_MDX_LOADER} No distributed vfmod recovery entry`, {
      dependencyPath: absolutePath,
      recoveryKey,
    });
    return false;
  }

  const recoveredCode = detokenizeAllCachePaths(portableCode);
  if (!(await ensureHttpBundleDependencies(recoveredCode, options.log))) return false;

  for (const nestedPath of extractMdxModuleDependencyPaths(recoveredCode)) {
    if (
      !(await ensureModuleFileAndDeps(
        nestedPath,
        distributedCache,
        options,
        visited,
        recovered,
      ))
    ) {
      return false;
    }
  }

  await localFs.mkdir(dirname(absolutePath), { recursive: true });
  await localFs.writeTextFile(absolutePath, recoveredCode);
  recovered.add(absolutePath);

  options.log.debug(`${LOG_PREFIX_MDX_LOADER} Recovered vfmod dependency from distributed cache`, {
    dependencyPath: absolutePath,
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

  const visited = new Set<string>();
  const recovered = new Set<string>();
  const missing: string[] = [];

  for (const dependencyPath of extractMdxModuleDependencyPaths(code)) {
    const ok = await ensureModuleFileAndDeps(
      dependencyPath,
      distributedCache,
      options,
      visited,
      recovered,
    );
    if (!ok) missing.push(dependencyPath);
  }

  return {
    recovered: [...recovered],
    missing,
  };
}
