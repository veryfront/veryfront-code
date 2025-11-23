/**
 * Health Check Handler
 * Handles /healthz, /readyz, and /_health endpoints
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { joinPath } from "@veryfront/utils/path-utils.ts";
import { HTTP_OK, HTTP_UNAVAILABLE, PRIORITY_HIGH } from "@veryfront/core/constants/index.ts";

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

  /**
   * Check if system is ready to serve requests
   * Verifies adapter, filesystem access, and project directory
   */
  private async checkReadiness(ctx: HandlerContext): Promise<boolean> {
    try {
      // Check adapter is available
      if (!ctx.adapter) {
        return false;
      }

      // Check filesystem is accessible by reading project directory
      const projectDirStat = await ctx.adapter.fs.stat(ctx.projectDir);
      if (!projectDirStat?.isDirectory) {
        return false;
      }

      // All checks passed
      return true;
    } catch {
      // Any error means not ready
      return false;
    }
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Check if this handler should process the request
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const builder = this.createResponseBuilder(ctx);

    // K8s-style health endpoint
    if (pathname === "/healthz") {
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .text("ok", HTTP_OK);
      return this.respond(response);
    }

    // K8s-style readiness endpoint
    if (pathname === "/readyz") {
      const isReady = await this.checkReadiness(ctx);
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .text(isReady ? "ready" : "not-ready", isReady ? HTTP_OK : HTTP_UNAVAILABLE);
      return this.respond(response);
    }

    // Production-compatible health endpoint with more details
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
