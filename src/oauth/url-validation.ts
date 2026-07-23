import { MAX_OAUTH_URL_LENGTH } from "./limits.ts";

function parseSafeAbsoluteUrl(value: unknown): URL | null {
  try {
    if (
      typeof value !== "string" || !value || value.length > MAX_OAUTH_URL_LENGTH ||
      value.trim() !== value
    ) return null;
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]" || hostname === "::1";
}

/** Provider endpoints carry credentials/tokens and therefore require TLS. */
export function isSecureOAuthEndpointUrl(value: unknown): value is string {
  return parseSafeAbsoluteUrl(value)?.protocol === "https:";
}

/** OAuth redirect URIs require TLS, except for the standard loopback case. */
export function isOAuthRedirectUrl(value: unknown): value is string {
  const parsed = parseSafeAbsoluteUrl(value);
  if (!parsed) return false;
  return parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
}

export function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}
