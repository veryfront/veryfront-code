
import { computeEtag } from "../../utils/etag.ts";

function normalizeWeakEtag(hash: string): string {
  let value = hash.trim();

  if (value.length === 0) {
    return computeEtag("");
  }

  if (value.startsWith("W/")) {
    value = value.slice(2);
  }

  const unquoted = value.replace(/^"+|"+$/g, "").trim();
  const quoted = `"${unquoted}"`;

  return `W/${quoted}`;
}

export function computeSSRETag(ssrHash: string | undefined, html: string): string {
  if (ssrHash && ssrHash.length > 0) {
    return normalizeWeakEtag(ssrHash);
  }

  return computeEtag(html);
}
