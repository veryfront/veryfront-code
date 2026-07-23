import type { RouteMatch } from "./api-route-matcher.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { parseCookies } from "#veryfront/utils/cookie-utils.ts";
import { flattenRouteParams } from "../flatten-route-params.ts";

export { parseCookies };

/** Context object passed to API route handlers. */
export interface APIContext {
  request: Request;
  req: Request;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  headers: Headers;
  url: URL;
  json: (data: unknown, init?: ResponseInit) => Response;
  text: (data: string, init?: ResponseInit) => Response;
  fs: FileSystemAdapter;
}

function createResponse(
  body: BodyInit,
  contentType: string,
  init?: ResponseInit,
): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", contentType);

  return new Response(body, {
    ...init,
    headers,
  });
}

function cloneParams(
  params: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const cloned: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(params)) {
    Object.defineProperty(cloned, name, {
      configurable: true,
      enumerable: true,
      value: Array.isArray(value) ? [...value] : value,
      writable: true,
    });
  }
  return cloned;
}

export function createContext(
  request: Request,
  match: RouteMatch,
  fs: FileSystemAdapter,
): APIContext {
  const url = new URL(request.url);
  const json = (data: unknown, init?: ResponseInit): Response =>
    createResponse(JSON.stringify(data), "application/json", init);
  const text = (data: string, init?: ResponseInit): Response =>
    createResponse(data, "text/plain", init);

  return {
    request,
    req: request,
    params: cloneParams(match.params),
    query: url.searchParams,
    cookies: parseCookies(request.headers.get("cookie") ?? ""),
    headers: request.headers,
    url,
    json,
    text,
    fs,
  };
}

/**
 * @deprecated Use {@link flattenRouteParams} directly. Kept as a thin alias so
 * the routing barrel exposes a single flattener implementation (issue #2742).
 */
export function normalizeParams(
  params: Record<string, string | string[]>,
): Record<string, string> {
  return flattenRouteParams(params);
}
