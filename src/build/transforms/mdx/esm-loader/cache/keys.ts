/**
 * Cache Key Utilities
 *
 * Hash functions and cache key generation for ESM modules.
 *
 * @module build/transforms/mdx/esm-loader/cache/keys
 */

/** FNV-1a seed constant */
const HASH_SEED_FNV1A = 2166136261;

/**
 * Generate a short hash from a string using FNV-1a algorithm.
 * Used to create unique filenames for cached modules.
 */
export function hashString(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
