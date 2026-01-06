import type { RouteMatch } from "./api-route-matcher.ts";
import type { FileSystemAdapter } from "@veryfront/platform/adapters/base.ts";
import { parseCookies } from "@veryfront/utils/cookie-utils.ts";

export { parseCookies };

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
  /** Filesystem adapter for accessing project files */
  fs: FileSystemAdapter;
}

export function createContext(
  request: Request,
  match: RouteMatch,
  fs: FileSystemAdapter,
): APIContext {
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
    fs,
  };
}

export function normalizeParams(params: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = Array.isArray(v) ? v.join("/") : v;
  }
  return out;
}
