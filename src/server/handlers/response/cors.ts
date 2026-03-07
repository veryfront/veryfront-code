import { BaseHandler } from "./base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
  RouteHandlerModule,
} from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getConfig } from "#veryfront/config";
import { PRIORITY_VERY_HIGH } from "#veryfront/utils/constants/index.ts";
import { resolveAppRouteFile } from "../request/api/app-router-resolver.ts";

export class CorsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CorsHandler",
    priority: PRIORITY_VERY_HIGH as HandlerPriority,
    patterns: [{ pattern: /.*/, method: "OPTIONS" }],
  };

  private static readonly DEFAULT_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  private static readonly HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() !== "OPTIONS") return this.continue();

    const pathname = new URL(req.url).pathname;
    const allowMethods = await this.resolveAllowedMethods(pathname, ctx);

    let corsConfig = ctx.securityConfig?.cors;
    try {
      const cfg = await getConfig(ctx.projectDir, ctx.adapter);
      corsConfig = cfg?.security?.cors ?? corsConfig;
    } catch (error) {
      this.logWarn("Failed to load CORS config — using defaults", { error }, ctx);
    }

    const response = ResponseBuilder.preflight(req, {
      allowMethods,
      allowHeaders: req.headers.get("access-control-request-headers") ??
        "Content-Type,Authorization",
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig,
    });

    return this.respond(response);
  }

  private async resolveAllowedMethods(pathname: string, ctx: HandlerContext): Promise<string> {
    try {
      const match = await resolveAppRouteFile(pathname, ctx);
      if (!match) return CorsHandler.DEFAULT_METHODS;

      const mod = (await import(`file://${match.file}`)) as RouteHandlerModule;
      const foundMethods = CorsHandler.HTTP_METHODS.filter((m) => typeof mod[m] === "function");

      const methods: string[] = [...foundMethods];
      if (foundMethods.includes("GET")) methods.unshift("HEAD");
      methods.push("OPTIONS");

      return [...new Set(methods)].join(", ");
    } catch (error) {
      this.logWarn("Failed to resolve route for CORS", { error, pathname }, ctx);
      return CorsHandler.DEFAULT_METHODS;
    }
  }
}
