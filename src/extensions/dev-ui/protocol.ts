/** Stable prefix for port-scoped privileged dashboard session cookies. */
export const DASHBOARD_CSRF_COOKIE_NAME = "vf_dashboard_session";
/** Shared request header carrying the shell's session-bound CSRF token. */
export const DASHBOARD_CSRF_HEADER_NAME = "x-veryfront-dashboard-csrf";
/** Shared metadata name used to pass the CSRF token into the extension UI. */
export const DASHBOARD_CSRF_META_NAME = "veryfront-dashboard-csrf";
/** Asset-independent endpoint used by trusted headless development clients. */
export const DASHBOARD_SESSION_PATH = "/_dev/session";

/**
 * Derive the host cookie name for one concrete development-server listener.
 *
 * Cookies are scoped by host and path, but not by port. Including the validated
 * listener port prevents two local servers on the same hostname from
 * overwriting or accepting each other's dashboard session cookie.
 */
export function getDashboardSessionCookieName(listenerPort: number): string {
  if (!Number.isSafeInteger(listenerPort) || listenerPort < 1 || listenerPort > 65_535) {
    throw new RangeError("Dashboard listener port must be an integer from 1 to 65535");
  }
  return `${DASHBOARD_CSRF_COOKIE_NAME}_${listenerPort}`;
}

/** A 32-byte token encoded as unpadded base64url. */
export const DASHBOARD_CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Stable shell identity consumed by the extension-owned shared bundle. */
export const DEV_UI_KIND_ATTRIBUTE = "data-veryfront-dev-ui";
export type DevUiKind = "dashboard" | "projects";
