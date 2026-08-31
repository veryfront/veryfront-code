import { BaseHandler } from "./base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getConfig } from "#veryfront/config";
import { PRIORITY_VERY_HIGH } from "#veryfront/utils/constants/index.ts";
import { resolveAppRouteFile } from "../request/api/app-router-resolver.ts";
import { isSharedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { isInfrastructureOnlyRequestHeader } from "#veryfront/security/http/application-request.ts";
import { resolveExecutableRouteMethods } from "#veryfront/routing/api/route-methods.ts";

type AppRouteResolver = typeof resolveAppRouteFile;
const DEFAULT_ALLOWED_HEADERS = "Content-Type,Authorization";

function getApplicationPreflightHeaders(request: Request): string {
  const requested = request.headers.get("access-control-request-headers");
  if (!requested) return DEFAULT_ALLOWED_HEADERS;

  const allowed = requested.split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !isInfrastructureOnlyRequestHeader(name));
  return allowed.length > 0 ? allowed.join(",") : DEFAULT_ALLOWED_HEADERS;
}

export interface CorsHandlerDependencies {
  resolveAppRouteFile?: AppRouteResolver;
}

export class CorsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CorsHandler",
    priority: PRIORITY_VERY_HIGH as HandlerPriority,
    patterns: [{ pattern: /.*/, method: "OPTIONS" }],
  };

  private static readonly DEFAULT_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  private readonly resolveAppRouteFile: AppRouteResolver;

  constructor(dependencies: CorsHandlerDependencies = {}) {
    super();
    this.resolveAppRouteFile = dependencies.resolveAppRouteFile ?? resolveAppRouteFile;
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() !== "OPTIONS") return this.continue();

    const pathname = new URL(req.url).pathname;
    const isSharedRuntime = isSharedProjectRuntime(ctx);
    if (!isSharedRuntime && (pathname === "/api" || pathname.startsWith("/api/"))) {
      return this.continue();
    }

    const routeMethods = isSharedRuntime
      ? { allowMethods: CorsHandler.DEFAULT_METHODS, hasExecutableOptions: false }
      : await this.resolveRouteMethods(pathname, ctx);
    if (routeMethods.hasExecutableOptions) return this.continue();

    let corsConfig = ctx.securityConfig?.cors;
    if (!isSharedRuntime) {
      try {
        const cfg = await getConfig(ctx.projectDir, ctx.adapter);
        corsConfig = cfg?.security?.cors ?? corsConfig;
      } catch (error) {
        // Falling back to ctx.securityConfig?.cors (set at request time). If that is
        // also absent, ResponseBuilder.preflight will use its own restrictive defaults.
        // Verify the fallback is not more permissive than the config-file value intended.
        this.logWarn(
          "Failed to load CORS config — falling back to security-context defaults",
          { error },
        );
      }
    }

    const response = ResponseBuilder.preflight(req, {
      allowMethods: routeMethods.allowMethods,
      allowHeaders: getApplicationPreflightHeaders(req),
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig,
    });

    return this.respond(response);
  }

  private async resolveRouteMethods(
    pathname: string,
    ctx: HandlerContext,
  ): Promise<{ allowMethods: string; hasExecutableOptions: boolean }> {
    try {
      const match = await this.resolveAppRouteFile(pathname, ctx);
      if (!match) {
        return { allowMethods: CorsHandler.DEFAULT_METHODS, hasExecutableOptions: false };
      }

      const mod = (await import(`file://${match.file}`)) as Record<string, unknown>;
      const executableMethods = resolveExecutableRouteMethods(mod);
      const authoredMethods = resolveExecutableRouteMethods(mod, undefined, {
        includeFrameworkOptions: false,
      });
      return {
        allowMethods: executableMethods.join(", "),
        hasExecutableOptions: authoredMethods.includes("OPTIONS"),
      };
    } catch (error) {
      this.logWarn("Failed to resolve route for CORS", { error, pathname });
      return { allowMethods: CorsHandler.DEFAULT_METHODS, hasExecutableOptions: false };
    }
  }
}
