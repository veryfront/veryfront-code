import * as dntShim from "../../../../../_dnt.shims.js";
import type { HandlerContext } from "../../types.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache",
};

function jsonResponse(data: unknown, status = 200): dntShim.Response {
  return new dntShim.Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

export function handleProjectsAPI(req: dntShim.Request, ctx: HandlerContext): dntShim.Response | null {
  const { pathname } = new URL(req.url);

  if (req.method !== "GET" || pathname !== "/_projects/api/config") return null;

  return handleGetConfig(req, ctx);
}

function handleGetConfig(req: dntShim.Request, ctx: HandlerContext): dntShim.Response {
  const url = new URL(req.url);

  // Get domain info for building project URLs
  const host = req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    url.host ??
    "lvh.me";

  const hostWithoutPort = host.replace(/:\d+$/, "") || "lvh.me";
  const port = host.includes(":") ? host.split(":")[1] ?? "" : "";

  return jsonResponse({
    domain: hostWithoutPort,
    port,
    hasToken: Boolean(ctx.proxyToken || ctx.config?.fs?.veryfront?.apiToken),
  });
}
