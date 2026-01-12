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

  // Handle relative URLs (e.g., "/api/articles-2")
  // These need an absolute base URL during SSR
  if (url.startsWith("/")) {
    return `http://localhost:${serverPort}${url}`;
  }

  try {
    const parsed = new URL(url);
    // Rewrite if hostname matches the current project domain (set via setSSRProjectDomain)
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
  // Match /api/* paths (both relative and absolute to localhost)
  if (url.startsWith("/api/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Create SSR fetch wrapper that rewrites URLs for local development.
 * In client-only mode, API fetches return never-resolving promises
 * to allow React to render Suspense fallbacks.
 */
function createSSRFetch(): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = extractUrl(input);
    const rewrittenUrl = rewriteFetchUrlForSSR(url);

    // In client-only mode, API fetches return empty responses during SSR.
    // React Query will treat this as a successful fetch with empty data.
    // After hydration, the client will refetch with actual data.
    if (isSSRClientOnlyFetching() && isClientOnlyApiUrl(rewrittenUrl)) {
      // Return a mock empty response - this prevents the Invalid URL error
      // and allows SSR to complete. React Query will refetch client-side.
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], _ssrSkipped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    if (rewrittenUrl !== url) {
      // Create new request with rewritten URL
      if (typeof input === "string" || input instanceof URL) {
        return originalFetch(rewrittenUrl, init);
      }
      // Clone request with new URL
      return originalFetch(new Request(rewrittenUrl, input), init);
    }

    return originalFetch(input, init);
  };
}

/**
 * Enable SSR fetch interception.
 * Replaces globalThis.fetch with a wrapper that rewrites URLs.
 */
export function enableSSRFetchInterception(): void {
  const serverPort = getSSRServerPort();
  if (!serverPort) return;
  (globalThis as Record<string, unknown>).fetch = createSSRFetch();
}

/**
 * Disable SSR fetch interception.
 * Restores the original fetch.
 */
export function disableSSRFetchInterception(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}
