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
  /**
   * Read the request body as JSON, or build a JSON response.
   *
   * `ctx.json()` with no arguments parses and returns the request body.
   * `ctx.json(data, init?)` returns a JSON `Response`.
   */
  json: {
    (): Promise<unknown>;
    (data: unknown, init?: ResponseInit): Response;
  };
  text: (data: string, init?: ResponseInit) => Response;
  fs: FileSystemAdapter;
}

function createResponse(
  body: BodyInit,
  contentType: string,
  init?: ResponseInit,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": contentType,
      ...init?.headers,
    },
  });
}

/**
 * Build the `ctx.json` helper for a request.
 *
 * Overloaded on arity. `ctx.json(data)` builds a response; `ctx.json()` reads
 * the request body, which is what handlers reach for, and what the zero-arg
 * form was previously misread as. It used to stringify `undefined` into a
 * Response, so `await ctx.json()` yielded a Response object that serialised
 * back out as `{}` and silently dropped every posted payload.
 *
 * Exported because the isolation Worker builds its own context and has to
 * behave identically. Handlers must not care which one ran them.
 */
export function createJsonHelper(request: Request): APIContext["json"] {
  function json(): Promise<unknown>;
  function json(data: unknown, init?: ResponseInit): Response;
  function json(...args: [] | [unknown, ResponseInit?]): Response | Promise<unknown> {
    if (args.length === 0) return request.json();
    const [data, init] = args;
    return createResponse(JSON.stringify(data), "application/json", init);
  }

  return json;
}

export function createContext(
  request: Request,
  match: RouteMatch,
  fs: FileSystemAdapter,
): APIContext {
  const url = new URL(request.url);
  const json = createJsonHelper(request);

  const text = (data: string, init?: ResponseInit): Response =>
    createResponse(data, "text/plain", init);

  return {
    request,
    req: request,
    params: match.params,
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
