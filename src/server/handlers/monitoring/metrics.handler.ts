import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { metrics, snapshotRequestProfiles } from "#veryfront/observability";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  PRIORITY_HIGH,
} from "#veryfront/utils/constants/index.ts";
import { memoryUsage, uptime } from "#veryfront/platform/compat/process.ts";
import { isAuthorizedDevControlRequest } from "../dev/access-policy.ts";

export class MetricsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MetricsHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: "/_metrics", exact: true }],
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!ctx.isLocalProject) return Promise.resolve(this.continue());

    const { pathname } = new URL(req.url);
    if (pathname !== "/_metrics") return Promise.resolve(this.continue());

    if (!isAuthorizedDevControlRequest(req, ctx)) {
      return Promise.resolve(
        this.respond(
          this.createPrivateResponseBuilder(req, ctx).text("Unauthorized", HTTP_UNAUTHORIZED),
        ),
      );
    }

    if (req.method !== "GET") {
      return Promise.resolve(
        this.respond(
          this.createPrivateResponseBuilder(req, ctx)
            .withAllow("GET")
            .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED),
        ),
      );
    }

    try {
      const snap = metrics.snapshot();
      const profiling = snapshotRequestProfiles();
      const memory = this.safeCall(memoryUsage);
      const uptimeValue = this.safeCall(uptime);

      const response = this.createPrivateResponseBuilder(req, ctx).json(
        { counters: snap, profiling, memory, uptime: uptimeValue },
        HTTP_OK,
      );

      return Promise.resolve(this.respond(response));
    } catch (e) {
      this.logWarn("metrics failed", {
        errorName: e instanceof Error ? e.name : typeof e,
      }, ctx);

      const response = this.createPrivateResponseBuilder(req, ctx).text(
        "Failed to gather metrics",
        HTTP_INTERNAL_SERVER_ERROR,
      );

      return Promise.resolve(this.respond(response));
    }
  }

  private safeCall<T>(fn: () => T, name?: string): T | undefined {
    try {
      return fn();
    } catch (error) {
      this.logWarn(`metrics ${name ?? "call"} failed`, {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
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
}
