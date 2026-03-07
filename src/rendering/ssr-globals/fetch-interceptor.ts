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
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

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
          const response = new Response(JSON.stringify({ data: [], _ssrSkipped: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
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

export function enableSSRFetchInterception(): void {
  if (!getSSRServerPort()) return;
  (globalThis as Record<string, unknown>).fetch = createSSRFetch();
}

export function disableSSRFetchInterception(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}
