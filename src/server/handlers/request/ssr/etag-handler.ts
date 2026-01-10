/** ETag computation for SSR responses */

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

/** Compute ETag for SSR result (prefers ssrHash if available) */
export function computeSSRETag(ssrHash: string | undefined, html: string): string {
  return ssrHash ? normalizeWeakEtag(ssrHash) : computeEtag(html);
}
