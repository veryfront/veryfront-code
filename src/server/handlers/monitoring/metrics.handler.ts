import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { metrics } from "#veryfront/observability/simple-metrics/index.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  PRIORITY_HIGH,
} from "#veryfront/utils/constants/index.ts";
import { memoryUsage, uptime } from "#veryfront/platform/compat/process.ts";

export class MetricsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MetricsHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: "/_metrics", exact: true }],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);
    if (pathname !== "/_metrics") return Promise.resolve(this.continue());

    const securityConfig = ctx.securityConfig ?? undefined;
    const corsConfig = ctx.securityConfig?.cors;

    try {
      const snap = metrics.snapshot();
      const memory = this.safeCall(memoryUsage);
      const uptimeValue = this.safeCall(uptime);

      const response = ResponseBuilder.json(
        { counters: snap, memory, uptime: uptimeValue },
        req,
        { securityConfig, corsConfig, status: HTTP_OK },
      );

      return Promise.resolve(this.respond(response));
    } catch (e) {
      this.logWarn("metrics failed", { error: this.getErrorMessage(e) }, ctx);

      const response = ResponseBuilder.error(
        HTTP_INTERNAL_SERVER_ERROR,
        "Failed to gather metrics",
        req,
        { securityConfig, corsConfig },
      );

      return Promise.resolve(this.respond(response));
    }
  }

  private safeCall<T>(fn: () => T, name?: string): T | undefined {
    try {
      return fn();
    } catch (error) {
      this.logWarn(`metrics ${name ?? "call"} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
