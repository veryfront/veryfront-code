/**************************
 * Standardized Cache Hashing Utilities
 *
 * Provides consistent hashing for cache keys across the codebase.
 * All cache keys should use these utilities to ensure:
 * - Consistent format with type prefixes
 * - Collision resistance between different cache types
 * - Easy debugging and key parsing
 *
 * Key format: `{type}:{hash}` or `{type}:{version}:{hash}`
 *
 * @module cache/hash
 **************************/

import { computeHash, simpleHash } from "#veryfront/utils/hash-utils.ts";

type CacheKeyType =
  | "http"
  | "mod"
  | "esm"
  | "render"
  | "mdx"
  | "css"
  | "file"
  | "config";

export function fastHash(input: string): number {
  let hash = 5381;

  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }

  return hash >>> 0;
}

export function hashToString(hash: number): string {
  return hash.toString(36);
}

export function hashString(input: string): string {
  return hashToString(fastHash(input));
}

export function getCacheKey(type: CacheKeyType, input: string): string {
  return `${type}:${hashString(input)}`;
}

export function getVersionedCacheKey(
  type: CacheKeyType,
  version: number | string,
  input: string,
): string {
  return `${type}:v${version}:${hashString(input)}`;
}

export function getCompoundCacheKey(type: CacheKeyType, components: string[]): string {
  return getCacheKey(type, components.join(":"));
}

export function parseCacheKey(
  key: string,
): { type: string; hash: string; version?: string } | null {
  const [type, ...rest] = key.split(":");
  if (!type || rest.length === 0) return null;

  const [maybeVersion, ...hashParts] = rest;

  if (maybeVersion?.startsWith("v") && /^v\d+$/.test(maybeVersion)) {
    return { type, version: maybeVersion.slice(1), hash: hashParts.join(":") };
  }

  return { type, hash: rest.join(":") };
}

export const sha256Hash = computeHash;

export async function sha256Short(input: string): Promise<string> {
  return (await sha256Hash(input)).slice(0, 8);
}

export function getHttpBundleFilename(normalizedUrl: string): string {
  return `http-${simpleHash(normalizedUrl)}.mjs`;
}

export function parseHttpBundleFilename(filename: string): string | null {
  return filename.match(/^http-(\d+)\.mjs$/)?.[1] ?? null;
}

export function isCacheKey(value: string): boolean {
  return /^[a-z]+:[a-z0-9]+/.test(value);
}
