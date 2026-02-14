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

export interface CsrfConfig {
  cookieName?: string;
  headerName?: string;
  excludePaths?: string[];
  ttlSec?: number;
}

export interface CsrfTokenOptions {
  cookieName?: string;
  ttlSec?: number;
  /** When false, omits HttpOnly so client JS can read the cookie (double-submit pattern). Default: true */
  httpOnly?: boolean;
  /** When true, adds the Secure flag (cookie only sent over HTTPS). Default: true */
  secure?: boolean;
}

/** Generate a CSRF token and return value + Set-Cookie header string */
export function generateCsrfToken(options?: CsrfTokenOptions): {
  token: string;
  setCookie: string;
} {
  const cookieName = options?.cookieName ?? "vf_csrf";
  const maxAge = options?.ttlSec ?? SERVER_ACTION_DEFAULT_TTL_SEC;
  const httpOnly = options?.httpOnly ?? true;
  const secure = options?.secure ?? true;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const token = base64urlEncodeBytes(bytes);
  const parts = [`${cookieName}=${token}`, "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");

  return { token, setCookie: parts.join("; ") };
}

const encoder = new TextEncoder();
const ASSET_PATH_RE = /\.[a-z0-9]+$/i;

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  // Use bitwise OR to accumulate differences without short-circuiting
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i]! ^ bBytes[i]!;
  }
  return result === 0;
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

  const headerToken = req.headers.get(headerName) ?? "";
  if (!headerToken) return false;

  return timingSafeEqual(cookieToken, headerToken);
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

  const { pathname } = new URL(req.url);
  if (pathname.startsWith("/_veryfront/")) return;
  if (pathname === "/_ws") return;
  if (ASSET_PATH_RE.test(pathname)) return;

  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  if (accept && !accept.includes("text/html") && !accept.includes("application/xhtml+xml")) {
    return;
  }

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

  // Detect HTTPS from request URL or forwarded proto
  const isSecure = req.url.startsWith("https://") ||
    req.headers.get("x-forwarded-proto") === "https";

  const { setCookie } = generateCsrfToken({
    cookieName,
    ttlSec: config.ttlSec,
    httpOnly: false, // Client JS must read cookie for double-submit header
    secure: isSecure,
  });

  responseHeaders.append("Set-Cookie", setCookie);
}
