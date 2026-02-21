/**
 * Temp directory and temp file path helpers for SSR module loader cache.
 */

import { join } from "#veryfront/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";

export function getTmpDirCacheKey(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
): string {
  const projectKey = hashCodeHex(projectId);
  return `${baseCacheDir}|${projectKey}|${contentSourceId}`;
}

export function buildTmpDirPath(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
): string {
  const projectKey = hashCodeHex(projectId);
  return join(baseCacheDir, projectKey, contentSourceId);
}

export function buildTempModulePath(
  tmpDir: string,
  filePath: string,
  projectDir: string,
  version: string,
  contentHash?: string,
): string {
  const normalizedProjectDir = projectDir.replace(/\/$/, "");
  const relativePath = filePath.startsWith(normalizedProjectDir)
    ? filePath.substring(normalizedProjectDir.length)
    : filePath;

  const versionPrefix = version.replace(/\./g, "-");
  const hashSuffix = contentHash
    ? `.v${versionPrefix}.${contentHash.slice(0, 8)}`
    : `.v${versionPrefix}`;
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
  return join(tmpDir, jsPath);
}
