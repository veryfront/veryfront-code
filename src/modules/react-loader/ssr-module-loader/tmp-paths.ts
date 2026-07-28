/**
 * Temp directory and temp file path helpers for SSR module loader cache.
 */

import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { encodeCacheKeySegment } from "#veryfront/cache/keys/segment-codec.ts";
import { resolveProjectRelativePath } from "../path-resolver.ts";

const TMP_DIR_CACHE_KEY_PREFIX = "ssr-tmp-dir:v2:";
const MAX_TMP_IDENTITY_LENGTH = 32 * 1024;

function assertTmpIdentity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TMP_IDENTITY_LENGTH
  ) {
    throw new RangeError(
      `${label} must contain 1 to ${MAX_TMP_IDENTITY_LENGTH} characters`,
    );
  }
  return value;
}

export function getTmpDirCacheKey(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): string {
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  return `${TMP_DIR_CACHE_KEY_PREFIX}${
    encodeCacheKeySegment(assertTmpIdentity(baseCacheDir, "Base cache directory"))
  }:${encodeCacheKeySegment(versionKey)}:${
    encodeCacheKeySegment(assertTmpIdentity(projectId, "Project ID"))
  }:${encodeCacheKeySegment(assertTmpIdentity(contentSourceId, "Content source ID"))}`;
}

export function isTmpDirCacheKeyForProject(
  cacheKey: string,
  projectId: string,
): boolean {
  const parts = cacheKey.split(":");
  return parts.length === 6 &&
    `${parts[0]}:${parts[1]}:` === TMP_DIR_CACHE_KEY_PREFIX &&
    parts[4] === encodeCacheKeySegment(
        assertTmpIdentity(projectId, "Project ID"),
      );
}

export async function buildTmpDirPath(
  baseCacheDir: string,
  projectId: string,
  contentSourceId: string,
  runtimeVersion: string = RUNTIME_VERSION,
): Promise<string> {
  const versionKey = formatCacheVersionSegment(runtimeVersion);
  const [projectKey, sourceKey] = await Promise.all([
    computeHash(
      `veryfront:ssr-tmp-project:v2\0${assertTmpIdentity(projectId, "Project ID")}`,
    ),
    computeHash(
      `veryfront:ssr-tmp-source:v2\0${assertTmpIdentity(contentSourceId, "Content source ID")}`,
    ),
  ]);
  return join(baseCacheDir, versionKey, projectKey, sourceKey);
}

export function buildTempModulePath(
  tmpDir: string,
  filePath: string,
  projectDir: string,
  version: string,
  contentHash?: string,
): string {
  if (
    contentHash !== undefined &&
    !/^[a-f0-9]{8,128}$/.test(contentHash)
  ) {
    throw new TypeError(
      "SSR module content hash must be 8 to 128 lowercase hexadecimal characters",
    );
  }

  let relativePath: string;
  try {
    relativePath = resolveProjectRelativePath(filePath, projectDir);
  } catch (error) {
    // Compiled framework sources live outside the project checkout. Their
    // transformed content digest is the complete cache identity, so place
    // them in a dedicated namespace without retaining an arbitrary host path.
    if (!isAbsolute(filePath) || contentHash === undefined) throw error;
    relativePath = "__external__/module";
  }
  if (!relativePath) {
    throw new TypeError("SSR module path must identify a file beneath the project root");
  }

  const versionPrefix = formatCacheVersionSegment(version).replace(/^v/, "");
  const hashSuffix = contentHash ? `.v${versionPrefix}.${contentHash}` : `.v${versionPrefix}`;
  const sourceExtension = /\.(?:[cm]?[jt]sx?|mdx)(?:\.src)?$/;
  const jsPath = sourceExtension.test(relativePath)
    ? relativePath.replace(sourceExtension, `${hashSuffix}.js`)
    : `${relativePath}${hashSuffix}.js`;
  return join(tmpDir, jsPath);
}
