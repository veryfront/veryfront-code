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

      // Best-effort memory and uptime (Deno/Node)
      interface DenoGlobal {
        Deno?: {
          memoryUsage?: () => { rss: number; heapTotal: number; heapUsed: number };
          osUptime?: () => number;
        };
        process?: {
          memoryUsage?: () => { rss: number; heapTotal: number; heapUsed: number };
          uptime?: () => number;
        };
      }

      const global = globalThis as DenoGlobal;
      const D = global.Deno;
      const P = global.process;

      const memory = (() => {
        try {
          if (D?.memoryUsage) return D.memoryUsage();
        } catch (err) {
          this.logDebug("Failed to get Deno memory usage", { error: err }, ctx);
        }
        try {
          if (P?.memoryUsage) return P.memoryUsage();
        } catch (err) {
          this.logDebug("Failed to get process memory usage", { error: err }, ctx);
        }
        return undefined;
      })();

      const uptime = (() => {
        try {
          if (D?.osUptime) return D.osUptime();
        } catch (err) {
          this.logDebug("Failed to get Deno uptime", { error: err }, ctx);
        }
        try {
          if (P?.uptime) return P.uptime();
        } catch (err) {
          this.logDebug("Failed to get process uptime", { error: err }, ctx);
        }
        return undefined;
      })();

      const response = ResponseBuilder.json(
        { counters: snap, memory, uptime },
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
