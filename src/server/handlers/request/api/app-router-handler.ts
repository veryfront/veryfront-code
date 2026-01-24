/**
 * App Router Handler
 *
 * Handles App Router route.ts files with HTTP method support.
 */

import type { HandlerContext } from "../../types.ts";
import type { HandlerFn, RouteHandlerModule } from "./types.ts";
import { resolveAppRouteFile } from "./app-router-resolver.ts";
import { applySecurityHeaders } from "./security-headers.ts";
import { applyCORSHeaders } from "#veryfront/security";
import { serverLogger } from "#veryfront/utils";
import { methodNotAllowed } from "#veryfront/http/responses";

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
  req: Request,
  pathname: string,
  ctx: HandlerContext,
): Promise<Response | null> {
  try {
    const match = await resolveAppRouteFile(pathname, ctx);
    if (!match) return null;

    const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
    const method = req.method.toUpperCase();

    const [fn, headShim] = resolveHandlerFunction(mod, method);
    if (!fn) return methodNotAllowed(getAllowedMethods(mod));

    const res = await fn(req, { params: match.params });

    const headers = new Headers(res.headers);

    await applyCORSHeaders({
      request: req,
      headers,
      config: ctx.securityConfig?.cors,
    });

    applySecurityHeaders(headers, ctx);

    if (headShim) {
      return new Response(null, { status: res.status, headers });
    }

    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    serverLogger.error("[AppRouterAPIHandler] Failed to handle request", error);
    return null;
  }
}
