import { join } from "#veryfront/compat/path";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { formatCacheVersionSegment } from "#veryfront/utils/cache-version.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import { hashString } from "./utils/hash.ts";

/**
 * Return the tenant-owned MDX ESM namespace directory.
 *
 * Both identifiers are represented by full SHA-256 digests. Raw identifiers
 * must never become path segments, and short hashes must never decide which
 * tenant directory an invalidation is allowed to delete.
 */
export function getMdxEsmSsrCacheDir(projectId: string, contentSourceId: string): string {
  return join(
    getMdxEsmCacheDir(),
    formatCacheVersionSegment(RUNTIME_VERSION),
    hashString(projectId),
    hashString(contentSourceId),
  );
}

/**
 * Targeted operations deliberately return only the current, attributable
 * namespace. Legacy raw/32-bit directories are handled exclusively by global
 * cache maintenance because their ownership cannot be proven safely.
 */
export function getMdxEsmSsrCacheDirs(projectId: string, contentSourceId: string): string[] {
  return [getMdxEsmSsrCacheDir(projectId, contentSourceId)];
}
