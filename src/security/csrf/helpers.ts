/**
 * CSRF token generation and validation helpers.
 *
 * Uses the double-submit cookie pattern: a random token is stored in a cookie
 * and the client sends it back via a request header. The server compares the two.
 *
 * @module security/csrf/helpers
 */

import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import { MAX_CSRF_TTL_SECONDS } from "#veryfront/utils/constants/security.ts";
import {
  type CsrfNameOptions,
  DEFAULT_CSRF_COOKIE_NAME,
  requireCsrfName,
  resolveCsrfNames,
} from "./names.ts";

/** Default CSRF token TTL: 24 hours (longer than session action TTL to avoid stale-form 403s). */
const CSRF_DEFAULT_TTL_SEC = 86_400;

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

function requireCsrfTtl(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CSRF_TTL_SECONDS
  ) {
    throw new RangeError("CSRF token ttlSec must be a positive safe integer");
  }
  return value;
}

function requireBooleanOption(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

/** Generate a CSRF token and return value + Set-Cookie header string */
export function generateCsrfToken(options?: CsrfTokenOptions): {
  token: string;
  setCookie: string;
} {
  const cookieName = requireCsrfName(
    options?.cookieName ?? DEFAULT_CSRF_COOKIE_NAME,
    "CSRF cookieName",
  );
  const maxAge = requireCsrfTtl(options?.ttlSec ?? CSRF_DEFAULT_TTL_SEC);
  const httpOnly = options?.httpOnly === undefined
    ? true
    : requireBooleanOption(options.httpOnly, "CSRF token httpOnly");
  const requestedSecure = options?.secure === undefined
    ? true
    : requireBooleanOption(options.secure, "CSRF token secure");
  const secure = cookieName.startsWith("__Host-") ||
      cookieName.startsWith("__Secure-")
    ? true
    : requestedSecure;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const token = base64urlEncodeBytes(bytes);
  const parts = [`${cookieName}=${token}`, "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");

  return { token, setCookie: parts.join("; ") };
}

const encoder = new TextEncoder();
const ASSET_PATH_RE = /\.(?!html?$)[a-z0-9]+$/i;

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  // Use bitwise OR to accumulate differences without short-circuiting.
  // Pad the shorter side with 0xFF to guarantee a mismatch without leaking length via timing.
  let result = aBytes.length !== bBytes.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    result |= (aBytes[i] ?? 0xff) ^ (bBytes[i] ?? 0xff);
  }
  return result === 0;
}

/** Validate CSRF token by comparing header and cookie */
export function validateCsrf(
  req: Request,
  options?: CsrfNameOptions,
): boolean {
  try {
    const { cookieName, headerName } = resolveCsrfNames(options);
    const cookieToken = parseCookiesFromHeaders(req.headers)[cookieName];
    if (!cookieToken) return false;

    const headerToken = req.headers.get(headerName) ?? "";
    if (!headerToken) return false;

    return timingSafeEqual(cookieToken, headerToken);
  } catch {
    // Invalid options, malformed cookies, and unreadable request headers all
    // fail closed through this boolean validation contract.
    return false;
  }
}

/**
 * Resolve the token-issuing CSRF setting for a response-serving surface.
 *
 * Production defaults `security.csrf` on, so `applyCsrfCookie` issues the
 * double-submit token there. Local development leaves the setting unset and
 * stays permissive, which used to mean no token cookie existed locally at all:
 * every browser mutation — including the ones Veryfront's own hooks build with
 * `csrfMutationHeaders` — had nothing to echo, so correct client code still
 * sent no `x-csrf-token`. Issuing the same token cookie locally makes the
 * double-submit contract exercisable before deploy without enforcing it, so
 * the development warning is left to the mutations that genuinely omit the
 * header. Enforcement still keys off `security.csrf`, which this never sets.
 */
export function csrfCookieSetting(
  csrfConfig: boolean | CsrfConfig | undefined,
  isLocalDevelopment: boolean,
): boolean | CsrfConfig | undefined {
  return csrfConfig === undefined && isLocalDevelopment ? true : csrfConfig;
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
  if (!accept || (!accept.includes("text/html") && !accept.includes("application/xhtml+xml"))) {
    return;
  }

  const config = typeof csrfConfig === "boolean" ? {} : csrfConfig;
  const cookieName = config.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;

  // Skip if cookie already present in request
  let cookies: Record<string, string>;
  try {
    cookies = parseCookiesFromHeaders(req.headers);
  } catch (_) {
    /* expected: malformed cookie header — issue a fresh token */
    cookies = {};
  }
  if (cookies[cookieName]) return;

  // Detect HTTPS from the request URL, or from x-forwarded-proto only when the
  // deployment trusts the upstream proxy (VERYFRONT_TRUST_FORWARDED_HEADERS=1).
  // The forwarded header is client-spoofable otherwise, so blindly trusting it
  // could suppress the Secure flag on a genuinely-HTTPS deployment.
  const trustProxyHeaders = isProxyTopologyTrusted();
  const isSecure = cookieName.startsWith("__Host-") ||
    req.url.startsWith("https://") ||
    (trustProxyHeaders && req.headers.get("x-forwarded-proto") === "https");

  const { setCookie } = generateCsrfToken({
    cookieName,
    ttlSec: config.ttlSec,
    httpOnly: false, // Client JS must read cookie for double-submit header
    secure: isSecure,
  });

  responseHeaders.append("Set-Cookie", setCookie);
}
