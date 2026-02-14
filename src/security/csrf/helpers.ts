/**
 * CSRF token generation and validation helpers.
 *
 * Uses the double-submit cookie pattern: a random token is stored in a cookie
 * and the client sends it back via a request header. The server compares the two.
 *
 * @module security/csrf/helpers
 */

import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { SERVER_ACTION_DEFAULT_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";

export interface CsrfTokenOptions {
  cookieName?: string;
  ttlSec?: number;
  /** When false, omits HttpOnly so client JS can read the cookie (double-submit pattern). Default: true */
  httpOnly?: boolean;
}

/** Generate a CSRF token and return value + Set-Cookie header string */
export function generateCsrfToken(options?: CsrfTokenOptions): {
  token: string;
  setCookie: string;
} {
  const cookieName = options?.cookieName ?? "vf_csrf";
  const maxAge = options?.ttlSec ?? SERVER_ACTION_DEFAULT_TTL_SEC;
  const httpOnly = options?.httpOnly ?? true;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const token = base64urlEncodeBytes(bytes);
  const parts = [`${cookieName}=${token}`, "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");

  return { token, setCookie: parts.join("; ") };
}

/** Validate CSRF token by comparing header and cookie */
export function validateCsrf(
  req: Request,
  options?: { cookieName?: string; headerName?: string },
): boolean {
  const cookieName = options?.cookieName ?? "vf_csrf";
  const headerName = options?.headerName ?? "x-csrf-token";

  let cookieToken: string | undefined;
  try {
    cookieToken = parseCookiesFromHeaders(req.headers)[cookieName];
  } catch {
    // Malformed cookie (e.g. bad percent-encoding) → treat as missing
    return false;
  }
  if (!cookieToken) return false;

  return cookieToken === (req.headers.get(headerName) ?? "");
}

export interface CsrfConfig {
  cookieName?: string;
  headerName?: string;
  excludePaths?: string[];
  ttlSec?: number;
}

/**
 * Set CSRF cookie on GET/HEAD responses when not already present.
 * Uses httpOnly: false so client JS can read the cookie for double-submit.
 */
export function applyCsrfCookie(
  req: Request,
  responseHeaders: Headers,
  csrfConfig?: boolean | CsrfConfig,
): void {
  if (!csrfConfig) return;

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return;

  const config = typeof csrfConfig === "boolean" ? {} : csrfConfig;
  const cookieName = config.cookieName ?? "vf_csrf";

  // Skip if cookie already present in request
  let cookies: Record<string, string>;
  try {
    cookies = parseCookiesFromHeaders(req.headers);
  } catch {
    // Malformed cookie header — issue a fresh token
    cookies = {};
  }
  if (cookies[cookieName]) return;

  const { setCookie } = generateCsrfToken({
    cookieName,
    ttlSec: config.ttlSec,
    httpOnly: false, // Client JS must read cookie for double-submit header
  });

  responseHeaders.append("Set-Cookie", setCookie);
}
