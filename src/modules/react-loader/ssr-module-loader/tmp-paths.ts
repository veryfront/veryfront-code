/**
 * Temp directory and temp file path helpers for SSR module loader cache.
 */

import { basename, isAbsolute, join, normalize, relative } from "#veryfront/compat/path/index.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_TEMP_PATH_INPUT_LENGTH = 8_192;

function validateTempPathInput(value: string, label: string): void {
  if (
    value.length === 0 || value.length > MAX_TEMP_PATH_INPUT_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
}

export function getTmpDirCacheKey(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): string {
  for (
    const [value, label] of [
      [baseCacheDir, "baseCacheDir"],
      [projectId, "projectId"],
      [contentSourceId, "contentSourceId"],
      [runtimeVersion, "runtimeVersion"],
    ] as const
  ) {
    validateTempPathInput(value, label);
  }
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  const projectKey = hashString(projectId);
  const sourceKey = hashString(contentSourceId);
  return JSON.stringify([baseCacheDir, versionKey, projectKey, sourceKey]);
}

export function buildTmpDirPath(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): string {
  for (
    const [value, label] of [
      [baseCacheDir, "baseCacheDir"],
      [projectId, "projectId"],
      [contentSourceId, "contentSourceId"],
      [runtimeVersion, "runtimeVersion"],
    ] as const
  ) {
    validateTempPathInput(value, label);
  }
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  const projectKey = hashString(projectId);
  const sourceKey = hashString(contentSourceId);
  return join(baseCacheDir, versionKey, projectKey, sourceKey);
}

export function buildTempModulePath(
  tmpDir: string,
  filePath: string,
  projectDir: string,
  version: string,
  contentHash?: string,
): string {
  for (
    const [value, label] of [
      [tmpDir, "tmpDir"],
      [filePath, "filePath"],
      [projectDir, "projectDir"],
      [version, "version"],
    ] as const
  ) {
    validateTempPathInput(value, label);
  }
  if (
    contentHash !== undefined &&
    (contentHash.length < 16 || contentHash.length > 128 || !/^[a-f0-9]+$/i.test(contentHash))
  ) {
    throw new TypeError("contentHash is invalid");
  }

  const normalizedProjectDir = normalize(projectDir.replace(/\\/g, "/"));
  const normalizedFilePath = normalize(filePath.replace(/\\/g, "/"));
  let relativePath: string;

  if (isAbsolute(normalizedFilePath)) {
    const projectRelativePath = relative(normalizedProjectDir, normalizedFilePath);
    const isInProject = projectRelativePath === "" ||
      (projectRelativePath !== ".." &&
        !projectRelativePath.startsWith("../") &&
        !projectRelativePath.startsWith("..\\") &&
        !isAbsolute(projectRelativePath));
    relativePath = isInProject
      ? projectRelativePath
      : join("_external", hashString(filePath), basename(normalizedFilePath));
  } else if (
    normalizedFilePath === ".." ||
    normalizedFilePath.startsWith("../") ||
    normalizedFilePath.startsWith("..\\")
  ) {
    relativePath = join("_external", hashString(filePath), basename(normalizedFilePath));
  } else {
    relativePath = normalizedFilePath;
  }

  const versionPrefix = formatCacheVersionSegment(version).replace(/^v/, "");
  const hashSuffix = contentHash ? `.v${versionPrefix}.${contentHash}` : `.v${versionPrefix}`;
  const jsPath = /\.(?:[cm]?[jt]sx?|mdx)$/i.test(relativePath)
    ? relativePath.replace(/\.(?:[cm]?[jt]sx?|mdx)$/i, `${hashSuffix}.js`)
    : `${relativePath}${hashSuffix}.mjs`;
  const candidate = join(tmpDir, jsPath);
  const candidateRelativePath = relative(normalize(tmpDir), normalize(candidate));
  if (
    candidateRelativePath === ".." ||
    candidateRelativePath.startsWith("../") ||
    candidateRelativePath.startsWith("..\\") ||
    isAbsolute(candidateRelativePath)
  ) {
    return join(tmpDir, "_external", hashString(filePath), basename(jsPath));
  }
  return candidate;
}
