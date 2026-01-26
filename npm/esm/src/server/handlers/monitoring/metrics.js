import { BaseHandler } from "../response/base.js";
import { metrics } from "../../../observability/simple-metrics/index.js";
import { ResponseBuilder } from "../../../security/index.js";
import { HTTP_INTERNAL_SERVER_ERROR, HTTP_OK, PRIORITY_HIGH, } from "../../../utils/constants/index.js";
import { memoryUsage, uptime } from "../../../platform/compat/process.js";
export class MetricsHandler extends BaseHandler {
    metadata = {
        name: "MetricsHandler",
        priority: PRIORITY_HIGH,
        patterns: [{ pattern: "/_metrics", exact: true }],
    };
    handle(req, ctx) {
        const { pathname } = new URL(req.url);
        if (pathname !== "/_metrics") {
            return Promise.resolve(this.continue());
        }
        try {
            const snap = metrics.snapshot();
            const memory = this.safeCall(memoryUsage);
            const uptimeValue = this.safeCall(uptime);
            const response = ResponseBuilder.json({ counters: snap, memory, uptime: uptimeValue }, req, {
                securityConfig: ctx.securityConfig ?? undefined,
                corsConfig: ctx.securityConfig?.cors,
                status: HTTP_OK,
            });
            return Promise.resolve(this.respond(response));
        }
        catch (e) {
            this.logDebug("metrics failed", { error: this.getErrorMessage(e) }, ctx);
            const response = ResponseBuilder.error(HTTP_INTERNAL_SERVER_ERROR, "Failed to gather metrics", req, {
                securityConfig: ctx.securityConfig ?? undefined,
                corsConfig: ctx.securityConfig?.cors,
            });
            return Promise.resolve(this.respond(response));
        }
    }
    safeCall(fn) {
        try {
            return fn();
        }
        catch {
            return undefined;
        }
    }
}
