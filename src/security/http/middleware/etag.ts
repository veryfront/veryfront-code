/**
 * ETag computation utilities
 *
 * @module security/middleware/etag
 */

import { HASH_SEED_DJB2 } from "@veryfront/utils/constants/hash.ts";

/**
 * Compute ETag for content using DJB2 hash algorithm
 *
 * Generates a weak ETag (W/"...") using a fast DJB2 hash.
 * This is suitable for caching validation but not cryptographic purposes.
 *
 * @param text - Content to hash
 * @returns Weak ETag header value
 *
 * @example
 * ```ts
 * const etag = computeEtag('<html>...</html>')
 * headers.set('ETag', etag)
 * // ETag: W/"a3f2d1c4"
 * ```
 */
export function computeEtag(text: string): string {
  let h = HASH_SEED_DJB2;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return `W/"${(h >>> 0).toString(16)}"`;
}
