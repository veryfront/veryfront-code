/**** ETag computation for SSR responses */

import { computeEtag } from "../../utils/etag.ts";

function normalizeWeakEtag(hash: string): string {
  const trimmed = hash.trim();
  if (!trimmed) return computeEtag("");

  const value = trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
  const unquoted = value.replace(/^"+|"+$/g, "").trim();

  return `W/"${unquoted}"`;
}

/** Compute ETag for SSR result (prefers ssrHash if available) */
export function computeSSRETag(ssrHash: string | undefined, html: string): string {
  if (ssrHash) return normalizeWeakEtag(ssrHash);
  return computeEtag(html);
}
