import { BaseHandler } from "./base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
  RouteHandlerModule,
} from "../types.ts";
import { handleCORSPreflight } from "#veryfront/security/index.ts";
import { getConfig } from "#veryfront/config";
import { PRIORITY_VERY_HIGH } from "#veryfront/utils/constants/index.ts";
import { resolveAppRouteFile } from "../request/api/app-router-resolver.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";

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

    let corsConfig = ctx.securityConfig?.cors;
    let allowMethods = CorsHandler.DEFAULT_METHODS;

    // Remote preflight must not discover or import project routes merely to
    // answer OPTIONS. The request-time security context is host-owned; when it
    // contains no CORS policy, the canonical handler emits no allow headers.
    if (ctx.isLocalProject !== false) {
      const pathname = new URL(req.url).pathname;
      allowMethods = await this.resolveAllowedMethods(pathname, ctx);

      try {
        const cfg = await getConfig(ctx.projectDir, ctx.adapter);
        corsConfig = cfg?.security?.cors ?? corsConfig;
      } catch (error) {
        this.logWarn(
          "Failed to load CORS config, falling back to security-context defaults",
          { errorName: getSafeErrorName(error) },
          ctx,
        );
      }
    }

    const response = await handleCORSPreflight({
      request: req,
      allowMethods: this.restrictAllowedMethods(allowMethods, corsConfig),
      config: corsConfig,
    });

    return this.respond(response);
  }

  private restrictAllowedMethods(
    routeMethods: string,
    corsConfig: boolean | { methods?: string[] } | null | undefined,
  ): string {
    if (typeof corsConfig !== "object" || !corsConfig?.methods?.length) return routeMethods;

    const configured = new Set(corsConfig.methods.map((method) => method.toUpperCase()));
    return routeMethods
      .split(",")
      .map((method) => method.trim())
      .filter((method) => method === "OPTIONS" || configured.has(method.toUpperCase()))
      .join(", ");
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
      this.logWarn(
        "Failed to resolve route for CORS",
        { errorName: getSafeErrorName(error) },
        ctx,
      );
      return CorsHandler.DEFAULT_METHODS;
    }
  }
}
