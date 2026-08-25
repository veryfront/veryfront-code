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
import { getEffectiveRequestOrigin } from "#veryfront/server/utils/request-host.ts";
import { MAX_CSRF_TTL_SECONDS } from "#veryfront/utils/constants/security.ts";
import {
  type CsrfNameOptions,
  csrfNamesCookieName,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
  defaultCsrfCookieNameForOrigin,
  encodeCsrfNamesAdvertisement,
  requireCsrfName,
  requireNonReservedCsrfCookieName,
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
  const cookieName = requireNonReservedCsrfCookieName(
    requireCsrfName(
      options?.cookieName ?? DEFAULT_CSRF_COOKIE_NAME,
      "CSRF cookieName",
    ),
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
 * `deriveSecurityContext` defaults `security.csrf` on in every environment, so
 * a derived context already asks for the token cookie. This covers the surfaces
 * that serve a local response before any security context was derived: without
 * it a local page would render with no `__Host-vf_csrf` cookie, leaving correct
 * client code, including the hooks that build on `csrfMutationHeaders`, with
 * nothing to echo into the header the gate then requires.
 *
 * It only ever issues a token. Enforcement keys off `security.csrf`, which this
 * never sets, and an explicit `false` passes straight through so the documented
 * opt-out suppresses the cookie as well as the check.
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

  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  if (!accept || (!accept.includes("text/html") && !accept.includes("application/xhtml+xml"))) {
    return;
  }

  const config = typeof csrfConfig === "boolean" ? {} : csrfConfig;
  const browserOrigin = browserFacingOrigin(req, isProxyTopologyTrusted());
  const configuredCookieName = config.cookieName;
  const effectiveCookieName = configuredCookieName === undefined ||
      configuredCookieName === DEFAULT_CSRF_COOKIE_NAME
    ? defaultCsrfCookieNameForOrigin(browserOrigin)
    : configuredCookieName;
  // Validate here, not only in the schema: applyCsrfCookie is public API and a
  // direct caller can pass names the schema never saw. An unvalidated name is
  // interpolated straight into Set-Cookie.
  const cookieName = requireNonReservedCsrfCookieName(
    requireCsrfName(
      effectiveCookieName,
      "CSRF cookieName",
    ),
  );
  const headerName = requireCsrfName(
    config.headerName ?? DEFAULT_CSRF_HEADER_NAME,
    "CSRF headerName",
  );
  // Validate before branching on an existing token: the existing-token path
  // skips generateCsrfToken, and an unvalidated ttlSec would be interpolated
  // straight into the advertisement cookie's Max-Age, expiring or corrupting it.
  const ttlSec = requireCsrfTtl(config.ttlSec ?? CSRF_DEFAULT_TTL_SEC);

  // Skip if cookie already present in request
  let cookies: Record<string, string>;
  try {
    cookies = parseCookiesFromHeaders(req.headers);
  } catch (_) {
    /* expected: malformed cookie header — issue a fresh token */
    cookies = {};
  }
  const secureCookies = cookieName.startsWith("__Host-") ||
    new URL(browserOrigin).protocol === "https:";
  const advertisement = encodeCsrfNamesAdvertisement(
    cookieName,
    headerName,
    browserOrigin,
  );
  const advertisementCookieName = csrfNamesCookieName(browserOrigin);

  // Refresh the advertisement independently of the token: a deployment that
  // changes only headerName keeps the same token cookie, so an early return
  // here would leave the browser reading a stale header name forever.
  if (cookies[cookieName]) {
    appendCsrfNamesCookie(
      responseHeaders,
      advertisementCookieName,
      advertisement,
      cookies,
      ttlSec,
      secureCookies,
    );
    return;
  }

  const { setCookie } = generateCsrfToken({
    cookieName,
    ttlSec,
    httpOnly: false, // Client JS must read cookie for double-submit header
    secure: secureCookies,
  });

  responseHeaders.append("Set-Cookie", setCookie);
  appendCsrfNamesCookie(
    responseHeaders,
    advertisementCookieName,
    advertisement,
    cookies,
    ttlSec,
    secureCookies,
  );
}

/**
 * The origin the browser actually used, which is what `document.location.origin`
 * will report.
 *
 * Behind a TLS-terminating proxy the request URL stays an internal `http://`
 * address, so advertising it would publish an origin the document can never
 * match and discovery would silently fall back to the defaults. The forwarded
 * headers are consulted only when the deployment opts in through
 * VERYFRONT_TRUST_FORWARDED_HEADERS, exactly as the Secure flag decision does,
 * because they are client-spoofable otherwise. The flag is passed in rather than
 * read here so this stays a pure function the colocated unit test can drive
 * without touching process env.
 */
export function browserFacingOrigin(req: Request, trustProxyHeaders: boolean): string {
  const requestOrigin = new URL(req.url).origin;
  return getEffectiveRequestOrigin(req, undefined, trustProxyHeaders) ?? requestOrigin;
}

/**
 * Publish configured names so the browser helper can discover them without the
 * caller hand-plumbing server configuration. Skipped when both names are the
 * documented defaults, so default projects gain no new cookie, and skipped when
 * the browser already holds the identical advertisement.
 */
function appendCsrfNamesCookie(
  responseHeaders: Headers,
  advertisementCookieName: string,
  advertisement: string | null,
  cookies: Record<string, string>,
  ttlSec: number,
  secure: boolean,
): void {
  if (advertisement === null && !cookies[advertisementCookieName]) return;
  if (advertisement !== null && cookies[advertisementCookieName] === advertisement) return;

  const parts = [
    `${advertisementCookieName}=${advertisement === null ? "" : encodeURIComponent(advertisement)}`,
    "Path=/",
    `Max-Age=${advertisement === null ? 0 : ttlSec}`,
    "SameSite=Lax",
  ];
  // Deliberately not HttpOnly: the browser helper must read it. It carries no
  // secret, and a tampered value only makes the client send a header the server
  // is not reading, which fails closed.
  if (secure) parts.push("Secure");
  responseHeaders.append("Set-Cookie", parts.join("; "));
}
