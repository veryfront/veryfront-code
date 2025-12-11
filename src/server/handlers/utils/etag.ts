
import { HASH_SEED_DJB2 } from "@veryfront/utils";

function hashString(text: string): number {
  let hash = HASH_SEED_DJB2;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return hash >>> 0;
}

function hashBytes(bytes: Uint8Array): number {
  let hash = HASH_SEED_DJB2;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) + hash) ^ bytes[i]!;
  }
  return hash >>> 0;
}

export function computeEtag(content: string | Uint8Array): string {
  const hash = typeof content === "string" ? hashString(content) : hashBytes(content);
  return `W/"${hash.toString(16)}"`;
}

export function hasMatchingEtag(req: Request, etag: string): boolean {
  return req.headers.get("if-none-match") === etag;
}

export function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];

  return header
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);

  if (tags.includes("*")) return true;

  return tags.includes(etag);
}

export function computeStrongEtag(content: string | Uint8Array): string {
  const hash = typeof content === "string" ? hashString(content) : hashBytes(content);
  return `"${hash.toString(16)}"`;
}
