import type { RouteMatch } from "./api-route-matcher.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { parseCookies } from "#veryfront/utils/cookie-utils.ts";

export { parseCookies };

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
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": contentType,
      ...init?.headers,
    },
  });
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
    json: (data: unknown, init?: ResponseInit) =>
      createResponse(JSON.stringify(data), "application/json", init),
    text: (data: string, init?: ResponseInit) => createResponse(data, "text/plain", init),
    fs,
  };
}

export function normalizeParams(
  params: Record<string, string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    out[key] = Array.isArray(value) ? value.join("/") : value;
  }

  return out;
}
