import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";

export const base64url = base64urlEncodeBytes;
export const parseCookies = parseCookiesFromHeaders;

// Re-export CSRF helpers from canonical location for backward compatibility
export { generateCsrfToken, validateCsrf } from "#veryfront/security/csrf/helpers.ts";

/**
 * DANGER: decodes a JWT payload WITHOUT verifying the signature.
 * Do NOT use this for authentication or authorization. Use
 * `verifySessionJwt` instead. This helper exists only for debugging
 * and for reading claims from tokens whose issuer you already
 * established out-of-band.
 */
export function decodeUnverifiedJwtClaims(
  req: Request,
  options?: { cookieName?: string },
): Record<string, unknown> | null {
  const cookieName = options?.cookieName ?? "session";
  const token = parseCookies(req.headers)[cookieName];
  if (!token) return null;

  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    // JWT payloads are base64url-encoded (RFC 7515): `-`/`_` replace `+`/`/`
    // and padding is stripped. `atob` only accepts standard base64 with
    // padding, so normalize before decoding or real tokens silently fail.
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
