/**
 * Hash Utilities
 *
 * Fast string hashing for cache keys.
 *
 * @module build/transforms/mdx/esm-module-loader/utils/hash
 */

import { HASH_SEED_FNV1A } from "../constants.ts";

/**
 * Hash a string using FNV-1a algorithm.
 * Returns a hex string.
 */
export function hashString(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
