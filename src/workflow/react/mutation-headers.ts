import { parseCookies } from "#veryfront/utils/cookie-utils.ts";

const DEFAULT_CSRF_COOKIE_NAME = "__Host-vf_csrf";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";

/** Add the production double-submit token to browser workflow mutations. */
export function workflowMutationHeaders(requestUrl: string | URL, init?: HeadersInit): Headers {
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
