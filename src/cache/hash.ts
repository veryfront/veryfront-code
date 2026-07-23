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

import { encodeCacheHashInput } from "./validation.ts";

export function hashString(input: string): string {
  // Two independently seeded FNV-1a passes provide a compact 128-bit identity.
  // Cache hashes can select executable module bodies, so a 32- or 64-bit
  // birthday bound is too small for a long-running multi-tenant process.
  const FNV_OFFSET_A = 14695981039346656037n;
  const FNV_OFFSET_B = 7809847782465536322n;
  const FNV_PRIME = 1099511628211n;
  const MASK_64 = (1n << 64n) - 1n;

  let left = FNV_OFFSET_A;
  let right = FNV_OFFSET_B;
  for (const rawByte of encodeCacheHashInput(input)) {
    const byte = BigInt(rawByte);
    left = ((left ^ byte) * FNV_PRIME) & MASK_64;
    right = ((right ^ (byte + 0x9en)) * FNV_PRIME) & MASK_64;
  }

  return left.toString(16).padStart(16, "0") + right.toString(16).padStart(16, "0");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encodeCacheHashInput(input));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256Short(input: string): Promise<string> {
  return (await sha256Hex(input)).slice(0, 32);
}
