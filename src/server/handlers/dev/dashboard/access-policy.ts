import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { parseCookiesFromHeaders } from "#veryfront/utils/cookie-utils.ts";
import { constantTimeEqual } from "#veryfront/security/utils/constant-time.ts";
import {
  DASHBOARD_CSRF_COOKIE_NAME,
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
  getDashboardSessionCookieName,
} from "#veryfront/extensions/dev-ui/protocol";
import { isTrustedLocalControlRequest } from "#veryfront/security/http/local-control-request.ts";

export { DASHBOARD_CSRF_COOKIE_NAME, DASHBOARD_CSRF_HEADER_NAME };

export const DASHBOARD_ACCESS_DENIED_MESSAGE =
  "Dashboard access requires a direct loopback connection and a trusted local-development host";

const tokenBytes = new Uint8Array(32);
crypto.getRandomValues(tokenBytes);
const dashboardSessionToken = base64urlEncodeBytes(tokenBytes);

const MAX_DASHBOARD_REQUEST_URL_CHARACTERS = 8 * 1024;
const MAX_DASHBOARD_COOKIE_HEADER_CHARACTERS = 8 * 1024;

function getDashboardListenerPort(requestUrl: URL): number | null {
  const defaultPort = requestUrl.protocol === "http:"
    ? 80
    : requestUrl.protocol === "https:"
    ? 443
    : null;
  if (defaultPort === null) return null;

  const listenerPort = requestUrl.port === "" ? defaultPort : Number(requestUrl.port);
  return Number.isSafeInteger(listenerPort) && listenerPort >= 1 && listenerPort <= 65_535
    ? listenerPort
    : null;
}

function getRequestDashboardCookieName(req: Request): string | null {
  if (req.url.length > MAX_DASHBOARD_REQUEST_URL_CHARACTERS) return null;
  try {
    const listenerPort = getDashboardListenerPort(new URL(req.url));
    return listenerPort === null ? null : getDashboardSessionCookieName(listenerPort);
  } catch {
    return null;
  }
}

/**
 * Admit only canonical local-development URL/Host pairs.
 *
 * Binding the dev server to a non-loopback interface does not implicitly make
 * its privileged dashboard remotely accessible. Besides literal loopback, the
 * admitted names are the canonical local domains also used by HMR and printed
 * by the CLI. A future remote-dashboard feature must define an authenticated
 * host contract explicitly.
 */
export function isTrustedDashboardRequest(req: Request): boolean {
  if (
    req.url.length > MAX_DASHBOARD_REQUEST_URL_CHARACTERS ||
    !isTrustedLocalControlRequest(req)
  ) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url);
  } catch {
    return false;
  }
  if (
    (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
    requestUrl.username !== "" ||
    requestUrl.password !== "" ||
    getDashboardListenerPort(requestUrl) === null
  ) {
    return false;
  }

  return true;
}

/** Token embedded only in the trusted dashboard shell for a double-submit header. */
export function getDashboardSessionToken(): string {
  return dashboardSessionToken;
}

/** Issue the process-lifetime dashboard session as a host-only session cookie. */
export function createDashboardSessionCookie(req: Request): string {
  if (!isTrustedDashboardRequest(req)) {
    throw new TypeError("Cannot issue a dashboard session for an untrusted request");
  }
  const cookieName = getRequestDashboardCookieName(req);
  if (cookieName === null) {
    throw new TypeError("Cannot issue a dashboard session for an invalid listener origin");
  }
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${dashboardSessionToken}; Path=/_dev; HttpOnly; SameSite=Strict${secure}`;
}

/** Validate both halves of the dashboard's session-bound CSRF credential. */
export function hasValidDashboardMutationSession(req: Request): boolean {
  try {
    if (!isTrustedDashboardRequest(req)) return false;
    const cookieName = getRequestDashboardCookieName(req);
    if (cookieName === null) return false;

    const cookieHeader = req.headers.get("cookie") ?? "";
    const headerToken = req.headers.get(DASHBOARD_CSRF_HEADER_NAME);
    if (
      cookieHeader.length > MAX_DASHBOARD_COOKIE_HEADER_CHARACTERS ||
      headerToken === null ||
      headerToken.length !== dashboardSessionToken.length ||
      !DASHBOARD_CSRF_TOKEN_PATTERN.test(headerToken)
    ) return false;

    const cookieToken = parseCookiesFromHeaders(req.headers)[cookieName];
    return typeof cookieToken === "string" &&
      DASHBOARD_CSRF_TOKEN_PATTERN.test(cookieToken) &&
      constantTimeEqual(cookieToken, dashboardSessionToken) &&
      constantTimeEqual(headerToken, dashboardSessionToken);
  } catch {
    return false;
  }
}
