import type { RouteMatch } from "./api-route-matcher.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { parseCookies } from "#veryfront/utils/cookie-utils.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
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
   * Build a JSON `Response`. `ctx.json(data, init?)` mirrors `Response.json`.
   *
   * To read the request body, use `ctx.body()` or the raw `ctx.request.json()`.
   */
  json: (data: unknown, init?: ResponseInit) => Response;
  /**
   * Read and parse the request body as JSON.
   *
   * The result is cached, so calling it more than once (or alongside a manual
   * `ctx.request.json()`) does not throw `Body already consumed`. A body that
   * is not valid JSON becomes a 400, not an unhandled 500.
   */
  body: <T = unknown>() => Promise<T>;
  text: (data: string, init?: ResponseInit) => Response;
  fs: FileSystemAdapter;
}

/**
 * Statuses that the Fetch spec forbids from carrying a body. Constructing
 * `new Response(body, { status })` with a non-null `body` (an empty string
 * still counts) throws `Response with null body status cannot have body`, so
 * the helpers below must send `null` for these.
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function createResponse(
  body: BodyInit,
  contentType: string,
  init?: ResponseInit,
): Response {
  const status = init?.status;
  const hasNullBodyStatus = status !== undefined && NULL_BODY_STATUSES.has(status);
  return new Response(hasNullBodyStatus ? null : body, {
    ...init,
    headers: {
      "Content-Type": contentType,
      ...init?.headers,
    },
  });
}

/**
 * Build the `ctx.json` response helper. Writes only; mirrors `Response.json`.
 *
 * Exported because the isolation Worker builds its own context and has to
 * behave identically. Handlers must not care which one ran them.
 */
export function createJsonHelper(_request: Request): APIContext["json"] {
  return (data: unknown, init?: ResponseInit): Response =>
    createResponse(JSON.stringify(data), "application/json", init);
}

/**
 * Build the `ctx.body` request-body reader.
 *
 * The parse is memoised on the first call, so a validation helper and a handler
 * that both read the body do not fight over a single-use stream. The clone is
 * taken up front, while the context is built, so `ctx.request` is left intact
 * for a handler that still wants the raw stream — and, crucially, so a handler
 * that reads `ctx.request` raw *before* calling `ctx.body()` cannot make the
 * clone throw `Body already consumed` (`request.clone()` throws synchronously
 * once the original stream is disturbed). A malformed body is turned into a
 * catalogued 400 rather than escaping as a 500.
 */
export function createBodyReader(request: Request): APIContext["body"] {
  // Clone eagerly: at construction time the original body is guaranteed
  // untouched, so the read is order-independent with any raw `ctx.request`
  // access a handler performs later.
  const source = request.clone();
  let parsed: Promise<unknown> | undefined;

  const read = (): Promise<unknown> => {
    if (!parsed) {
      parsed = source.json().catch(() => {
        throw INVALID_ARGUMENT.create({ detail: "Request body is not valid JSON" });
      });
    }
    return parsed;
  };

  return <T = unknown>(): Promise<T> => read() as Promise<T>;
}

export function createContext(
  request: Request,
  match: RouteMatch,
  fs: FileSystemAdapter,
): APIContext {
  const url = new URL(request.url);
  const json = createJsonHelper(request);
  const body = createBodyReader(request);

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
    body,
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
