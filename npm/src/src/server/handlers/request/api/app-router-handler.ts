/**
 * App Router Handler
 *
 * Handles App Router route.ts files with HTTP method support.
 */
import * as dntShim from "../../../../../_dnt.shims.js";


import type { HandlerContext } from "../../types.js";
import type { HandlerFn, RouteHandlerModule } from "./types.js";
import { resolveAppRouteFile } from "./app-router-resolver.js";
import { applySecurityHeaders } from "./security-headers.js";
import { applyCORSHeaders } from "../../../../security/index.js";
import { serverLogger } from "../../../../utils/index.js";
import { methodNotAllowed } from "../../../../platform/compat/http/responses.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function getAllowedMethods(mod: RouteHandlerModule): string[] {
  return HTTP_METHODS.filter((m) => typeof mod[m] === "function");
}

function resolveHandlerFunction(
  mod: RouteHandlerModule,
  method: string,
): [HandlerFn | undefined, boolean] {
  const methodFn = mod[method];
  if (typeof methodFn === "function") {
    return [methodFn as HandlerFn, false];
  }

  if (method === "HEAD" && typeof mod.GET === "function") {
    return [mod.GET as HandlerFn, true];
  }

  return [undefined, false];
}

export async function handleAppRouter(
  req: dntShim.Request,
  pathname: string,
  ctx: HandlerContext,
): Promise<dntShim.Response | null> {
  try {
    const match = await resolveAppRouteFile(pathname, ctx);
    if (!match) return null;

    const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
    const method = req.method.toUpperCase();

    const [fn, headShim] = resolveHandlerFunction(mod, method);
    if (!fn) return methodNotAllowed(getAllowedMethods(mod));

    const res = await fn(req, { params: match.params });

    const headers = new dntShim.Headers(res.headers);

    await applyCORSHeaders({
      request: req,
      headers,
      config: ctx.securityConfig?.cors,
    });

    applySecurityHeaders(headers, ctx);

    if (headShim) {
      return new dntShim.Response(null, { status: res.status, headers });
    }

    return new dntShim.Response(res.body, { status: res.status, headers });
  } catch (error) {
    serverLogger.error("[AppRouterAPIHandler] Failed to handle request", error);
    return null;
  }
}
