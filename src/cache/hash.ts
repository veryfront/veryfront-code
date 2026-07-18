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

import { computeHash } from "#veryfront/utils/hash-utils.ts";

export function hashString(input: string): string {
  // FNV-1a 64-bit. The previous 32-bit fold collides ~1% at 10k distinct inputs,
  // and these keys embed into module-response cache keys — a collision there
  // serves one module's cached body for another. BigInt keeps the arithmetic
  // exact across the full 64-bit range; base36 keeps keys compact and charset-safe.
  const FNV_OFFSET_BASIS = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK_64 = (1n << 64n) - 1n;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }

  return hash.toString(36);
}

export async function sha256Short(input: string): Promise<string> {
  return (await computeHash(input)).slice(0, 8);
}
