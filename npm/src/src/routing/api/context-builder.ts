import * as dntShim from "../../../_dnt.shims.js";
import type { RouteMatch } from "./api-route-matcher.js";
import type { FileSystemAdapter } from "../../platform/adapters/base.js";
import { parseCookies } from "../../utils/cookie-utils.js";

export { parseCookies };

export interface APIContext {
  request: dntShim.Request;
  req: dntShim.Request;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  headers: dntShim.Headers;
  url: URL;
  json: (data: unknown, init?: dntShim.ResponseInit) => dntShim.Response;
  text: (data: string, init?: dntShim.ResponseInit) => dntShim.Response;
  fs: FileSystemAdapter;
}

function createResponse(
  body: dntShim.BodyInit,
  contentType: string,
  init?: dntShim.ResponseInit,
): dntShim.Response {
  return new dntShim.Response(body, {
    ...init,
    headers: {
      "Content-Type": contentType,
      ...init?.headers,
    },
  });
}

export function createContext(
  request: dntShim.Request,
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
    json: (data: unknown, init?: dntShim.ResponseInit) =>
      createResponse(JSON.stringify(data), "application/json", init),
    text: (data: string, init?: dntShim.ResponseInit) => createResponse(data, "text/plain", init),
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
