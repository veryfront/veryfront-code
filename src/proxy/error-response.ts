import { ErrorPages } from "../server/utils/error-html.ts";
import type { ProxyContextError } from "./handler.ts";

function errorHeaders(contentType?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function hasUnsafeRedirectCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code <= 31 || code === 127) return true;
  }
  return false;
}

function isAllowedSignInRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.hostname !== "veryfront.com" || url.port !== "" ||
      url.username !== "" || url.password !== "" || url.pathname !== "/sign-in" ||
      url.hash !== ""
    ) return false;

    const entries = [...url.searchParams.entries()];
    if (entries.length !== 1 || entries[0]?.[0] !== "from") return false;
    const returnTarget = entries[0][1];
    if (!returnTarget || returnTarget.length > 8_192 || hasUnsafeRedirectCharacter(returnTarget)) {
      return false;
    }
    if (returnTarget.startsWith("/") && !returnTarget.startsWith("//")) return true;

    const returnUrl = new URL(returnTarget);
    const isHostedProduction = returnUrl.hostname.endsWith(".production.veryfront.com") ||
      returnUrl.hostname.endsWith(".production.veryfront.org");
    return isHostedProduction && returnUrl.protocol === "https:" && returnUrl.port === "" &&
      returnUrl.username === "" && returnUrl.password === "" && returnUrl.hash === "";
  } catch {
    return false;
  }
}

/** Create a non-cacheable JSON error response with baseline security headers. */
export function jsonErrorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: errorHeaders("application/json"),
  });
}

/** Render a proxy error as an approved redirect, not-found page, or JSON response. */
export function createProxyErrorResponse(error: ProxyContextError): Response {
  if (error.redirectUrl) {
    if (!isAllowedSignInRedirect(error.redirectUrl)) {
      return jsonErrorResponse(500, { error: "Internal Proxy Error", status: 500 });
    }
    const headers = errorHeaders();
    headers.set("Location", error.redirectUrl);
    return new Response(null, {
      status: 302,
      headers,
    });
  }

  if (error.slug === "release-not-found" || error.slug === "project-not-found") {
    const headers = errorHeaders("text/html; charset=utf-8");
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    );
    return new Response(ErrorPages.notFound(), {
      status: 404,
      headers,
    });
  }

  return jsonErrorResponse(error.status, {
    error: error.message,
    status: error.status,
  });
}
