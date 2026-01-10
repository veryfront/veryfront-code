import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { joinPath } from "@veryfront/utils/path-utils.ts";
import { HTTP_OK, HTTP_UNAVAILABLE, PRIORITY_HIGH } from "@veryfront/core/constants/index.ts";

let serverInitialized = false;

export function setServerInitialized(ready: boolean): void {
  serverInitialized = ready;
}

export function isServerInitialized(): boolean {
  return serverInitialized;
}

export class HealthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "HealthHandler",
    priority: PRIORITY_HIGH as HandlerPriority, // HIGH priority
    patterns: [
      { pattern: "/healthz", exact: true },
      { pattern: "/readyz", exact: true },
      { pattern: "/_health", exact: true },
    ],
  };

  private async checkReadiness(ctx: HandlerContext): Promise<boolean> {
    try {
      if (!serverInitialized || !ctx.adapter) {
        return false;
      }

      const isProxyMode = ctx.config?.fs?.veryfront?.proxyMode === true;
      if (isProxyMode) {
        return true;
      }

      const projectDirStat = await ctx.adapter.fs.stat(ctx.projectDir);
      return !!projectDirStat?.isDirectory;
    } catch {
      return false;
    }
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const builder = this.createResponseBuilder(ctx);

    if (pathname === "/healthz") {
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .text("ok", HTTP_OK);
      return this.respond(response);
    }

    if (pathname === "/readyz") {
      const isReady = await this.checkReadiness(ctx);
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .text(isReady ? "ready" : "not-ready", isReady ? HTTP_OK : HTTP_UNAVAILABLE);
      return this.respond(response);
    }

    if (pathname === "/_health") {
      let hasStaticBuild = false;
      try {
        const st = await ctx.adapter.fs.stat(joinPath(ctx.projectDir, "dist"));
        hasStaticBuild = !!st?.isDirectory;
      } catch {
        // ignore
      }

      const payload = {
        status: "ok",
        timestamp: new Date().toISOString(),
        mode: hasStaticBuild ? "static+ssr" : "ssr",
        version: "0.1.0",
      };

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .json(payload, HTTP_OK);

      return this.respond(response);
    }

    return this.continue();
  }
}
