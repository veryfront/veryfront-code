function contentBytes(content: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return new Uint8Array(content);
}

async function computeDigest(content: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", contentBytes(content));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function computeEtag(content: string | Uint8Array, weak = true): Promise<string> {
  const digest = await computeDigest(content);
  return weak ? `W/"${digest}"` : `"${digest}"`;
}

export function computeStrongEtag(content: string | Uint8Array): Promise<string> {
  return computeEtag(content, false);
}

export function hasMatchingEtag(req: Request, etag: string): boolean {
  return matchesAnyEtag(etag, req.headers.get("if-none-match"));
}

export function parseIfNoneMatch(header: string | null): string[] {
  if (!header || header.length > MAX_IF_NONE_MATCH_LENGTH) return [];

  const tags: string[] = [];
  let start = 0;
  let inQuotes = false;

  for (let index = 0; index < header.length; index++) {
    const character = header[index];
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (character !== "," || inQuotes) continue;

    const tag = header.slice(start, index).trim();
    if (tag) tags.push(tag);
    start = index + 1;
  }

  const finalTag = header.slice(start).trim();
  if (finalTag) tags.push(finalTag);
  return tags;
}

function weakOpaqueTag(etag: string): string | null {
  const trimmed = etag.trim();
  const value = trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return null;

  for (let index = 1; index < value.length - 1; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code < 0x21 || code === 0x7f || code > 0xff) return null;
  }

  return value;
}

export function matchesAnyEtag(etag: string, ifNoneMatch: string | null): boolean {
  const opaqueTag = weakOpaqueTag(etag);
  if (!opaqueTag) return false;
  if (ifNoneMatch === null || ifNoneMatch.length > MAX_IF_NONE_MATCH_LENGTH) return false;
  if (ifNoneMatch.trim() === "*") return true;

  const tags = parseIfNoneMatch(ifNoneMatch);
  let matched = false;
  for (const candidate of tags) {
    const candidateTag = weakOpaqueTag(candidate);
    if (!candidateTag) return false;
    if (candidateTag === opaqueTag) matched = true;
  }
  return matched;
}
const MAX_IF_NONE_MATCH_LENGTH = 8 * 1024;
