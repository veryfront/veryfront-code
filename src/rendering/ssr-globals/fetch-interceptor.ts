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

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const spanAttributes: Record<string, string | number | boolean> = {
      "http.method": method,
      "http.url": rewrittenUrl,
      "veryfront.fetch_client_only": clientOnly,
      "veryfront.fetch_rewritten": rewrittenUrl !== url,
    };

    if (rewrittenUrl !== url) spanAttributes["http.original_url"] = url;

    try {
      const parsed = new URL(rewrittenUrl);
      spanAttributes["http.target"] = `${parsed.pathname}${parsed.search}`;
      spanAttributes["http.host"] = parsed.host;
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

/**
 * Install the SSR fetch interceptor as a process-global patch.
 *
 * CONCURRENCY CONSTRAINT: this mutates `globalThis.fetch` for the entire
 * process. In the multi-tenant renderer, all concurrent SSR renders share the
 * same patched fetch. The URL-rewrite logic reads `getSSRServerPort()` /
 * `getSSRProjectDomain()` which are themselves process-wide globals set once at
 * server startup (see context.ts). As long as those values do not change between
 * requests this is safe; if they do, the last writer wins and cross-tenant
 * request bleed is possible. Per-request scoping (e.g. AsyncLocalStorage) would
 * eliminate the hazard but requires broader refactoring.
 */
export function enableSSRFetchInterception(): void {
  if (!getSSRServerPort()) return;
  (globalThis as Record<string, unknown>).fetch = createSSRFetch();
}

export function disableSSRFetchInterception(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}
