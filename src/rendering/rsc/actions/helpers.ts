import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { SERVER_ACTION_DEFAULT_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";

export const base64url = base64urlEncodeBytes;
export const parseCookies = parseCookiesFromHeaders;

/** Generate a CSRF token and return value + Set-Cookie header string */
export function generateCsrfToken(options?: { cookieName?: string; ttlSec?: number }): {
  token: string;
  setCookie: string;
} {
  const cookieName = options?.cookieName ?? "vf_csrf";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const token = base64url(bytes);
  const maxAge = options?.ttlSec ?? SERVER_ACTION_DEFAULT_TTL_SEC;
  const setCookie = `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`;

  return { token, setCookie };
}

/** Validate CSRF token by comparing header and cookie */
export function validateCsrf(
  req: Request,
  options?: { cookieName?: string; headerName?: string },
): boolean {
  const cookieName = options?.cookieName ?? "vf_csrf";
  const headerName = options?.headerName ?? "x-csrf-token";

  const cookies = parseCookies(req.headers);
  const cookieToken = cookies[cookieName];
  if (!cookieToken) return false;

  return cookieToken === (req.headers.get(headerName) ?? "");
}

/** Extract a JWT payload from a cookie (no signature verification) */
export function getSessionFromJwt(
  req: Request,
  options?: { cookieName?: string },
): Record<string, unknown> | null {
  const cookieName = options?.cookieName ?? "session";
  const token = parseCookies(req.headers)[cookieName];
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const bytes = Uint8Array.from(atob(parts[1] ?? ""), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
