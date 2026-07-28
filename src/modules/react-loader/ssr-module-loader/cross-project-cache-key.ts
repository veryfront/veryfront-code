import { encodeCacheKeySegment } from "#veryfront/cache/keys/segment-codec.ts";

const CROSS_PROJECT_CACHE_KEY_PREFIX = "ssr-cross-project:v2:";
const MAX_CACHE_IDENTITY_LENGTH = 32 * 1024;

function assertCacheIdentity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CACHE_IDENTITY_LENGTH
  ) {
    throw new RangeError(
      `${label} must contain 1 to ${MAX_CACHE_IDENTITY_LENGTH} characters`,
    );
  }
  return value;
}

export interface CrossProjectImportCacheKeyOptions {
  specifier: string;
  projectId: string;
  reactVersion?: string;
  registryBaseUrl: string;
  importMapFingerprint?: string;
}

/**
 * Build an injective cache identity for one transformed cross-project module.
 *
 * Every caller-controlled field is encoded independently so delimiters inside
 * project IDs, specifiers, URLs, or fingerprints cannot alias another entry.
 */
export function buildCrossProjectImportCacheKey(
  options: CrossProjectImportCacheKeyOptions,
): string {
  const reactVersion = options.reactVersion ?? "default";
  const importMapFingerprint = options.importMapFingerprint ?? "default";
  return `${CROSS_PROJECT_CACHE_KEY_PREFIX}${
    encodeCacheKeySegment(assertCacheIdentity(options.projectId, "Project ID"))
  }:${encodeCacheKeySegment(assertCacheIdentity(options.specifier, "Import specifier"))}:${
    encodeCacheKeySegment(assertCacheIdentity(reactVersion, "React version"))
  }:${
    encodeCacheKeySegment(
      assertCacheIdentity(options.registryBaseUrl, "Registry base URL"),
    )
  }:${
    encodeCacheKeySegment(
      assertCacheIdentity(importMapFingerprint, "Import-map fingerprint"),
    )
  }`;
}

/** Return true only for a v2 cross-project key owned by the exact project. */
export function isCrossProjectCacheKeyForProject(
  cacheKey: string,
  projectId: string,
): boolean {
  const parts = cacheKey.split(":");
  return parts.length === 7 &&
    `${parts[0]}:${parts[1]}:` === CROSS_PROJECT_CACHE_KEY_PREFIX &&
    parts[2] === encodeCacheKeySegment(
        assertCacheIdentity(projectId, "Project ID"),
      );
}
