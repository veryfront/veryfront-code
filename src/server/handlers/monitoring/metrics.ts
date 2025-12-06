/**
 * Metrics Handler
 * Handles /_metrics endpoint for monitoring
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { metrics } from "@veryfront/observability/simple-metrics/index.ts";
import { ResponseBuilder } from "@veryfront/security/index.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  PRIORITY_HIGH,
} from "@veryfront/core/constants/index.ts";
import { memoryUsage, uptime } from "../../../platform/compat/process.ts";

export class MetricsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MetricsHandler",
    priority: PRIORITY_HIGH as HandlerPriority, // HIGH priority
    patterns: [
      { pattern: "/_metrics", exact: true },
    ],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname !== "/_metrics") {
      return Promise.resolve(this.continue());
    }

    try {
      const snap = metrics.snapshot();

      // Best-effort memory and uptime using platform abstraction
      const memory = (() => {
        try {
          return memoryUsage();
        } catch (err) {
          this.logDebug("Failed to get memory usage", { error: err }, ctx);
          return undefined;
        }
      })();

      const uptimeValue = (() => {
        try {
          return uptime();
        } catch (err) {
          this.logDebug("Failed to get uptime", { error: err }, ctx);
          return undefined;
        }
      })();

      const response = ResponseBuilder.json(
        { counters: snap, memory, uptime: uptimeValue },
        req,
        {
          securityConfig: ctx.securityConfig ?? undefined,
          corsConfig: ctx.securityConfig?.cors,
          status: HTTP_OK,
        },
      );

      return Promise.resolve(this.respond(response));
    } catch (e) {
      this.logDebug("metrics failed", {
        error: this.getErrorMessage(e),
      }, ctx);

      // Return error response
      const response = ResponseBuilder.error(
        HTTP_INTERNAL_SERVER_ERROR,
        "Failed to gather metrics",
        req,
        {
          securityConfig: ctx.securityConfig ?? undefined,
          corsConfig: ctx.securityConfig?.cors,
        },
      );

      return Promise.resolve(this.respond(response));
    }
  }
}
