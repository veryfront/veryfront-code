import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";

export const base64url = base64urlEncodeBytes;
export const parseCookies = parseCookiesFromHeaders;

// Re-export CSRF helpers from canonical location for backward compatibility
export { generateCsrfToken, validateCsrf } from "#veryfront/security/csrf/helpers.ts";

/** Extract a JWT payload from a cookie (no signature verification) */
export function getSessionFromJwt(
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
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
