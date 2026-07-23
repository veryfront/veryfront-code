import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { validateDevFilePath } from "./path-validator.ts";
import { bundleDevFile } from "./esbuild-bundler.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_UNAUTHORIZED,
  PRIORITY_MEDIUM_DEV_FILES,
} from "#veryfront/utils/constants/index.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { isAuthorizedDevControlRequest } from "../access-policy.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";

const DEV_FILE_ROUTE_PREFIX = "/_veryfront/fs/";

function hasSameBrowserOrigin(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

export class DevFileHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevFileHandler",
    priority: PRIORITY_MEDIUM_DEV_FILES as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/fs/", prefix: true, method: "GET" }],
    // Strictly local-only: exposes project source tree (VULN-SRV-1 / VULN-SRV-2).
    // Preview mode (even host-derived) must not unlock this surface.
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (!ctx.isLocalProject) return this.continue();
    if (!pathname.startsWith(DEV_FILE_ROUTE_PREFIX)) return this.continue();

    if (!isAuthorizedDevControlRequest(req, ctx) || !hasSameBrowserOrigin(req)) {
      return this.respond(
        this.createErrorModule(req, ctx, "Unauthorized", HTTP_UNAUTHORIZED),
      );
    }

    if (req.method.toUpperCase() !== "GET") {
      const response = this.createPrivateResponseBuilder(req, ctx)
        .withAllow("GET")
        .javascript("export default null; // Method not allowed", HTTP_METHOD_NOT_ALLOWED);
      return this.respond(response);
    }

    const fsAdapter = ctx.adapter.fs;
    const isExtended = isExtendedFSAdapter(fsAdapter);

    if (isExtended && fsAdapter.isContextualMode()) {
      try {
        if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
        fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
        fsAdapter.setProductionMode(false, ctx.releaseId);
      } catch (_) {
        /* expected: some fs adapter operations may not be supported */
      }
    }

    return await this.handleWithContext(req, pathname, ctx);
  }

  private async handleWithContext(
    req: Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<HandlerResult> {
    const encoded = pathname.slice(DEV_FILE_ROUTE_PREFIX.length).replace(/\.js$/, "");
    const validation = await validateDevFilePath(encoded, ctx);

    if (!validation.ok) {
      this.logDebug("dev fs validation failed", { reason: validation.reason }, ctx);
      const unavailable = validation.reason === "unavailable";
      return this.respond(
        this.createErrorModule(
          req,
          ctx,
          unavailable ? "Module unavailable" : "Module not found",
          unavailable ? HTTP_INTERNAL_SERVER_ERROR : HTTP_NOT_FOUND,
        ),
      );
    }

    try {
      const code = await bundleDevFile(validation.path, ctx);
      const response = this.createPrivateResponseBuilder(req, ctx).javascript(code);

      return this.respond(response);
    } catch (error) {
      this.logDebug(
        "dev fs build failed",
        { errorCategory: classifyTelemetryError(error) },
        ctx,
      );
      return this.respond(
        this.createErrorModule(
          req,
          ctx,
          "Module build failed",
          HTTP_INTERNAL_SERVER_ERROR,
        ),
      );
    }
  }

  private createPrivateResponseBuilder(req: Request, ctx: HandlerContext) {
    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withCache("no-store")
      .withHeaders({ "X-Content-Type-Options": "nosniff" });
    if (ctx.securityConfig) builder.withSecurity(ctx.securityConfig, req);
    return builder;
  }

  private createErrorModule(
    req: Request,
    ctx: HandlerContext,
    message: string,
    status: number,
  ): Response {
    return this.createPrivateResponseBuilder(req, ctx).javascript(
      `export default null; // ${message}`,
      status,
    );
  }
}
