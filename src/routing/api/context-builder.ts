import type { RouteMatch } from "./api-route-matcher.ts";

export interface APIContext {
  /** The original Request object (alias: req) */
  request: Request;
  /** Alias for request */
  req: Request;
  /** Route parameters extracted from dynamic segments */
  params: Record<string, string | string[]>;
  /** URL search params (query string) */
  query: URLSearchParams;
  /** Parsed cookies from the request */
  cookies: Record<string, string>;
  /** Request headers */
  headers: Headers;
  /** Parsed URL object */
  url: URL;
  /** Helper to return a JSON response */
  json: (data: unknown, init?: ResponseInit) => Response;
  /** Helper to return a text response */
  text: (data: string, init?: ResponseInit) => Response;
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((cookie) => {
    const trimmed = cookie.trim();
    if (!trimmed) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (!name) return;
    cookies[name] = decodeURIComponent(value);
  });

  return cookies;
}

export function createContext(request: Request, match: RouteMatch): APIContext {
  const url = new URL(request.url);

  return {
    request,
    req: request,
    params: match.params,
    query: url.searchParams,
    cookies: parseCookies(request.headers.get("cookie") ?? ""),
    headers: request.headers,
    url,
    json: (data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    },
    text: (data: string, init?: ResponseInit) => {
      return new Response(data, {
        ...init,
        headers: {
          "Content-Type": "text/plain",
          ...init?.headers,
        },
      });
    },
  };
}

export function normalizeParams(params: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = Array.isArray(v) ? v.join("/") : v;
  }
  return out;
}
