/**
 * Bounded filesystem helpers for cached HTTP bundles.
 *
 * @module transforms/esm/http-bundle-file
 */

import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";

/** Maximum number of HTTP bundles accepted in one dependency graph. */
export const MAX_HTTP_BUNDLE_GRAPH_ENTRIES = 500;

/**
 * Rewriting imports can expand a fetched module. Keep cached artifacts bounded
 * while allowing ample headroom over the four-MiB upstream response limit.
 */
export const MAX_CACHED_HTTP_BUNDLE_BYTES = MAX_BUNDLE_CHUNK_SIZE_BYTES * 4;

const bundleSizeEncoder = new TextEncoder();
const HTTP_BUNDLE_HASH_PATTERN = /^[a-f0-9]{1,64}$/i;

export interface CachedHttpBundleFile {
  code: string;
  sizeBytes: number;
}

/** Hashes are used in canonical cache filenames and must never contain path syntax. */
export function isValidHttpBundleHash(hash: string): boolean {
  return HTTP_BUNDLE_HASH_PATTERN.test(hash);
}

/** Measure the exact UTF-8 bytes that writeTextFile will persist. */
export function getHttpBundleCodeSizeBytes(code: string): number {
  return bundleSizeEncoder.encode(code).byteLength;
}

export function isHttpBundleCodeWithinLimit(code: string): boolean {
  return getHttpBundleCodeSizeBytes(code) <= MAX_CACHED_HTTP_BUNDLE_BYTES;
}

/**
 * Read a regular cached bundle with pre- and post-read byte bounds.
 *
 * The post-read check closes the race where a file grows between stat and read.
 * Operational failures are represented as null so cache callers can invalidate
 * or recover the artifact without confusing a cache miss with valid code.
 */
export async function readCachedHttpBundleFile(
  fs: FileSystem,
  path: string,
): Promise<CachedHttpBundleFile | null> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile || stat.size > MAX_CACHED_HTTP_BUNDLE_BYTES) return null;

    const code = await fs.readTextFile(path);
    const sizeBytes = getHttpBundleCodeSizeBytes(code);
    if (sizeBytes > MAX_CACHED_HTTP_BUNDLE_BYTES) return null;

    return { code, sizeBytes };
  } catch {
    return null;
  }
}
