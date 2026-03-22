import { ErrorPages } from "../server/utils/error-html.ts";
import type { ProxyContext } from "./handler.ts";

type ProxyError = NonNullable<ProxyContext["error"]>;

export function jsonErrorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createProxyErrorResponse(error: ProxyError): Response {
  if (error.redirectUrl) {
    return new Response(null, {
      status: 302,
      headers: { Location: error.redirectUrl },
    });
  }

  if (error.slug === "release-not-found" || error.slug === "project-not-found") {
    return new Response(ErrorPages.notFound(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return jsonErrorResponse(error.status, {
    error: error.message,
    status: error.status,
  });
}
