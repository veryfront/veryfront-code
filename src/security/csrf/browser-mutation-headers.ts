/**
 * Browser half of the CSRF double-submit pattern.
 *
 * A document response sets a JS-readable CSRF cookie; every browser-issued
 * mutation has to echo it back in the configured header or the server answers
 * `403`. Keep this module a client-safe leaf: it is imported by browser
 * bundles, so it must not reach for server-capable code.
 *
 * @module security/csrf/browser-mutation-headers
 */

import { parseCookies } from "#veryfront/utils/cookie-utils.ts";
import {
  csrfHttpsTokenCookieName,
  csrfNamesCookieName,
  decodeCsrfNamesAdvertisement,
  effectiveCsrfCookieNameForOrigin,
  effectiveCsrfTokenCookieNameForOrigin,
  resolveCsrfNames,
} from "./names.ts";

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
 * Browser document state used by the pure CSRF header helper.
 *
 * Token discovery, request URL resolution, and origin checks use one snapshot.
 * Supply facts from the same document so those decisions stay consistent.
 * The shape remains client-safe and contains no server-owned state.
 */
export interface CsrfDocumentFacts {
  /** Raw `document.cookie` string. */
  readonly cookie: string;
  /** `document.baseURI`, used to resolve a relative request URL. */
  readonly baseURI: string;
  /** `document.location.origin`, the only origin a token may be sent to. */
  readonly origin: string;
}

/**
 * Pure double-submit decision.
 *
 * Split from the global read so the precedence rules can be tested without
 * installing a fake `document`, which would make this colocated unit test
 * effect-bearing under the semantic unit-boundary audit.
 *
 * Precedence: an explicit caller name wins, then the names the server
 * advertised for this project, then the documented defaults. Discovery is what
 * lets a project configure `security.csrf` without repeating those names at
 * every call site.
 */
export function csrfMutationHeadersFor(
  requestUrl: string | URL,
  facts: CsrfDocumentFacts,
  options: CsrfMutationHeadersOptions = {},
): Headers {
  const headers = new Headers(options.headers);

  let cookies: Record<string, string>;
  try {
    cookies = parseCookies(facts.cookie);
  } catch {
    // Sandboxed documents can deny cookie access. The server remains fail-closed.
    resolveCsrfNames(options);
    return headers;
  }

  const advertised = decodeCsrfNamesAdvertisement(
    cookies[csrfNamesCookieName(facts.origin)],
    facts.origin,
  );
  const configured = resolveCsrfNames(options);
  const cookieName = options.cookieName === undefined && advertised
    ? advertised.cookieName
    : effectiveCsrfCookieNameForOrigin(configured.cookieName, facts.origin);
  const headerName = options.headerName === undefined && advertised
    ? advertised.headerName
    : configured.headerName;
  if (headers.has(headerName)) return headers;

  try {
    const resolvedUrl = new URL(requestUrl, facts.baseURI);
    if (resolvedUrl.origin !== facts.origin) return headers;
    let token = cookies[cookieName];
    if (!token) {
      const tokenCookieName = effectiveCsrfTokenCookieNameForOrigin(
        cookieName,
        facts.origin,
        false,
      );
      token = cookies[tokenCookieName];
    }
    if (
      !token && resolvedUrl.protocol === "https:" &&
      !cookieName.startsWith("__Host-") && !cookieName.startsWith("__Secure-")
    ) {
      token = cookies[csrfHttpsTokenCookieName(cookieName, facts.origin)];
    }
    if (token) headers.set(headerName, token);
  } catch {
    // A malformed request URL cannot be proven same-origin, so send nothing.
  }

  return headers;
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
  if (typeof document === "undefined") {
    // Server render: validate the caller's names, attach nothing.
    resolveCsrfNames(options);
    return new Headers(options.headers);
  }

  // Read the document facts inside the guard: a sandboxed or opaque-origin
  // document throws from the document.cookie getter itself, and building the
  // facts object eagerly would let that escape before the helper can fall back.
  let facts: CsrfDocumentFacts;
  try {
    facts = {
      cookie: document.cookie,
      baseURI: document.baseURI,
      origin: document.location.origin,
    };
  } catch {
    resolveCsrfNames(options);
    return new Headers(options.headers);
  }

  return csrfMutationHeadersFor(requestUrl, facts, options);
}
