import { MAX_STUDIO_CONFIG_PATH_LENGTH } from "../limits.ts";

export type StudioSourcePathKind = "project-relative" | "runtime";

const MAX_PERCENT_DECODE_ROUNDS = 32;
const RUNTIME_SOURCE_INPUT_FACTOR = 2;
const TRUNCATION_SUFFIX = "...[truncated]";

function hasUnsafePathCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x061c ||
      code === 0x200e || code === 0x200f || code === 0x2028 || code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x206f)
    ) return true;
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return true;
    index++;
  }
  return false;
}

function decodePathSegmentFully(segment: string): string | null {
  let decoded = segment;
  for (let round = 0; round < MAX_PERCENT_DECODE_ROUNDS; round++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return null;
}

function normalizePathSegment(segment: string, first: boolean): string | null {
  const decoded = decodePathSegmentFully(segment);
  if (!decoded || hasUnsafePathCodeUnit(decoded)) return null;

  let normalized: string;
  try {
    normalized = decoded.normalize("NFKC");
  } catch {
    return null;
  }
  if (
    !normalized || normalized === "." || normalized === ".." ||
    (first && normalized.startsWith("~")) ||
    (first && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) ||
    /[\\/?#<>'"]/.test(normalized) || hasUnsafePathCodeUnit(normalized)
  ) return null;
  return normalized;
}

function safeProjectRelativePath(value: string, maxLength: number): string | null {
  if (
    !value || value.length > maxLength || value !== value.trim() || value.startsWith("/") ||
    value.startsWith("\\")
  ) return null;

  const segments = value.split("/");
  for (let index = 0; index < segments.length; index++) {
    if (!normalizePathSegment(segments[index]!, index === 0)) return null;
  }
  return value;
}

function safeHttpPath(rawPath: string): boolean {
  if (!rawPath) return true;
  if (!rawPath.startsWith("/") || rawPath.includes("\\")) return false;
  for (const segment of rawPath.slice(1).split("/")) {
    if (segment && !normalizePathSegment(segment, false)) return false;
  }
  return true;
}

function firstSuffixIndex(value: string, start: number): number {
  const queryIndex = value.indexOf("?", start);
  const hashIndex = value.indexOf("#", start);
  if (queryIndex < 0) return hashIndex;
  if (hashIndex < 0) return queryIndex;
  return Math.min(queryIndex, hashIndex);
}

function sanitizeHttpSourceUrl(value: string): string | null {
  const schemeMatch = /^https?:\/\//i.exec(value);
  if (!schemeMatch) return null;

  const authorityStart = schemeMatch[0].length;
  const suffixIndex = firstSuffixIndex(value, authorityStart);
  const coreEnd = suffixIndex < 0 ? value.length : suffixIndex;
  const pathStart = value.indexOf("/", authorityStart);
  const authorityEnd = pathStart >= 0 && pathStart < coreEnd ? pathStart : coreEnd;
  const authority = value.slice(authorityStart, authorityEnd);
  let normalizedAuthority: string;
  try {
    normalizedAuthority = authority.normalize("NFKC");
  } catch {
    return null;
  }
  if (
    !authority || authority !== authority.trim() || authority.includes("@") ||
    authority.includes("\\") || /[@\\/?#]/.test(normalizedAuthority) ||
    hasUnsafePathCodeUnit(authority)
  ) return null;

  const rawPath = pathStart >= 0 && pathStart < coreEnd ? value.slice(pathStart, coreEnd) : "";
  if (!safeHttpPath(rawPath)) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password
    ) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function boundedSource(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  let end = Math.max(0, maxLength - TRUNCATION_SUFFIX.length);
  const lastCode = value.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end--;
  return value.slice(0, end) + TRUNCATION_SUFFIX.slice(0, maxLength - end);
}

/**
 * Apply the single Studio source-path boundary policy.
 *
 * Project-relative metadata must already be a safe, bounded relative path.
 * Browser runtime metadata may additionally be an HTTP(S) URL. Runtime query
 * and fragment data is discarded before the value crosses the Studio bridge.
 */
export function sanitizeStudioSourcePath(
  value: string,
  kind: StudioSourcePathKind,
  maxLength = MAX_STUDIO_CONFIG_PATH_LENGTH,
): string | undefined {
  if (
    !Number.isSafeInteger(maxLength) || maxLength <= 0 || !value || value !== value.trim() ||
    hasUnsafePathCodeUnit(value)
  ) return undefined;

  if (kind === "project-relative") {
    return safeProjectRelativePath(value, maxLength) ?? undefined;
  }

  const maxInputLength = maxLength * RUNTIME_SOURCE_INPUT_FACTOR;
  if (value.length > maxInputLength) return undefined;

  if (/^https?:\/\//i.test(value)) {
    const url = sanitizeHttpSourceUrl(value);
    return url ? boundedSource(url, maxLength) : undefined;
  }

  const suffixIndex = firstSuffixIndex(value, 0);
  const path = suffixIndex < 0 ? value : value.slice(0, suffixIndex);
  const safePath = safeProjectRelativePath(path, maxInputLength);
  return safePath ? boundedSource(safePath, maxLength) : undefined;
}
