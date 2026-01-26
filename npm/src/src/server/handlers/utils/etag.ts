import * as dntShim from "../../../../_dnt.shims.js";
import { HASH_SEED_DJB2 } from "../../../utils/index.js";

function computeHash(content: string | Uint8Array): number {
  let hash = HASH_SEED_DJB2;

  if (typeof content === "string") {
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return hash >>> 0;
  }

  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content[i]!;
  }

  return hash >>> 0;
}

export function computeEtag(content: string | Uint8Array, weak = true): string {
  const hash = computeHash(content).toString(16);
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

export function computeStrongEtag(content: string | Uint8Array): string {
  return computeEtag(content, false);
}

export function hasMatchingEtag(req: dntShim.Request, etag: string): boolean {
  return req.headers.get("if-none-match") === etag;
}

export function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);
  return tags.includes("*") || tags.includes(etag);
}
