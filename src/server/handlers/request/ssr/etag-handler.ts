/**
 * ETag Handler
 *
 * Handles ETag computation and 304 Not Modified responses for SSR.
 * Improves performance by avoiding re-sending unchanged content.
 *
 * @module server/handlers/request/ssr/etag-handler
 */

import { computeEtag } from "../../utils/etag.ts";

function normalizeWeakEtag(hash: string): string {
  let value = hash.trim();

  if (value.length === 0) {
    return computeEtag("");
  }

  if (value.startsWith("W/")) {
    value = value.slice(2);
  }

  // Strip surrounding quotes to avoid duplication
  const unquoted = value.replace(/^"+|"+$/g, "").trim();
  const quoted = `"${unquoted}"`;

  return `W/${quoted}`;
}

/**
 * Compute ETag for SSR result
 *
 * Prioritizes ssrHash if available, falls back to computing from HTML.
 * The ssrHash is more efficient as it's pre-computed during rendering.
 *
 * @param ssrHash - Pre-computed hash from SSR (optional)
 * @param html - HTML content to hash if ssrHash unavailable
 * @returns ETag string
 *
 * @example
 * ```typescript
 * const etag = computeSSRETag(result.ssrHash, result.html);
 * // Returns: "abc123..." or computed hash from HTML
 * ```
 */
export function computeSSRETag(ssrHash: string | undefined, html: string): string {
  if (ssrHash && ssrHash.length > 0) {
    return normalizeWeakEtag(ssrHash);
  }

  return computeEtag(html);
}
