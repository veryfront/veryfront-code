/**
 * ETag utility functions
 */

import { HASH_SEED_DJB2 } from "@veryfront/utils";

/**
 * Compute DJB2 hash for content (string or bytes).
 */
function computeHash(content: string | Uint8Array): number {
  let hash = HASH_SEED_DJB2;
  const length = content.length;

  if (typeof content === "string") {
    for (let i = 0; i < length; i++) {
      hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
  } else {
    for (let i = 0; i < length; i++) {
      hash = ((hash << 5) + hash) ^ content[i]!;
    }
  }

  return hash >>> 0;
}

/**
 * Generate ETag from content hash
 * @param weak - If true, generates weak ETag with W/ prefix (default: true)
 */
export function computeEtag(content: string | Uint8Array, weak = true): string {
  const hash = computeHash(content).toString(16);
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Generate strong ETag (without W/ prefix)
 */
export function computeStrongEtag(content: string | Uint8Array): string {
  return computeEtag(content, false);
}

/**
 * Check if request has matching ETag
 */
export function hasMatchingEtag(req: Request, etag: string): boolean {
  return req.headers.get("if-none-match") === etag;
}

/**
 * Parse ETags from If-None-Match header
 */
export function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];
  return header.split(",").map((tag) => tag.trim()).filter(Boolean);
}

/**
 * Check if ETag matches any in If-None-Match
 */
export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);
  return tags.includes("*") || tags.includes(etag);
}
