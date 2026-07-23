/**
 * SSR Fetch Interceptor
 *
 * Rewrites fetch URLs for SSR to handle relative URLs and
 * project domain redirection during local development.
 *
 * @module rendering/ssr-globals/fetch-interceptor
 */

import {
  getSSRProjectDomain,
  getSSRServerPort,
  isSSRClientOnlyFetching,
  originalFetch,
} from "./context.ts";
import { setActiveSpanAttributes, SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";

function isProjectDomain(hostname: string): boolean {
  const projectDomain = getSSRProjectDomain();
  if (!projectDomain) return false;
  return hostname === projectDomain || hostname === `www.${projectDomain}`;
}

function rewriteFetchUrlForSSR(url: string): string {
  const serverPort = getSSRServerPort();
  if (!serverPort) return url;

  if (url.startsWith("/")) return `http://localhost:${serverPort}${url}`;

  try {
    const parsed = new URL(url);
    if (!isProjectDomain(parsed.hostname)) return url;
    return `http://localhost:${serverPort}${parsed.pathname}${parsed.search}`;
  } catch (_) {
    /* expected: URL may be invalid or relative */
    return url;
  }
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isClientOnlyApiUrl(url: string): boolean {
  if (url.startsWith("/api/")) return true;

  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" && parsed.pathname.startsWith("/api/");
  } catch (_) {
    /* expected: URL may be invalid */
    return false;
  }
}

function createSSRFetch(): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = extractUrl(input);
    const rewrittenUrl = rewriteFetchUrlForSSR(url);
    const clientOnly = isSSRClientOnlyFetching() && isClientOnlyApiUrl(rewrittenUrl);
    const safeRewrittenUrl = sanitizeUrlForSpan(rewrittenUrl);

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const spanAttributes: Record<string, string | number | boolean> = {
      "http.method": method,
      "http.url": safeRewrittenUrl,
      "veryfront.fetch_client_only": clientOnly,
      "veryfront.fetch_rewritten": rewrittenUrl !== url,
    };

    if (rewrittenUrl !== url) {
      spanAttributes["http.original_url"] = sanitizeUrlForSpan(url);
    }

    try {
      const parsed = new URL(rewrittenUrl);
      spanAttributes["http.target"] = parsed.pathname;
      spanAttributes["http.scheme"] = parsed.protocol.replace(":", "");
    } catch (_) {
      /* expected: non-absolute URLs won't provide host/scheme */
    }

    return withSpan(
      SpanNames.HTTP_CLIENT_FETCH,
      async () => {
        if (clientOnly) {
          // SSR-skip contract: client-only API routes must not execute during SSR.
          // We return a synthetic response rather than letting the fetch proceed
          // so the component can render an empty/loading state on the server.
          //
          // Consumers must check `_ssrSkipped: true` in the body OR the
          // `X-VF-SSR-Skipped: true` response header to distinguish this sentinel
          // from a real empty-data response. Components that only check
          // `response.ok` or `data.length` will silently render an empty state —
          // this is intentional for client-only routes.
          const response = new Response(JSON.stringify({ data: [], _ssrSkipped: true }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-VF-SSR-Skipped": "true",
            },
          });
          setActiveSpanAttributes({ "http.status_code": response.status });
          return response;
        }

        let response: Response;

        if (rewrittenUrl === url) {
          response = await originalFetch(input, init);
        } else if (typeof input === "string" || input instanceof URL) {
          response = await originalFetch(rewrittenUrl, init);
        } else {
          response = await originalFetch(new Request(rewrittenUrl, input), init);
        }

        setActiveSpanAttributes({ "http.status_code": response.status });
        return response;
      },
      spanAttributes,
    );
  };
}

let installedSSRFetch: typeof fetch | undefined;
let persistentInterceptionEnabled = false;
let fetchInterceptionLeaseCount = 0;

function installSSRFetchInterception(): void {
  if (installedSSRFetch) {
    if (globalThis.fetch !== installedSSRFetch) {
      throw new Error("SSR fetch interceptor ownership changed while active");
    }
    return;
  }
  if (globalThis.fetch !== originalFetch) {
    throw new Error("SSR fetch interceptor cannot replace another fetch implementation");
  }
  installedSSRFetch = createSSRFetch();
  (globalThis as Record<string, unknown>).fetch = installedSSRFetch;
}

function restoreOriginalFetch(): void {
  if (installedSSRFetch && globalThis.fetch === installedSSRFetch) {
    (globalThis as Record<string, unknown>).fetch = originalFetch;
  }
  installedSSRFetch = undefined;
}

/**
 * Install the SSR fetch interceptor as a process-global patch.
 *
 * The function mutates `globalThis.fetch` for the entire process. URL rewriting
 * reads request-scoped settings when a server handler provides them, which
 * keeps concurrent production server instances isolated.
 */
export function enableSSRFetchInterception(): void {
  if (!getSSRServerPort()) return;
  installSSRFetchInterception();
  persistentInterceptionEnabled = true;
}

export function disableSSRFetchInterception(): void {
  persistentInterceptionEnabled = false;
  if (fetchInterceptionLeaseCount === 0) restoreOriginalFetch();
}

/** Acquire process-wide fetch interception without replacing another server's lease. */
export function acquireSSRFetchInterception(): () => void {
  installSSRFetchInterception();
  fetchInterceptionLeaseCount++;

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    fetchInterceptionLeaseCount--;
    if (fetchInterceptionLeaseCount === 0 && !persistentInterceptionEnabled) {
      restoreOriginalFetch();
    }
  };
}
