
import type { HandlerContext } from "../../types.ts";
import type { HandlerFn, RouteHandlerModule } from "./types.ts";
import { resolveAppRouteFile } from "./app-router-resolver.ts";
import { applySecurityHeaders } from "./security-headers.ts";
import { applyCORSHeaders } from "@veryfront/security";
import { serverLogger } from "@veryfront/utils";

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
    if (!match) {
      return null;
    }

    const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
    const method = req.method.toUpperCase();

    const [fn, headShim] = resolveHandlerFunction(mod, method);

    if (!fn) {
      const allow = getAllowedMethods(mod);
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: allow },
      });
    }

    const res = await fn(req, { params: match.params });

    const h = new Headers(res.headers);

    await applyCORSHeaders({
      request: req,
      headers: h,
      config: ctx.securityConfig?.cors,
    });

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
