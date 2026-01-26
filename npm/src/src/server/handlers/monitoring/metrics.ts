import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { metrics } from "../../../observability/simple-metrics/index.js";
import { ResponseBuilder } from "../../../security/index.js";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  PRIORITY_HIGH,
} from "../../../utils/constants/index.js";
import { memoryUsage, uptime } from "../../../platform/compat/process.js";

export class MetricsHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "MetricsHandler",
    priority: PRIORITY_HIGH as HandlerPriority,
    patterns: [{ pattern: "/_metrics", exact: true }],
  };

  handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (pathname !== "/_metrics") {
      return Promise.resolve(this.continue());
    }

    try {
      const snap = metrics.snapshot();
      const memory = this.safeCall(memoryUsage);
      const uptimeValue = this.safeCall(uptime);

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
      this.logDebug("metrics failed", { error: this.getErrorMessage(e) }, ctx);

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

  private safeCall<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }
}
