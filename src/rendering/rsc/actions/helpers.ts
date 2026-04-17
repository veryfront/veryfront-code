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
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
