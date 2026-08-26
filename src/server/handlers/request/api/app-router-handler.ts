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
import { createApplicationRequest } from "#veryfront/security/http/application-request.ts";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";

const logger = serverLogger.component("app-router-api-handler");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function getAllowedMethods(mod: RouteHandlerModule): string[] {
  return HTTP_METHODS.filter((m) => typeof mod[m] === "function");
}

function resolveHandlerFunction(
  mod: RouteHandlerModule,
  method: string,
): [HandlerFn | undefined, boolean] {
  const methodFn = mod[method];
  if (typeof methodFn === "function") return [methodFn as HandlerFn, false];

  if (method === "HEAD" && typeof mod.GET === "function") return [mod.GET, true];

  return [undefined, false];
}

export async function handleAppRouter(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
): Promise<Response | null> {
  try {
    if (requiresIsolatedProjectRuntime(ctx)) {
      const unavailable = createErrorResponseFromDefinition(
        PROJECT_EXECUTION_UNAVAILABLE,
        {
          detail: "Shared runtimes require a dedicated isolated project runtime for API execution",
          instance: pathname,
        },
      );
      const headers = new Headers(unavailable.headers);
      headers.set("cache-control", "no-store");
      await applyCORSHeaders({
        request: req,
        headers,
        config: ctx.securityConfig?.cors,
      });
      applySecurityHeaders(headers, ctx, req);
      return new Response(req.method === "HEAD" ? null : unavailable.body, {
        status: unavailable.status,
        statusText: unavailable.statusText,
        headers,
      });
    }

    const match = await resolveAppRouteFile(pathname, ctx);
    if (!match) return null;

    const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
    const method = req.method.toUpperCase();

    const [fn, headShim] = resolveHandlerFunction(mod, method);
    if (!fn) return methodNotAllowed(getAllowedMethods(mod));

    const res = await fn(
      createApplicationRequest(req, {
        denyHeaders: ctx.applicationIdentityHeaderNames,
      }),
      {
        params: match.params,
        identity: ctx.applicationIdentity ?? null,
      },
    );
    const headers = new Headers(res.headers);

    await applyCORSHeaders({
      request: req,
      headers,
      config: ctx.securityConfig?.cors,
    });

    applySecurityHeaders(headers, ctx, req);

    if (headShim) return new Response(null, { status: res.status, headers });

    return new Response(res.body, { status: res.status, headers });
  } catch (error) {
    logger.error("Failed to handle request", error);
    return null;
  }
}
