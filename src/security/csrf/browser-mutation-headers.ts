/**
 * Browser half of the CSRF double-submit pattern.
 *
 * A production response sets a JS-readable CSRF cookie; every browser-issued
 * mutation has to echo it back in the configured header or the server answers
 * `403`. Keep this module a client-safe leaf: it is imported by browser
 * bundles, so it must not reach for server-capable code.
 *
 * @module security/csrf/browser-mutation-headers
 */

import { parseCookies } from "#veryfront/utils/cookie-utils.ts";
import { resolveCsrfNames } from "./names.ts";

/** Options for adding a CSRF token while preserving existing request headers. */
export interface CsrfMutationHeadersOptions {
  /** Headers to preserve on the mutation request. */
  headers?: HeadersInit;
  /** CSRF cookie name. Must match `security.csrf.cookieName`. */
  cookieName?: string;
  /** CSRF header name. Must match `security.csrf.headerName`. */
  headerName?: string;
}

/**
 * Add the double-submit token to a browser mutation aimed at this origin.
 *
 * No-ops on the server, when the caller already set the header, when the
 * request leaves the document origin, or when no token cookie exists.
 */
export function csrfMutationHeaders(
  requestUrl: string | URL,
  options: CsrfMutationHeadersOptions = {},
): Headers {
  const headers = new Headers(options.headers);
  const { cookieName, headerName } = resolveCsrfNames(options);
  if (headers.has(headerName) || typeof document === "undefined") return headers;

  try {
    const resolvedUrl = new URL(requestUrl, document.baseURI);
    if (resolvedUrl.origin !== document.location.origin) return headers;
    const token = parseCookies(document.cookie)[cookieName];
    if (token) headers.set(headerName, token);
  } catch {
    // Sandboxed documents can deny cookie access. The server remains fail-closed.
  }

  return headers;
}
