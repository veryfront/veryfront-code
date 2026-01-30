import { BaseHandler } from "../response/base.js";
import { joinPath } from "../../../utils/path-utils.js";
import { HTTP_OK, HTTP_UNAVAILABLE, PRIORITY_HIGH } from "../../../utils/constants/index.js";
import { isTracingDegraded, isTracingEnabled } from "../../../observability/tracing/index.js";
import { VERSION } from "../../../utils/version.js";
let serverInitialized = false;
export function setServerInitialized(ready) {
    serverInitialized = ready;
}
export function isServerInitialized() {
    return serverInitialized;
}
export class HealthHandler extends BaseHandler {
    metadata = {
        name: "HealthHandler",
        priority: PRIORITY_HIGH,
        patterns: [
            { pattern: "/healthz", exact: true },
            { pattern: "/readyz", exact: true },
            { pattern: "/_health", exact: true },
        ],
    };
    async checkReadiness(ctx) {
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
        }
        catch {
            return false;
        }
    }
    async handle(req, ctx) {
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
                version: VERSION,
                tracing: {
                    enabled: isTracingEnabled(),
                    degraded: tracingDegraded,
                },
            };
            return this.respond(builder.withCache("no-cache").json(payload, HTTP_OK));
        }
        return this.continue();
    }
    async hasDistDirectory(ctx) {
        try {
            const st = await ctx.adapter.fs.stat(joinPath(ctx.projectDir, "dist"));
            return !!st?.isDirectory;
        }
        catch {
            return false;
        }
    }
}
