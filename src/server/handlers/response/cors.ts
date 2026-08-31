import { BaseHandler } from "./base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { getConfig } from "#veryfront/config";
import { PRIORITY_VERY_HIGH } from "#veryfront/utils/constants/index.ts";
import { resolveAppRouteFile } from "../request/api/app-router-resolver.ts";
import {
  isSharedProjectRuntime,
  requiresIsolatedProjectRuntime,
} from "#veryfront/security/project-locality.ts";
import { getApplicationPreflightHeaders } from "#veryfront/security/http/application-request.ts";

type AppRouteResolver = typeof resolveAppRouteFile;
type FsWrapper = {
  isContextualMode?: () => boolean;
  isMultiProjectMode?: () => boolean;
  runWithContext?: (...args: never[]) => Promise<unknown>;
};

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
    const mustAvoidProjectCode = requiresIsolatedProjectRuntime(ctx);
    const isApiPath = pathname === "/api" || pathname.startsWith("/api/");
    const fsWrapper = ctx.adapter.fs as FsWrapper;
    const hasContextualFilesystem = fsWrapper.isContextualMode?.() === true;
    const hasAtomicSharedRuntimeContext = isSharedRuntime &&
      fsWrapper.isMultiProjectMode?.() === true &&
      typeof fsWrapper.runWithContext === "function";
    const shouldUseAutomaticPreflight = mustAvoidProjectCode ||
      (hasContextualFilesystem && !hasAtomicSharedRuntimeContext);
    if (!shouldUseAutomaticPreflight && isApiPath) {
      return this.continue();
    }

    if (!shouldUseAutomaticPreflight && !isApiPath) {
      const hasMatchedAppRoute = await this.hasMatchedAppRoute(pathname, ctx);
      if (hasMatchedAppRoute) return this.continue();
    }

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
      allowMethods: CorsHandler.DEFAULT_METHODS,
      allowHeaders: getApplicationPreflightHeaders(req),
      securityConfig: ctx.securityConfig ?? undefined,
      corsConfig,
    });

    return this.respond(response);
  }

  private async hasMatchedAppRoute(
    pathname: string,
    ctx: HandlerContext,
  ): Promise<boolean> {
    try {
      const match = await this.resolveAppRouteFile(pathname, ctx);
      return match !== null;
    } catch (error) {
      this.logWarn("Failed to resolve route for CORS", { error, pathname });
      return false;
    }
  }
}
