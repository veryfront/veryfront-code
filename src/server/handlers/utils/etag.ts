/**
 * ETag utility functions
 */

import { HASH_SEED_DJB2 } from "@veryfront/utils";

/**
 * Compute ETag for a string using DJB2 hash
 */
export function computeEtag(text: string): string {
  let hash = HASH_SEED_DJB2;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return `W/"${(hash >>> 0).toString(16)}"`;
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

  // Split by comma, trim whitespace, remove quotes
  return header
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Check if ETag matches any in If-None-Match
 */
export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);

  // Check for wildcard
  if (tags.includes("*")) return true;

  // Check for exact match
  return tags.includes(etag);
}

/**
 * Generate strong ETag (without W/ prefix)
 */
export function computeStrongEtag(text: string): string {
  let hash = HASH_SEED_DJB2;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}
