import type { HandlerContext } from "../../types.ts";
import { jsonResponse } from "../http-helpers.ts";
import {
  createPrivateProjectsResponse,
  isAuthorizedProjectsRequest,
  withPrivateProjectsHeaders,
} from "./request-policy.ts";

export function handleProjectsAPI(req: Request, ctx: HandlerContext): Response | null {
  const { pathname } = new URL(req.url);

  if (pathname !== "/_projects/api/config") return null;
  if (!isAuthorizedProjectsRequest(req)) {
    return createPrivateProjectsResponse("Unauthorized", 401);
  }
  if (req.method.toUpperCase() !== "GET") {
    return createPrivateProjectsResponse("Method Not Allowed", 405, { "Allow": "GET" });
  }

  return handleGetConfig(req, ctx);
}

function handleGetConfig(req: Request, ctx: HandlerContext): Response {
  const url = new URL(req.url);
  const port = url.port;
  if (port !== "" && (!/^\d{1,5}$/.test(port) || Number(port) > 65_535)) {
    return createPrivateProjectsResponse("Invalid request", 400);
  }

  return withPrivateProjectsHeaders(
    jsonResponse({
      domain: url.hostname,
      port,
      hasToken: Boolean(ctx.proxyToken || ctx.config?.fs?.veryfront?.apiToken),
    }),
  );
}
