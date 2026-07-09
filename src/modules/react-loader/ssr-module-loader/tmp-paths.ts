/**
 * Temp directory and temp file path helpers for SSR module loader cache.
 */

import { join } from "#veryfront/compat/path/index.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";

export function getTmpDirCacheKey(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): string {
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  const projectKey = hashCodeHex(projectId);
  const sourceKey = hashCodeHex(contentSourceId);
  return `${baseCacheDir}|${versionKey}|${projectKey}|${sourceKey}`;
}

export function buildTmpDirPath(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): string {
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  const projectKey = hashCodeHex(projectId);
  const sourceKey = hashCodeHex(contentSourceId);
  return join(baseCacheDir, versionKey, projectKey, sourceKey);
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

  const versionPrefix = formatCacheVersionSegment(version).replace(/^v/, "");
  const hashSuffix = contentHash
    ? `.v${versionPrefix}.${contentHash.slice(0, 8)}`
    : `.v${versionPrefix}`;
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
  return join(tmpDir, jsPath);
}
