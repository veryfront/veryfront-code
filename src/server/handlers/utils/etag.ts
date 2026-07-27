import { HASH_SEED_DJB2 } from "#veryfront/utils";

function computeHash(content: string | Uint8Array): number {
  let hash = HASH_SEED_DJB2;

  if (typeof content === "string") {
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return hash >>> 0;
  }

  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ (content[i] ?? 0);
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

export function hasMatchingEtag(req: Request, etag: string): boolean {
  return matchesAnyEtag(etag, req.headers.get("if-none-match"));
}

export function parseIfNoneMatch(header: string | null): string[] {
  if (!header) return [];

  const tags: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index <= header.length; index++) {
    const character = header[index];
    if (character === '"') inQuotes = !inQuotes;
    if (index !== header.length && (character !== "," || inQuotes)) continue;

    const tag = header.slice(start, index).trim();
    if (tag) tags.push(tag);
    start = index + 1;
  }
  return tags;
}

export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const tags = parseIfNoneMatch(ifNoneMatch);
  if (tags.includes("*")) return true;

  const normalizedEtag = etag.replace(/^W\//i, "");
  return tags.some((tag) => tag.replace(/^W\//i, "") === normalizedEtag);
}
