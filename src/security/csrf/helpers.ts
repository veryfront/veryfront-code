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
  CSRF_NAMES_COOKIE_NAME,
  csrfHttpTokenCookieName,
  type CsrfNameOptions,
  csrfNamesCookieName,
  decodeCsrfNamesAdvertisement,
  DEFAULT_CSRF_COOKIE_NAME,
  DEFAULT_CSRF_HEADER_NAME,
  effectiveCsrfCookieNameForOrigin,
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

  return generateCsrfTokenCookie(cookieName, maxAge, httpOnly, secure);
}

function generateCsrfTokenCookie(
  cookieName: string,
  maxAge: number,
  httpOnly: boolean,
  secure: boolean,
): { token: string; setCookie: string } {
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
    const cookies = parseCookiesFromHeaders(req.headers);
    const cookieTokens = [cookies[cookieName]];
    if (
      !cookieName.startsWith("__Host-") &&
      !cookieName.startsWith("__Secure-")
    ) {
      const browserOrigin = browserFacingOrigin(req, isProxyTopologyTrusted());
      if (new URL(browserOrigin).protocol === "http:") {
        cookieTokens.push(cookies[csrfHttpTokenCookieName(cookieName, browserOrigin)]);
      }
    }
    const headerToken = req.headers.get(headerName) ?? "";
    if (!headerToken) return false;

    let matches = false;
    for (const cookieToken of cookieTokens) {
      if (cookieToken) matches = timingSafeEqual(cookieToken, headerToken) || matches;
    }
    return matches;
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
 * it a local page would render with no CSRF cookie, leaving correct client code,
 * including the hooks that build on `csrfMutationHeaders`, with nothing to echo
 * into the header the gate then requires.
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
 * Set or refresh browser-readable CSRF token and name-advertisement cookies on
 * GET/HEAD responses. Existing tokens stay in place while stale or missing
 * current and sibling advertisements are synchronized.
 *
 * Missing tokens get a fresh double-submit cookie. Existing tokens are retained,
 * but stale or missing name advertisements are refreshed with the token TTL so
 * browser helpers keep discovering configured names. When a host-wide custom
 * token is shared with HTTP and HTTPS sibling origins, HTTPS refreshes upgrade
 * the existing token to Secure. HTTP siblings use their origin-scoped token
 * names instead. `__Host-` and `__Secure-` token names always keep Secure.
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
  const effectiveCookieName = effectiveCsrfCookieNameForOrigin(
    config.cookieName,
    browserOrigin,
  );
  // Validate here, not only in the schema: applyCsrfCookie is public API and a
  // direct caller can pass names the schema never saw. An unvalidated name is
  // interpolated straight into Set-Cookie.
  const configuredCookieName = requireNonReservedCsrfCookieName(
    requireCsrfName(effectiveCookieName, "CSRF cookieName"),
  );
  const headerName = requireCsrfName(
    config.headerName ?? DEFAULT_CSRF_HEADER_NAME,
    "CSRF headerName",
  );
  const ttlSec = requireCsrfTtl(config.ttlSec ?? CSRF_DEFAULT_TTL_SEC);

  // Skip if cookie already present in request
  let cookies: Record<string, string>;
  try {
    cookies = parseCookiesFromHeaders(req.headers);
  } catch (_) {
    /* expected: malformed cookie header — issue a fresh token */
    cookies = {};
  }
  const browserProtocol = new URL(browserOrigin).protocol;
  const configuredToken = cookies[configuredCookieName];
  const hasExplicitCustomCookieName = config.cookieName !== undefined &&
    config.cookieName !== DEFAULT_CSRF_COOKIE_NAME;
  const cookieName = configuredToken || browserProtocol !== "http:" ||
      configuredCookieName.startsWith("__Host-") ||
      configuredCookieName.startsWith("__Secure-") ||
      !hasExplicitCustomCookieName
    ? configuredCookieName
    : csrfHttpTokenCookieName(configuredCookieName, browserOrigin);
  const secureAdvertisement = cookieName.startsWith("__Host-") ||
    browserProtocol === "https:";
  const secureToken = cookieName.startsWith("__Secure-") || secureAdvertisement;
  const advertisement = encodeCsrfNamesAdvertisement(
    cookieName,
    headerName,
    browserOrigin,
  );
  const advertisementCookieName = csrfNamesCookieName(browserOrigin);

  // A deployment can change the advertised names and TTL while an older token
  // remains valid. Refresh the pair together so the discovery cookie cannot
  // expire before the token it describes.
  const existingToken = cookies[cookieName];
  if (existingToken) {
    if (
      !csrfNamesCookieNeedsRefresh(
        advertisementCookieName,
        advertisement,
        cookies,
      )
    ) return;
    appendCsrfNamesCookie(
      responseHeaders,
      advertisementCookieName,
      advertisement,
      cookies,
      ttlSec,
      secureAdvertisement,
      true,
    );
    // An HTTP response cannot know or extend the lifetime of an HTTPS Secure
    // sibling. Updating only this origin's advertisement is still safe: it
    // immediately restores the configured header, and a later missing token
    // causes the normal fresh-pair path to align both lifetimes again.
    if (!canRefreshExistingCsrfPair(cookieName, secureAdvertisement)) return;
    if (advertisement !== null) {
      appendSiblingCsrfNamesCookies(
        responseHeaders,
        advertisementCookieName,
        cookieName,
        cookies,
        ttlSec,
      );
      appendExistingCsrfTokenCookie(
        responseHeaders,
        cookieName,
        existingToken,
        ttlSec,
        secureToken,
      );
    }
    return;
  }

  const { setCookie } = generateCsrfTokenCookie(
    cookieName,
    ttlSec,
    false, // Client JS must read cookie for double-submit header
    secureToken,
  );

  responseHeaders.append("Set-Cookie", setCookie);
  appendCsrfNamesCookie(
    responseHeaders,
    advertisementCookieName,
    advertisement,
    cookies,
    ttlSec,
    secureAdvertisement,
    true,
  );
}

function appendSiblingCsrfNamesCookies(
  responseHeaders: Headers,
  currentAdvertisementCookieName: string,
  tokenCookieName: string,
  cookies: Record<string, string>,
  ttlSec: number,
): void {
  for (const [cookieName, value] of Object.entries(cookies)) {
    if (cookieName === currentAdvertisementCookieName) continue;
    if (!cookieName.startsWith(`${CSRF_NAMES_COOKIE_NAME}_`)) continue;

    const origin = csrfNamesAdvertisementOrigin(value);
    if (origin === null) continue;
    if (cookieName !== csrfNamesCookieName(origin)) continue;

    const advertised = decodeCsrfNamesAdvertisement(value, origin);
    if (advertised?.cookieName !== tokenCookieName) continue;

    appendCsrfNamesCookie(
      responseHeaders,
      cookieName,
      value,
      cookies,
      ttlSec,
      new URL(origin).protocol === "https:",
      true,
    );
  }
}

function canRefreshExistingCsrfPair(
  tokenCookieName: string,
  secureAdvertisement: boolean,
): boolean {
  if (tokenCookieName.startsWith("__Host-") || tokenCookieName.startsWith("__Secure-")) {
    return true;
  }
  return secureAdvertisement;
}

function csrfNamesAdvertisementOrigin(value: string): string | null {
  const lastSep = value.lastIndexOf(":");
  if (lastSep <= 0) return null;
  const firstOfPair = value.lastIndexOf(":", lastSep - 1);
  if (firstOfPair <= 0) return null;

  const origin = value.slice(0, firstOfPair);
  try {
    const url = new URL(origin);
    if (url.origin !== origin) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return origin;
  } catch {
    return null;
  }
}

function appendExistingCsrfTokenCookie(
  responseHeaders: Headers,
  cookieName: string,
  token: string,
  ttlSec: number,
  secure: boolean,
): void {
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${ttlSec}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  responseHeaders.append("Set-Cookie", parts.join("; "));
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
  const origin = getEffectiveRequestOrigin(req, undefined, trustProxyHeaders);
  if (origin === null) {
    throw new TypeError("Browser-facing request origin is invalid");
  }
  return origin;
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
  forceRefresh: boolean,
): void {
  if (advertisement === null && !cookies[advertisementCookieName]) return;
  if (
    !forceRefresh && advertisement !== null &&
    cookies[advertisementCookieName] === advertisement
  ) return;

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

function csrfNamesCookieNeedsRefresh(
  advertisementCookieName: string,
  advertisement: string | null,
  cookies: Record<string, string>,
): boolean {
  return advertisement === null
    ? Boolean(cookies[advertisementCookieName])
    : cookies[advertisementCookieName] !== advertisement;
}
