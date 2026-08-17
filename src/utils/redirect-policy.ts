export const MAX_REDIRECT_ORIGIN_COUNT = 64;
export const MAX_REDIRECT_ORIGIN_LENGTH = 2_048;
export const MAX_REDIRECT_ORIGIN_LIST_LENGTH = 16_384;
export const MAX_REDIRECT_DESTINATION_LENGTH = 8_192;

export interface RedirectPolicy {
  allowedOrigins: readonly string[];
}

/** Return whether a URL value contains an ASCII control character. */
function hasUnsafeUrlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Return the serialized origin only when the input is a canonical HTTP(S) origin. */
export function parseCanonicalRedirectOrigin(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > MAX_REDIRECT_ORIGIN_LENGTH ||
    value.trim() !== value ||
    hasUnsafeUrlCharacter(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      value !== url.origin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Return whether every configured origin is canonical, unique, and bounded. */
export function isValidRedirectOriginList(origins: readonly string[]): boolean {
  if (origins.length > MAX_REDIRECT_ORIGIN_COUNT) return false;

  const uniqueOrigins = new Set<string>();
  let totalLength = 0;
  for (const origin of origins) {
    if (typeof origin !== "string") return false;
    totalLength += origin.length;
    const canonicalOrigin = parseCanonicalRedirectOrigin(origin);
    if (
      totalLength > MAX_REDIRECT_ORIGIN_LIST_LENGTH ||
      canonicalOrigin === null ||
      uniqueOrigins.has(canonicalOrigin)
    ) {
      return false;
    }
    uniqueOrigins.add(canonicalOrigin);
  }
  return true;
}

/**
 * Validate one project redirect against an opt-in origin policy.
 * An omitted policy preserves the legacy behavior. A configured policy allows
 * HTTP(S) destinations on the request origin plus exact allowlisted origins.
 */
export function isRedirectDestinationAllowed(
  destination: string,
  requestUrl: string | null,
  policy: RedirectPolicy | null | undefined,
): boolean {
  if (policy === undefined) return true;
  if (policy === null) return false;
  if (
    !Array.isArray(policy.allowedOrigins) ||
    !isValidRedirectOriginList(policy.allowedOrigins) ||
    destination.length === 0 ||
    destination.length > MAX_REDIRECT_DESTINATION_LENGTH ||
    destination.trim() !== destination ||
    hasUnsafeUrlCharacter(destination) ||
    requestUrl === null
  ) {
    return false;
  }

  try {
    const request = new URL(requestUrl);
    const target = new URL(destination, request);
    if (
      (target.protocol !== "http:" && target.protocol !== "https:") ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return false;
    }
    if (target.origin === request.origin) return true;
    return policy.allowedOrigins.some((origin) => origin === target.origin);
  } catch {
    return false;
  }
}
