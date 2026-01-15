import type { HandlerContext } from "../../types.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-cache" };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

export function handleProjectsAPI(
  req: Request,
  ctx: HandlerContext,
): Response | null {
  const url = new URL(req.url);
  const { pathname } = url;
  const { method } = req;

  if (method === "GET" && pathname === "/_projects/api/config") {
    return handleGetConfig(req, ctx);
  }

  return null;
}

function handleGetConfig(req: Request, ctx: HandlerContext): Response {
  const url = new URL(req.url);

  // Get domain info for building project URLs
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host") || url.host || "lvh.me";
  const hostWithoutPort = host.replace(/:\d+$/, "") || "lvh.me";
  const port = host.includes(":") ? host.split(":")[1] ?? "" : "";

  return jsonResponse({
    domain: hostWithoutPort,
    port,
    hasToken: !!(ctx.proxyToken || ctx.config?.fs?.veryfront?.apiToken),
  });
}
