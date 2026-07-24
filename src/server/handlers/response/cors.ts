import { BaseHandler } from "./base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { matchesRoutePathname } from "#veryfront/security/http/base-handler.ts";
import { PRIORITY_VERY_HIGH } from "#veryfront/utils/constants/index.ts";
import { withApiHandler } from "../request/api/pages-api-handler.ts";

const ROUTE_METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const PREFLIGHT_ONLY_METHODS = ["OPTIONS"];
const READ_ONLY_PAGE_METHODS = ["GET", "HEAD", "OPTIONS"];

function resolveRegisteredMethods(
  pathname: string,
  ctx: HandlerContext,
  handlers: ReadonlyArray<{ metadata: HandlerMetadata }>,
): string[] | null {
  const registered = new Set<string>();

  for (const { metadata } of handlers) {
    if (metadata.name === "CorsHandler") continue;
    if (metadata.enabled && !metadata.enabled(ctx)) continue;

    for (const pattern of metadata.patterns ?? []) {
      if (!pattern.method || !matchesRoutePathname(pathname, pattern)) continue;

      const methods = Array.isArray(pattern.method) ? pattern.method : [pattern.method];
      for (const method of methods) registered.add(method.toUpperCase());
    }
  }

  if (registered.size === 0) return null;
  if (registered.has("GET")) registered.add("HEAD");
  registered.add("OPTIONS");

  const ordered = ROUTE_METHOD_ORDER.filter((method) => registered.delete(method));
  return [...ordered, ...[...registered].sort()];
}

function mergeMethods(...groups: ReadonlyArray<readonly string[] | null>): string[] {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const method of group ?? []) merged.add(method.toUpperCase());
  }

  if (merged.has("GET")) merged.add("HEAD");
  merged.add("OPTIONS");

  const ordered = ROUTE_METHOD_ORDER.filter((method) => merged.delete(method));
  return [...ordered, ...[...merged].sort()];
}

export class CorsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CorsHandler",
    priority: PRIORITY_VERY_HIGH as HandlerPriority,
    patterns: [{ pattern: /.*/, method: "OPTIONS" }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() !== "OPTIONS") return this.continue();

    const pathname = new URL(req.url).pathname;
    const requestedMethod = req.headers.get("access-control-request-method") ?? undefined;
    const allowMethods = await this.resolveAllowedMethods(
      pathname,
      requestedMethod,
      ctx,
    );

    const response = ResponseBuilder.preflight(req, {
      allowMethods,
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig: ctx.securityConfig?.cors,
      isDev: !!ctx.isLocalProject,
      cspUserHeader: ctx.cspUserHeader,
      adapter: ctx.adapter,
      isVeryfrontDomain: ctx.parsedDomain?.allowIframeEmbed ?? false,
    });

    return this.respond(response);
  }

  private async resolveAllowedMethods(
    pathname: string,
    requestedMethod: string | undefined,
    ctx: HandlerContext,
  ): Promise<string[]> {
    try {
      const registeredHandlers = ctx.routeRegistry?.getHandlers() ?? [];
      const apiHandlerIndex = registeredHandlers.findIndex(({ metadata }) =>
        metadata.name === "ApiHandlerWrapper"
      );
      // Framework-owned routes registered before ApiHandlerWrapper can respond
      // even when their pathname starts with /api. Handlers after it are only
      // reachable when the project API router returns no response.
      const beforeApiHandler = apiHandlerIndex < 0
        ? registeredHandlers
        : registeredHandlers.slice(0, apiHandlerIndex);
      const afterApiHandler = apiHandlerIndex < 0
        ? registeredHandlers
        : registeredHandlers.slice(apiHandlerIndex + 1);
      const frameworkMethods = resolveRegisteredMethods(pathname, ctx, beforeApiHandler);

      const resolution = await this.withProxyContext(
        ctx,
        () =>
          withApiHandler(
            ctx,
            (handler) => handler.resolveRouteMethods(pathname, requestedMethod),
          ),
        { requireToken: true },
      );

      if (resolution.status === "resolved") {
        return mergeMethods(frameworkMethods, resolution.methods);
      }
      if (resolution.status === "unavailable") {
        return frameworkMethods ?? PREFLIGHT_ONLY_METHODS;
      }

      // Project API misses are terminal 404s in APIRouteHandler, but an
      // earlier framework-owned /api route can still be the real responder.
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return frameworkMethods ?? PREFLIGHT_ONLY_METHODS;
      }

      const laterMethods = resolveRegisteredMethods(pathname, ctx, afterApiHandler);
      if (frameworkMethods || laterMethods) return mergeMethods(frameworkMethods, laterMethods);
      return READ_ONLY_PAGE_METHODS;
    } catch (error) {
      this.logWarn("Failed to resolve route for CORS", { error, pathname }, ctx);
      return PREFLIGHT_ONLY_METHODS;
    }
  }
}
