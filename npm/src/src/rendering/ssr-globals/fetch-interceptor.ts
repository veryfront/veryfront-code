/**
 * SSR Fetch Interceptor
 *
 * Rewrites fetch URLs for SSR to handle relative URLs and
 * project domain redirection during local development.
 *
 * @module rendering/ssr-globals/fetch-interceptor
 */
import * as dntShim from "../../../_dnt.shims.js";


import {
  getSSRProjectDomain,
  getSSRServerPort,
  isSSRClientOnlyFetching,
  originalFetch,
} from "./context.js";
import { setActiveSpanAttributes, withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";

/** Check if hostname matches project domain (including www variant) */
function isProjectDomain(hostname: string): boolean {
  const projectDomain = getSSRProjectDomain();
  if (!projectDomain) return false;
  return hostname === projectDomain || hostname === `www.${projectDomain}`;
}

/**
 * Rewrite fetch URL for SSR.
 * - Handles relative URLs (starting with /) by prepending localhost
 * - Redirects requests to the project's own domain to the local server
 */
function rewriteFetchUrlForSSR(url: string): string {
  const serverPort = getSSRServerPort();
  if (!serverPort) return url;

  if (url.startsWith("/")) {
    return `http://localhost:${serverPort}${url}`;
  }

  try {
    const parsed = new URL(url);
    if (isProjectDomain(parsed.hostname)) {
      return `http://localhost:${serverPort}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Invalid URL, return as-is
  }

  return url;
}

/** Extract URL string from fetch input */
function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Check if a URL is an API endpoint that should be client-only.
 */
function isClientOnlyApiUrl(url: string): boolean {
  if (url.startsWith("/api/")) return true;

  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function createSSRFetch(): typeof dntShim.fetch {
  return (input: RequestInfo | URL, init?: dntShim.RequestInit): Promise<dntShim.Response> => {
    const url = extractUrl(input);
    const rewrittenUrl = rewriteFetchUrlForSSR(url);
    const clientOnly = isSSRClientOnlyFetching() && isClientOnlyApiUrl(rewrittenUrl);

    const method = init?.method ?? (input instanceof dntShim.Request ? input.method : "GET");
    const spanAttributes: Record<string, string | number | boolean> = {
      "http.method": method,
      "http.url": rewrittenUrl,
      "veryfront.fetch_client_only": clientOnly,
      "veryfront.fetch_rewritten": rewrittenUrl !== url,
    };

    if (rewrittenUrl !== url) {
      spanAttributes["http.original_url"] = url;
    }

    try {
      const parsed = new URL(rewrittenUrl);
      spanAttributes["http.target"] = `${parsed.pathname}${parsed.search}`;
      spanAttributes["http.host"] = parsed.host;
      spanAttributes["http.scheme"] = parsed.protocol.replace(":", "");
    } catch {
      // Ignore - non-absolute URLs won't provide host/scheme
    }

    return withSpan(
      SpanNames.HTTP_CLIENT_FETCH,
      async () => {
        if (clientOnly) {
          const response = new dntShim.Response(JSON.stringify({ data: [], _ssrSkipped: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
          setActiveSpanAttributes({ "http.status_code": response.status });
          return response;
        }

        const response =
          await (rewrittenUrl === url
            ? originalFetch(input, init)
            : typeof input === "string" || input instanceof URL
            ? originalFetch(rewrittenUrl, init)
            : originalFetch(new dntShim.Request(rewrittenUrl, input), init));

        setActiveSpanAttributes({ "http.status_code": response.status });
        return response;
      },
      spanAttributes,
    );
  };
}

export function enableSSRFetchInterception(): void {
  if (!getSSRServerPort()) return;
  (dntShim.dntGlobalThis as Record<string, unknown>).fetch = createSSRFetch();
}

export function disableSSRFetchInterception(): void {
  (dntShim.dntGlobalThis as Record<string, unknown>).fetch = originalFetch;
}
