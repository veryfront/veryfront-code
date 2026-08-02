import { ErrorPages } from "../server/utils/error-html.ts";
import type { ProxyContext } from "./handler.ts";

type ProxyError = NonNullable<ProxyContext["error"]>;

function createNonCacheableHeaders(contentType?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

export function jsonErrorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: createNonCacheableHeaders("application/json; charset=utf-8"),
  });
}

export function createProxyErrorResponse(error: ProxyError): Response {
  if (error.redirectUrl) {
    const headers = createNonCacheableHeaders();
    headers.set("Location", error.redirectUrl);
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  if (error.slug === "release-not-found" || error.slug === "project-not-found") {
    return new Response(ErrorPages.notFound(), {
      status: 404,
      headers: createNonCacheableHeaders("text/html; charset=utf-8"),
    });
  }

  return jsonErrorResponse(error.status, {
    error: error.message,
    status: error.status,
  });
}
