/**
 * Browser half of the CSRF double-submit pattern.
 *
 * A production response sets a JS-readable `__Host-vf_csrf` cookie; every
 * browser-issued mutation has to echo it back in the `x-csrf-token` header or
 * the server answers `403`. Keep this module a zero-dependency leaf — it is
 * imported by client bundles, so it must not reach for server-capable code.
 *
 * @module security/csrf/browser-mutation-headers
 */

import { parseCookies } from "#veryfront/utils/cookie-utils.ts";

const DEFAULT_CSRF_COOKIE_NAME = "__Host-vf_csrf";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";

/**
 * Add the double-submit token to a browser mutation aimed at this origin.
 *
 * No-ops on the server, when the caller already set the header, when the
 * request leaves the document origin, or when no token cookie exists.
 */
export function csrfMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (headers.has(DEFAULT_CSRF_HEADER_NAME) || typeof document === "undefined") return headers;

  try {
    const resolvedUrl = new URL(requestUrl, document.baseURI);
    if (resolvedUrl.origin !== document.location.origin) return headers;
    const token = parseCookies(document.cookie)[DEFAULT_CSRF_COOKIE_NAME];
    if (token) headers.set(DEFAULT_CSRF_HEADER_NAME, token);
  } catch {
    // Sandboxed documents can deny cookie access. The server remains fail-closed.
  }

  return headers;
}
