import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { joinPath } from "../../../utils/path-utils.js";
import { HTTP_OK, HTTP_UNAVAILABLE, PRIORITY_HIGH } from "../../../utils/constants/index.js";
import { isTracingDegraded, isTracingEnabled } from "../../../observability/tracing/index.js";

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
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [
      { pattern: "/healthz", exact: true },
      { pattern: "/readyz", exact: true },
      { pattern: "/_health", exact: true },
    ],
  };

  private async checkReadiness(ctx: HandlerContext): Promise<boolean> {
    if (!serverInitialized || !ctx.adapter) {
      return false;
    }

    try {
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

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const pathname = new URL(req.url).pathname;
    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined);

    if (pathname === "/healthz") {
      return this.respond(builder.text("ok", HTTP_OK));
    }

    if (pathname === "/readyz") {
      const isReady = await this.checkReadiness(ctx);
      const status = isReady ? HTTP_OK : HTTP_UNAVAILABLE;
      return this.respond(builder.text(isReady ? "ready" : "not-ready", status));
    }

    if (pathname === "/_health") {
      const hasStaticBuild = await this.hasDistDirectory(ctx);
      const tracingDegraded = isTracingDegraded();

      const payload = {
        status: tracingDegraded ? "degraded" : "ok",
        timestamp: new Date().toISOString(),
        mode: hasStaticBuild ? "static+ssr" : "ssr",
        version: "0.1.0",
        tracing: {
          enabled: isTracingEnabled(),
          degraded: tracingDegraded,
        },
      };

      return this.respond(builder.withCache("no-cache").json(payload, HTTP_OK));
    }

    return this.continue();
  }

  private async hasDistDirectory(ctx: HandlerContext): Promise<boolean> {
    try {
      const st = await ctx.adapter.fs.stat(joinPath(ctx.projectDir, "dist"));
      return !!st?.isDirectory;
    } catch {
      return false;
    }
  }
}
