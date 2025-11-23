/**
 * App Router Handler
 *
 * Handles App Router route.ts files with HTTP method support.
 */

import type { HandlerContext } from "../../types.ts";
import type { HandlerFn, RouteHandlerModule } from "./types.ts";
import { resolveAppRouteFile } from "./app-router-resolver.ts";
import { applySecurityHeaders } from "./security-headers.ts";
import { applyCORSHeaders } from "@veryfront/security";
import { serverLogger } from "@veryfront/utils";

/**
 * Gets the list of allowed HTTP methods from a route module
 *
 * @param mod - The route handler module
 * @returns Comma-separated list of allowed methods
 *
 * @example
 * ```ts
 * const allow = getAllowedMethods(mod);
 * // Returns "GET, POST, PUT"
 * ```
 */
function getAllowedMethods(mod: RouteHandlerModule): string {
  const candidates = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ];
  const allowed = candidates.filter((m) => typeof mod[m] === "function");
  return allowed.join(", ") || "GET,POST";
}

/**
 * Resolves the handler function for a given HTTP method
 *
 * @param mod - The route handler module
 * @param method - HTTP method (uppercase)
 * @returns Handler function and whether it's a HEAD->GET shim
 *
 * @example
 * ```ts
 * const [fn, isHeadShim] = resolveHandlerFunction(mod, "GET");
 * ```
 */
function resolveHandlerFunction(
  mod: RouteHandlerModule,
  method: string,
): [HandlerFn | undefined, boolean] {
  const methodFn = mod[method];
  if (typeof methodFn === "function") {
    return [methodFn as HandlerFn, false];
  }

  // HEAD fallback to GET
  if (method === "HEAD" && typeof mod.GET === "function") {
    return [mod.GET as HandlerFn, true];
  }

  return [undefined, false];
}

/**
 * Handles App Router route.ts requests
 *
 * @param req - The incoming request
 * @param pathname - Request pathname
 * @param ctx - Handler context
 * @returns Response or null if not handled
 *
 * @example
 * ```ts
 * const response = await handleAppRouter(req, "/api/users", ctx);
 * ```
 */
export async function handleAppRouter(
  req: Request,
  pathname: string,
  ctx: HandlerContext,
): Promise<Response | null> {
  try {
    const match = await resolveAppRouteFile(pathname, ctx);
    if (!match) {
      return null;
    }

    const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
    const method = req.method.toUpperCase();

    const [fn, headShim] = resolveHandlerFunction(mod, method);

    if (!fn) {
      // Method not allowed
      const allow = getAllowedMethods(mod);
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: allow },
      });
    }

    // Execute the handler
    const res = await fn(req, { params: match.params });

    // Apply CORS and security headers
    const h = new Headers(res.headers);

    // Apply CORS
    await applyCORSHeaders({
      request: req,
      headers: h,
      config: ctx.securityConfig?.cors,
    });

    // Apply security headers
    applySecurityHeaders(h, ctx);

    if (headShim) {
      return new Response(null, { status: res.status, headers: h });
    }

    return new Response(res.body, { status: res.status, headers: h });
  } catch (error) {
    serverLogger.error("[AppRouterAPIHandler] Failed to handle request", error);
    return null;
  }
}
